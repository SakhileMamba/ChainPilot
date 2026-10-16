// The license server (server/worker.js) end to end, against an in-memory KV store
// and a fake MoMo API.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import config from '../product.config.json' with { type: 'json' };
import worker, { normalizePhone } from '../server/worker.js';
import { checkLicense } from '../src/license.js';
import { MemoryKV } from '../tools/lib/memory-kv.js';

const MACHINE = '7F3K-9QXA-2M8D-H4PZ';
const SITE_ORIGIN = new URL(config.siteUrl).origin;

/** A fake MoMo Collections API. Set requests.get(ref).status to move a payment along. */
function fakeMoMo() {
  const requests = new Map();
  const fetch = async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/collection/token/') {
      assert.equal(init.headers['X-Target-Environment'], 'mtnswaziland');
      assert.equal(init.headers.Authorization, `Basic ${btoa('api-user:api-key')}`);
      return Response.json({ access_token: 'token-1', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer token-1');
    if (pathname === '/collection/v1_0/requesttopay') {
      requests.set(init.headers['X-Reference-Id'], { body: JSON.parse(init.body), status: 'PENDING' });
      return new Response(null, { status: 202 });
    }
    const ref = /requesttopay\/(.+)$/.exec(pathname)?.[1];
    const r = requests.get(ref);
    if (!r) return Response.json({ code: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    return Response.json({ ...r.body, status: r.status, reason: r.reason, financialTransactionId: '987654321', ...r.override });
  };
  return { fetch, requests };
}

function setup() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const momo = fakeMoMo();
  const env = {
    DB: new MemoryKV(),
    MOMO_BASE_URL: 'https://momo.test',
    MOMO_SUBSCRIPTION_KEY: 'sub-key',
    MOMO_API_USER: 'api-user',
    MOMO_API_KEY: 'api-key',
    MOMO_TARGET_ENV: 'mtnswaziland',
    MOMO_CURRENCY: 'SZL',
    LICENSE_PRIVATE_KEY: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    ADMIN_TOKEN: 'admin-secret',
    MOMO_FETCH: momo.fetch,
  };
  const call = async (method, path, body, headers = {}) => {
    const res = await worker.fetch(
      new Request(`https://api.test${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
  };
  const order = (extra = {}) => call('POST', '/v1/orders', { plan: 'month', machineId: MACHINE, phone: '7612 3456', ...extra });
  return { env, momo, call, order, publicKey };
}

test('plans come from product.config.json', async () => {
  const { call } = setup();
  const { status, body } = await call('GET', '/v1/plans');
  assert.equal(status, 200);
  assert.equal(body.currency, config.currency);
  assert.deepEqual(
    body.plans.map((p) => [p.id, p.price]),
    config.plans.map((p) => [p.id, p.price]),
  );
});

test('an order asks MoMo for the payment, and a paid order returns a license for that computer', async () => {
  const { call, order, momo, publicKey } = setup();
  const created = await order({ machineId: '7f3k 9qxa 2m8d h4pz' });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'PENDING');
  assert.equal(created.body.phone, '•••••••3456');
  const sent = momo.requests.get(created.body.id).body;
  assert.deepEqual(
    { amount: sent.amount, currency: sent.currency, payer: sent.payer },
    { amount: '180', currency: 'SZL', payer: { partyIdType: 'MSISDN', partyId: '26876123456' } },
  );

  assert.equal((await call('GET', `/v1/orders/${created.body.id}`)).body.status, 'PENDING');
  momo.requests.get(created.body.id).status = 'SUCCESSFUL';
  const paid = (await call('GET', `/v1/orders/${created.body.id}`)).body;
  assert.equal(paid.status, 'PAID');
  const check = checkLicense(paid.license, { publicKey, machine: MACHINE });
  assert.equal(check.state, 'active');
  assert.equal(check.plan, 'month');
  assert.ok(Math.abs(check.expiresAt - (Date.now() + 30 * 86_400_000)) < 60_000);
  assert.equal(new Date(paid.expiresAt).getTime(), check.expiresAt);

  // Polling again returns the same key; a different computer can't use it.
  assert.equal((await call('GET', `/v1/orders/${created.body.id}`)).body.license, paid.license);
  assert.equal(checkLicense(paid.license, { publicKey, machine: 'AAAA-BBBB-CCCC-DDDD' }).state, 'other-machine');
});

test('renewing before the pass ends adds the days to the end of it', async () => {
  const { env, call, order, momo, publicKey } = setup();
  const first = (await order()).body;
  momo.requests.get(first.id).status = 'SUCCESSFUL';
  const firstExp = checkLicense((await call('GET', `/v1/orders/${first.id}`)).body.license, { publicKey, machine: MACHINE }).expiresAt;

  env.DB.data.delete('throttle:26876123456'); // as if a minute had passed
  const second = (await order({ plan: 'week' })).body;
  momo.requests.get(second.id).status = 'SUCCESSFUL';
  const renewed = checkLicense((await call('GET', `/v1/orders/${second.id}`)).body.license, { publicKey, machine: MACHINE });
  assert.equal(renewed.expiresAt, firstExp + 7 * 86_400_000);
});

test('failed and mismatched payments do not issue licenses', async () => {
  const { env, call, order, momo } = setup();
  const declined = (await order()).body;
  Object.assign(momo.requests.get(declined.id), { status: 'FAILED', reason: 'APPROVAL_REJECTED' });
  const result = (await call('GET', `/v1/orders/${declined.id}`)).body;
  assert.equal(result.status, 'FAILED');
  assert.match(result.message, /declined/);
  assert.equal(result.license, undefined);

  env.DB.data.delete('throttle:26876123456');
  const odd = (await order()).body;
  Object.assign(momo.requests.get(odd.id), { status: 'SUCCESSFUL', override: { amount: '1' } });
  const review = (await call('GET', `/v1/orders/${odd.id}`)).body;
  assert.equal(review.status, 'REVIEW');
  assert.equal(review.license, undefined);
});

test('orders are validated and a number is not prompted twice within a minute', async () => {
  const { order } = setup();
  assert.equal((await order({ plan: 'forever' })).status, 400);
  assert.equal((await order({ machineId: 'nope' })).status, 400);
  assert.equal((await order({ phone: '123' })).status, 400);
  assert.equal((await order()).status, 201);
  const again = await order();
  assert.equal(again.status, 429);
  assert.match(again.body.error, /just sent/);
});

test('restoring licenses settles payments still pending for the computer', async () => {
  const { call, order, momo } = setup();
  const created = (await order()).body;
  assert.deepEqual((await call('GET', `/v1/licenses/${MACHINE}`)).body.licenses, []);
  momo.requests.get(created.id).status = 'SUCCESSFUL';
  const { licenses } = (await call('GET', `/v1/licenses/${MACHINE.toLowerCase()}`)).body;
  assert.equal(licenses.length, 1);
  assert.match(licenses[0].key, /^CP1\./);
});

test('admin endpoints need the token and can find orders by phone', async () => {
  const { call, order } = setup();
  const created = (await order()).body;
  assert.equal((await call('GET', '/v1/admin/orders')).status, 401);
  const auth = { authorization: 'Bearer admin-secret' };
  const found = (await call('GET', '/v1/admin/orders?phone=%2B268%207612%203456', undefined, auth)).body.orders;
  assert.deepEqual(
    found.map((o) => o.id),
    [created.id],
  );
  assert.equal((await call('GET', '/v1/admin/orders?phone=76000000', undefined, auth)).body.orders.length, 0);
  assert.equal((await call('GET', `/v1/admin/orders/${created.id}`, undefined, auth)).body.order.msisdn, '26876123456');
});

test('CORS allows the website and local previews only', async () => {
  const { call } = setup();
  const site = await call('OPTIONS', '/v1/orders', undefined, { origin: SITE_ORIGIN });
  assert.equal(site.status, 204);
  assert.equal(site.headers.get('access-control-allow-origin'), SITE_ORIGIN);
  assert.equal((await call('GET', '/v1/plans', undefined, { origin: 'http://localhost:8080' })).headers.get('access-control-allow-origin'), 'http://localhost:8080');
  assert.equal((await call('GET', '/v1/plans', undefined, { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
});

test('phone numbers are normalized to the international format', () => {
  const env = { MOMO_TARGET_ENV: 'mtnswaziland' };
  for (const input of ['7612 3456', '+268 7612 3456', '00268-7612-3456', '076123456', '26876123456']) {
    assert.equal(normalizePhone(input, env), '26876123456', input);
  }
  for (const input of ['123', '+27 82 123 4567', 'seven', '']) assert.equal(normalizePhone(input, env), null, input);
  assert.equal(normalizePhone('46733123450', { MOMO_TARGET_ENV: 'sandbox' }), '46733123450');
});
