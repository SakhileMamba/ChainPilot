// ChainPilot license server: a Cloudflare Worker that sells subscription passes
// through MTN MoMo "Request to Pay" and hands out signed license keys. The website
// (GitHub Pages) and the desktop app call it:
//
//   GET  /v1/plans                  plans and prices (from product.config.json)
//   POST /v1/orders                 { plan, machineId, phone }: the phone gets a MoMo approval prompt
//   GET  /v1/orders/:id             payment status; once paid it includes the license key
//   GET  /v1/licenses/:machineId    keys already issued to a computer (restore after a reinstall)
//   GET  /v1/admin/orders[/:id]     for support; needs "Authorization: Bearer <ADMIN_TOKEN>"
//
// Settings are in server/wrangler.toml; secrets are set with `wrangler secret put`
// (see docs/SELLER-GUIDE.md). Payment status is polled, not taken from MoMo
// callbacks, so it works with MoMo credentials registered for another callback host.
import config from '../product.config.json' with { type: 'json' };
import { assembleKey, licenseSigningInput, normalizeMachineId, utf8 } from '../src/license-format.js';
import { MoMo, MoMoError, describeFailure } from './momo.js';

const DAY_S = 86_400;
const FAILED = new Set(['FAILED', 'REJECTED', 'TIMEOUT', 'EXPIRED']);

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      response = await route(request, env);
    } catch (err) {
      console.error('unhandled', err?.stack ?? err);
      response = json({ error: 'Something went wrong on our side. Please try again.' }, 500);
    }
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    return response;
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const [version, resource, id, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!version || version === 'health') return json({ ok: true, product: config.name });
  if (version !== 'v1') return notFound();
  const method = request.method;
  if (resource === 'plans' && method === 'GET') return json(plans(env));
  if (resource === 'orders' && !id && method === 'POST') return createOrder(request, env);
  if (resource === 'orders' && id && method === 'GET') return getOrder(id, env);
  if (resource === 'licenses' && id && method === 'GET') return getLicenses(id, env);
  if (resource === 'admin') return admin(request, env, [id, ...rest]);
  return notFound();
}

function plans(env) {
  return {
    product: config.name,
    currency: config.currency,
    sandbox: env.MOMO_TARGET_ENV === 'sandbox',
    plans: config.plans.map(({ id, name, days, price, best }) => ({ id, name, days, price, best: Boolean(best) })),
  };
}

async function createOrder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send the order as JSON.' }, 400);
  }
  const plan = config.plans.find((p) => p.id === body?.plan);
  if (!plan) return json({ error: 'Choose a plan.' }, 400);
  const machineId = normalizeMachineId(body?.machineId);
  if (!machineId) {
    return json({ error: `Enter your machine ID (XXXX-XXXX-XXXX-XXXX). ${config.name} shows it under Subscription.` }, 400);
  }
  const msisdn = normalizePhone(body?.phone, env);
  if (!msisdn) return json({ error: `Enter your MoMo number, for example ${config.country.example}.` }, 400);

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.ORDER_LIMITER && !(await env.ORDER_LIMITER.limit({ key: `ip:${ip}` })).success) {
    return json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
  }
  if (await env.DB.get(`throttle:${msisdn}`)) {
    return json({ error: 'A payment request was just sent to this number. Approve it on your phone, or wait a minute to try again.' }, 429);
  }

  const order = {
    id: crypto.randomUUID(), // also MoMo's X-Reference-Id
    plan: plan.id,
    planName: plan.name,
    days: plan.days,
    amount: plan.price,
    currency: env.MOMO_CURRENCY || config.currency,
    machineId,
    msisdn,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };
  try {
    await momo(env).requestToPay({
      referenceId: order.id,
      amount: order.amount,
      currency: order.currency,
      externalId: order.id,
      msisdn,
      payerMessage: `${config.name} ${plan.name}`,
      payeeNote: `${config.name} ${plan.id} ${machineId}`,
    });
  } catch (err) {
    if (!(err instanceof MoMoError)) throw err;
    console.error('requestToPay failed', err.status, err.code, err.message);
    if (err.code === 'PAYER_NOT_FOUND') return json({ error: describeFailure('PAYER_NOT_FOUND') }, 400);
    if (err.status === 400) return json({ error: "MoMo didn't accept that number. Check it and try again." }, 400);
    return json({ error: "MoMo isn't reachable right now. Please try again in a few minutes." }, 502);
  }
  await saveOrder(env, order);
  await env.DB.put(`throttle:${msisdn}`, '1', { expirationTtl: 60 });
  const machine = await readMachine(env, machineId);
  machine.pending = [order.id, ...(machine.pending ?? [])].slice(0, 5);
  await env.DB.put(`machine:${machineId}`, JSON.stringify(machine));
  return json(publicOrder(order), 201);
}

async function getOrder(id, env) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const order = await env.DB.get(`order:${id}`, 'json');
  if (!order) return json({ error: 'Order not found (yet). If you have just paid, try again in a moment.' }, 404);
  if (order.status === 'PENDING') await refresh(order, env);
  return json(publicOrder(order));
}

/** Ask MoMo how a pending order stands; on success, issue its license. Saves any change. */
async function refresh(order, env) {
  let result;
  try {
    result = await momo(env).requestToPayStatus(order.id);
  } catch (err) {
    if (!(err instanceof MoMoError)) throw err;
    console.error('status check failed', order.id, err.status, err.message);
    return; // still pending as far as we know; the next poll tries again
  }
  const status = String(result.status ?? '').toUpperCase();
  if (status === 'SUCCESSFUL') {
    if (Number(result.amount) !== Number(order.amount) || (result.currency && result.currency !== order.currency)) {
      order.status = 'REVIEW';
      order.reason = `MoMo reports ${result.amount} ${result.currency}, expected ${order.amount} ${order.currency}`;
    } else {
      const license = await issueLicense(env, order);
      Object.assign(order, {
        status: 'PAID',
        paidAt: new Date().toISOString(),
        financialTransactionId: result.financialTransactionId ?? null,
        licenseId: license.id,
        license: license.key,
        expiresAt: license.expiresAt,
      });
    }
    await saveOrder(env, order);
  } else if (FAILED.has(status)) {
    order.status = 'FAILED';
    order.failureCode = String(result.reason?.code ?? result.reason ?? status);
    order.reason = describeFailure(result.reason ?? status);
    await saveOrder(env, order);
  }
}

/**
 * Sign a license for a paid order (once per order). A renewal bought before the
 * current pass ends starts when it ends, so paying early loses no days.
 */
async function issueLicense(env, order) {
  const machine = await readMachine(env, order.machineId);
  const existing = machine.licenses.find((l) => l.orderId === order.id);
  if (existing) return existing;
  const now = Math.floor(Date.now() / 1000);
  const current = Math.max(now, ...machine.licenses.map((l) => l.expiresAt ?? 0));
  const exp = order.days ? current + order.days * DAY_S : null;
  const payload = {
    v: 1,
    id: `L${order.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    m: order.machineId,
    plan: order.plan,
    iat: now,
    exp,
    ref: order.id.slice(0, 8),
  };
  const entry = { id: payload.id, plan: order.plan, issuedAt: now, expiresAt: exp, key: await signLicense(env, payload), orderId: order.id };
  machine.licenses = [entry, ...machine.licenses].slice(0, 20);
  machine.pending = (machine.pending ?? []).filter((id) => id !== order.id);
  await env.DB.put(`machine:${order.machineId}`, JSON.stringify(machine));
  return entry;
}

async function getLicenses(id, env) {
  const machineId = normalizeMachineId(id);
  if (!machineId) return json({ error: 'That is not a machine ID (XXXX-XXXX-XXXX-XXXX).' }, 400);
  // Settle payments still pending for this computer, in case the payer closed the page before it confirmed.
  for (const orderId of (await readMachine(env, machineId)).pending ?? []) {
    const order = await env.DB.get(`order:${orderId}`, 'json');
    if (order?.status === 'PENDING') await refresh(order, env);
  }
  const machine = await readMachine(env, machineId);
  return json({
    machineId,
    licenses: machine.licenses.map(({ id: licenseId, plan, issuedAt, expiresAt, key }) => ({
      id: licenseId,
      plan,
      issuedAt: isoTime(issuedAt),
      expiresAt: expiresAt === null ? null : isoTime(expiresAt),
      key,
    })),
  });
}

async function admin(request, env, [what, id]) {
  const auth = request.headers.get('authorization') ?? '';
  if (!env.ADMIN_TOKEN || !sameText(auth, `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: 'Unauthorized' }, 401);
  if (what !== 'orders' || request.method !== 'GET') return notFound();
  if (id) {
    const order = await env.DB.get(`order:${id}`, 'json');
    if (!order) return notFound();
    if (order.status === 'PENDING') await refresh(order, env);
    return json({ order });
  }
  // Filter by ?phone=, ?machine=, ?status=; newest first.
  const params = new URL(request.url).searchParams;
  const msisdn = params.get('phone') ? normalizePhone(params.get('phone'), env) : null;
  const machineId = params.get('machine') ? normalizeMachineId(params.get('machine')) : null;
  const status = params.get('status')?.toUpperCase();
  const orders = [];
  let cursor;
  do {
    const page = await env.DB.list({ prefix: 'order:', cursor });
    for (const { name, metadata: m = {} } of page.keys) {
      if ((msisdn && m.msisdn !== msisdn) || (machineId && m.machineId !== machineId) || (status && m.status !== status)) continue;
      orders.push({ id: name.slice('order:'.length), ...m });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && orders.length < 1000);
  orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return json({ orders: orders.slice(0, 200) });
}

// ---- helpers ----

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const notFound = () => json({ error: 'Not found' }, 404);
const isoTime = (seconds) => new Date(seconds * 1000).toISOString();

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = new Set(
    String(env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  try {
    allowed.add(new URL(config.siteUrl).origin);
  } catch {}
  const ok = origin && (allowed.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  if (!ok) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** International number without "+" (e.g. 26876123456), or null. The sandbox takes its test numbers as they are. */
export function normalizePhone(input, env) {
  let digits = String(input ?? '').replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d{6,15}$/.test(digits)) return null;
  if (env.MOMO_TARGET_ENV === 'sandbox') return digits;
  const { dialCode, localDigits } = config.country;
  if (digits.length === localDigits) digits = dialCode + digits;
  else if (digits.length === localDigits + 1 && digits.startsWith('0')) digits = dialCode + digits.slice(1);
  return digits.startsWith(dialCode) && digits.length === dialCode.length + localDigits ? digits : null;
}

const maskPhone = (msisdn) => (msisdn ? `${msisdn.slice(0, -4).replace(/\d/g, '•')}${msisdn.slice(-4)}` : null);

function publicOrder(order) {
  const pub = {
    id: order.id,
    status: order.status,
    plan: order.plan,
    amount: order.amount,
    currency: order.currency,
    machineId: order.machineId,
    phone: maskPhone(order.msisdn),
    createdAt: order.createdAt,
  };
  if (order.status === 'PENDING') {
    pub.message = `Check your phone: approve the payment of ${order.amount} ${order.currency} with your MoMo PIN.`;
  } else if (order.status === 'PAID') {
    Object.assign(pub, {
      license: order.license,
      licenseId: order.licenseId,
      expiresAt: order.expiresAt === null ? null : isoTime(order.expiresAt),
      message: 'Payment received. Your subscription is active.',
    });
  } else if (order.status === 'FAILED') {
    pub.message = order.reason;
  } else {
    pub.message = `We received a payment but need to check it. Contact support and quote order ${order.id.slice(0, 8)}.`;
  }
  return pub;
}

async function saveOrder(env, order) {
  const { status, plan, msisdn, machineId, createdAt } = order;
  await env.DB.put(`order:${order.id}`, JSON.stringify(order), { metadata: { status, plan, msisdn, machineId, createdAt } });
}

async function readMachine(env, machineId) {
  const record = (await env.DB.get(`machine:${machineId}`, 'json')) ?? {};
  return { licenses: [], pending: [], ...record };
}

const clients = new WeakMap();
function momo(env) {
  let client = clients.get(env);
  if (!client) {
    client = new MoMo({
      baseUrl: env.MOMO_BASE_URL,
      subscriptionKey: env.MOMO_SUBSCRIPTION_KEY,
      apiUser: env.MOMO_API_USER,
      apiKey: env.MOMO_API_KEY,
      targetEnvironment: env.MOMO_TARGET_ENV,
      fetch: env.MOMO_FETCH, // tests only; undefined in production
    });
    clients.set(env, client);
  }
  return client;
}

const signingKeys = new WeakMap();
async function signLicense(env, payload) {
  let key = signingKeys.get(env);
  if (!key) {
    if (!env.LICENSE_PRIVATE_KEY) throw new Error('LICENSE_PRIVATE_KEY is not set');
    // Accepts the bare base64 from `npm run keys -- --worker-secret`, or the PEM file's text.
    const der = Uint8Array.from(atob(env.LICENSE_PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
    key = crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    key.catch(() => signingKeys.delete(env));
    signingKeys.set(env, key);
  }
  const input = licenseSigningInput(payload);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, await key, utf8(input)));
  return assembleKey(input, signature);
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
