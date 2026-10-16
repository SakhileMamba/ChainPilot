// subscribe.html: pay with MTN MoMo through the license server and show the license key.
import config from './config.js';
import { h } from './shared/web/format.js';

const payForm = document.getElementById('pay-form');
const orderBox = document.getElementById('order-box');
const restoreForm = document.getElementById('restore-form');
const restoreBox = document.getElementById('restore-box');
const api = config.apiUrl ? config.apiUrl.replace(/\/+$/, '') : null;

if (!api) {
  document.getElementById('online-pay').hidden = true;
  document.getElementById('restore-card').hidden = true;
  document.getElementById('offline-pay').hidden = false;
}

// The app opens this page as subscribe.html#machine=XXXX-XXXX-XXXX-XXXX
const fromApp = new URLSearchParams(location.hash.slice(1)).get('machine');
if (fromApp) {
  payForm.elements.machineId.value = fromApp;
  restoreForm.elements.machineId.value = fromApp;
}

async function request(path, body) {
  let res;
  try {
    res = await fetch(`${api}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Couldn't reach the payment service. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Error ${res.status}`), { status: res.status });
  return data;
}

function show(box, tone, ...children) {
  box.hidden = false;
  box.className = `${box.id === 'order-box' ? 'order-box' : ''} ${tone}`.trim();
  box.replaceChildren(...children);
}

function keyBlock(key, expiresAt) {
  const area = h('textarea', { class: 'key-output', readonly: true, 'aria-label': 'License key' }, key);
  const copy = h('button', { type: 'button', class: 'btn' }, 'Copy key');
  copy.addEventListener('click', async () => {
    area.select();
    try {
      await navigator.clipboard.writeText(key);
      copy.textContent = 'Copied';
    } catch {
      document.execCommand?.('copy');
    }
  });
  return [
    h('p', {}, expiresAt ? `Valid until ${new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'No end date.'),
    area,
    copy,
    h('p', { class: 'muted small' }, `In ${config.name}, open Subscription and press "Restore purchase", or paste this key and press "Activate key".`),
  ];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

payForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = payForm.querySelector('button[type=submit]');
  const body = {
    plan: payForm.elements.plan.value,
    machineId: payForm.elements.machineId.value,
    phone: payForm.elements.phone.value,
  };
  button.disabled = true;
  try {
    let order = await request('/v1/orders', body);
    const started = Date.now();
    while (order.status === 'PENDING' && Date.now() - started < 10 * 60_000) {
      show(orderBox, '', h('p', {}, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('strong', {}, 'Waiting for your approval')), h('p', {}, order.message), h('p', { class: 'muted small' }, `Prompt sent to ${order.phone}. Keep this page open.`));
      await sleep(4000);
      try {
        order = await request(`/v1/orders/${order.id}`);
      } catch (err) {
        if (err.status !== 404) show(orderBox, '', h('p', {}, `Still checking… (${err.message})`));
      }
    }
    if (order.status === 'PAID') show(orderBox, 'good', h('p', {}, h('strong', {}, 'Payment received. Thank you!')), ...keyBlock(order.license, order.expiresAt));
    else if (order.status === 'PENDING') show(orderBox, 'bad', h('p', {}, 'No confirmation yet. If you approved the payment, use "Lost your key?" below in a minute.'));
    else show(orderBox, 'bad', h('p', {}, h('strong', {}, 'Payment not completed. ')), h('p', {}, order.message ?? ''));
  } catch (err) {
    show(orderBox, 'bad', h('p', {}, err.message));
  } finally {
    button.disabled = false;
  }
});

restoreForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = restoreForm.elements.machineId.value.trim();
  show(restoreBox, '', h('p', {}, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Looking…'));
  try {
    const { licenses } = await request(`/v1/licenses/${encodeURIComponent(id)}`);
    if (!licenses.length) return show(restoreBox, '', h('p', {}, 'No subscription has been paid for this machine ID yet.'));
    const [latest] = licenses;
    show(restoreBox, '', h('p', {}, h('strong', {}, `${licenses.length} key${licenses.length === 1 ? '' : 's'} found. The newest:`)), ...keyBlock(latest.key, latest.expiresAt));
  } catch (err) {
    show(restoreBox, 'bad', h('p', {}, err.message));
  }
});
