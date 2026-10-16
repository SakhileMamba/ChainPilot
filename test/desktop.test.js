// The desktop app without a real browser: the local server's checks, the app's
// settings and subscription flow, the controller's session rules, and signed
// selector updates from the website.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { DesktopApp } from '../desktop/app.js';
import { Controller } from '../desktop/controller.js';
import { applySelectors, isNewer } from '../desktop/remote.js';
import { startServer } from '../desktop/server.js';
import { LicenseStore } from '../src/license.js';
import { DEFAULT_PLAN } from '../src/plan.js';
import { PRODUCT } from '../src/product.js';
import { signLicense, signResource } from '../tools/lib/sign.js';

const MACHINE = '7F3K-9QXA-2M8D-H4PZ';
const DAY_S = 86_400;
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chainpilot-desktop-'));
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const licenseKey = (days, extra = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return signLicense({ v: 1, id: `L${days}`, m: MACHINE, plan: 'month', iat: now, exp: now + days * DAY_S, ...extra }, privateKey);
};
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

// ---------------- server ----------------

function fakeApp() {
  const app = new EventEmitter();
  app.calls = [];
  app.state = () => ({ hello: 'world' });
  app.saveSettings = (body) => (app.calls.push(['saveSettings', body]), { ok: true });
  app.start = () => {
    throw Object.assign(new Error('Check the highlighted settings.'), { fields: { bet: 'too small' } });
  };
  return app;
}

function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('the local server needs the token and its own Host header, and only takes JSON', async () => {
  const app = fakeApp();
  const server = await startServer({ app, token: 'secret-token-123456789012345678' });
  const host = `127.0.0.1:${server.port}`;
  const auth = { host, 'x-token': 'secret-token-123456789012345678' };
  try {
    assert.equal((await raw(server.port, { headers: { host } })).status, 200); // the page itself is public
    assert.match((await raw(server.port, { headers: { host } })).headers['content-security-policy'], /default-src 'self'/);
    assert.equal((await raw(server.port, { path: '/api/state', headers: { host } })).status, 401);
    assert.equal((await raw(server.port, { path: '/api/state', headers: { ...auth, 'x-token': 'wrong' } })).status, 401);
    assert.equal((await raw(server.port, { path: '/api/state', headers: { ...auth, host: 'evil.example:80' } })).status, 421);
    const ok = await raw(server.port, { path: '/api/state', headers: auth });
    assert.deepEqual(JSON.parse(ok.text), { ok: true, result: { hello: 'world' } });

    const form = await raw(server.port, { method: 'POST', path: '/api/settings', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
    assert.equal(form.status, 415);
    const saved = await raw(server.port, { method: 'POST', path: '/api/settings', headers: { ...auth, 'content-type': 'application/json' }, body: '{"mode":"live"}' });
    assert.equal(saved.status, 200);
    assert.deepEqual(app.calls, [['saveSettings', { mode: 'live' }]]);

    const failed = await raw(server.port, { method: 'POST', path: '/api/session/start', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(failed.status, 400);
    assert.deepEqual(JSON.parse(failed.text).fields, { bet: 'too small' });
  } finally {
    await server.close();
  }
});

test('the server serves the UI and shared modules, and nothing else from disk', async () => {
  const server = await startServer({ app: fakeApp() });
  const host = `127.0.0.1:${server.port}`;
  try {
    assert.equal((await raw(server.port, { path: '/ui/app.js', headers: { host } })).status, 200);
    assert.equal((await raw(server.port, { path: '/shared/web/explainer.js', headers: { host } })).status, 200);
    assert.equal((await raw(server.port, { path: '/shared/license.js', headers: { host } })).status, 404);
    assert.equal((await raw(server.port, { path: '/ui/../../package.json', headers: { host } })).status, 404);
    assert.equal((await raw(server.port, { path: '/ui/%2e%2e/%2e%2e/keys/license-private.pem', headers: { host } })).status, 404);
  } finally {
    await server.close();
  }
});

test('the event stream sends the state and reports how many windows are connected', async () => {
  const app = fakeApp();
  const server = await startServer({ app });
  const counts = [];
  server.clients.on('count', (n) => counts.push(n));
  try {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/events?token=${server.token}`, { signal: controller.signal });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /event: state\ndata: \{"hello":"world"\}/);
    app.emit('log', { time: 1, message: 'hi' });
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.match(next, /event: log/);
    controller.abort();
    await until(() => counts.at(-1) === 0);
    assert.deepEqual(counts, [1, 0]);
  } finally {
    await server.close();
  }
});

// ---------------- app ----------------

function makeApp({ api = {} } = {}) {
  const dataDir = tempDir();
  const licenses = new LicenseStore(dataDir, { publicKey, machine: MACHINE });
  const controller = Object.assign(new EventEmitter(), {
    logs: [],
    started: null,
    log(message) {
      this.logs.push({ time: Date.now(), message });
    },
    snapshot: () => ({ browser: 'closed', session: null, last: null }),
    start(args) {
      this.started = args;
    },
  });
  const opened = [];
  const app = new DesktopApp({
    dataDir,
    licenses,
    controller,
    api: { configured: true, ...api },
    open: (target) => opened.push(target),
    pollMs: 5,
  });
  return { app, licenses, controller, opened, dataDir };
}

test('settings are validated and saved; starting needs the notice accepted', async () => {
  const { app, controller, dataDir } = makeApp();
  assert.equal(app.state().settings.mode, 'dry-run');
  assert.equal(app.saveSettings({ plan: { ...DEFAULT_PLAN, bet: -1 } }).ok, false);
  assert.equal(app.saveSettings({ mode: 'practice', plan: { ...DEFAULT_PLAN, bet: '2.5' } }).ok, true);
  await assert.rejects(app.start({}), /accept the notice/);
  app.accept();
  await app.start({ mode: 'live', plan: { ...DEFAULT_PLAN, steps: 3 } });
  assert.equal(controller.started.mode, 'live');
  assert.equal(controller.started.plan.steps, 3);
  assert.equal(controller.started.plan.bet, 1); // the plan passed to start replaces the saved one
  const reloaded = new DesktopApp({ dataDir, licenses: app.licenses, controller, api: { configured: false } });
  assert.equal(reloaded.settings.accepted, true);
  assert.equal(reloaded.settings.mode, 'live');
});

test('paying with MoMo activates the subscription by itself', async () => {
  const paid = { id: 'order-1', status: 'PAID', license: licenseKey(30), expiresAt: new Date().toISOString() };
  let polls = 0;
  const { app } = makeApp({
    api: {
      createOrder: async (body) => {
        assert.deepEqual(body, { plan: 'month', phone: '7612 3456', machineId: MACHINE });
        return { id: 'order-1', status: 'PENDING', phone: '•••••••3456' };
      },
      order: async () => (++polls < 3 ? { id: 'order-1', status: 'PENDING' } : paid),
    },
  });
  assert.equal(app.state().license.state, 'none');
  await app.subscribe({ plan: 'month', phone: '7612 3456' });
  await assert.rejects(app.subscribe({ plan: 'month', phone: '7612 3456' }), /already waiting/);
  await until(() => app.state().license.state === 'active');
  assert.equal(app.state().subscription.order.status, 'PAID');
});

test('a declined payment is shown and activates nothing', async () => {
  const { app } = makeApp({
    api: {
      createOrder: async () => ({ id: 'o2', status: 'PENDING' }),
      order: async () => ({ id: 'o2', status: 'FAILED', message: 'The payment was declined on the phone.' }),
    },
  });
  await app.subscribe({ plan: 'week', phone: '76123456' });
  await until(() => app.state().subscription.order.status === 'FAILED');
  assert.equal(app.state().license.state, 'none');
});

test('restoring keeps the longest-lasting key issued to this computer', async () => {
  const { app } = makeApp({
    api: { licenses: async (machine) => ({ licenses: [{ key: licenseKey(7) }, { key: licenseKey(90) }, { key: licenseKey(30) }] }) },
  });
  const result = await app.restore();
  assert.equal(result.id, 'L90');
  const none = makeApp({ api: { licenses: async () => ({ licenses: [] }) } });
  await assert.rejects(none.app.restore(), /No subscription/);
});

test('links open only known places', () => {
  const { app, opened, dataDir } = makeApp();
  app.open('logs');
  assert.equal(opened[0], path.join(dataDir, 'logs'));
  assert.throws(() => app.open('file:///etc/passwd'), /Unknown link/);
});

// ---------------- controller ----------------

function fakeBrowser(url = PRODUCT.game.url) {
  const page = { current: url, url: () => page.current, goto: async (u) => (page.current = u), bringToFront: async () => {} };
  const context = Object.assign(new EventEmitter(), { pages: () => [page], close: async () => context.emit('close') });
  return { page, context };
}

function makeController({ license = 'none', url } = {}) {
  const { page, context } = fakeBrowser(url);
  const runs = [];
  const controller = new Controller({
    dataDir: tempDir(),
    licenses: { status: () => ({ state: license, message: 'Your subscription has ended.' }) },
    browsers: () => [{ channel: 'chrome' }],
    launch: async (args) => {
      runs.launch = args;
      return context;
    },
    run: (args) =>
      new Promise((resolve) => {
        runs.push({ args, finish: (r) => resolve({ reason: 'target reached', failed: false, file: 'x.csv', strategy: { bets: 1, wins: 1, chainsDone: 1, netCents: 90, ...r } }) });
      }),
  });
  return { controller, runs, page };
}

test('a session needs a valid plan, and live mode needs an active subscription', async () => {
  const { controller } = makeController();
  await assert.rejects(controller.start({ mode: 'dry-run', plan: { ...DEFAULT_PLAN, bet: 0 } }), (err) => Boolean(err.fields?.bet));
  await assert.rejects(controller.start({ mode: 'live', plan: DEFAULT_PLAN }), (err) => err.needsLicense && /needs a subscription/.test(err.message));
  const expired = makeController({ license: 'expired' }).controller;
  await assert.rejects(expired.start({ mode: 'live', plan: DEFAULT_PLAN }), /ended/);
});

test('a session runs in the game window, tracks bets, and stops on request', async () => {
  const { controller, runs } = makeController({ license: 'active' });
  await controller.start({ mode: 'live', plan: DEFAULT_PLAN });
  await assert.rejects(controller.start({ mode: 'live', plan: DEFAULT_PLAN }), /already running/);
  assert.equal(runs.launch.browser, 'chrome');
  const { args, finish } = runs[0];
  assert.equal(args.options.live, true);
  assert.equal(args.options.betCents, 100);
  args.onBet({ step: 1, stake: 100, crash: 2.1, won: true, payoutCents: 190, net: 90, how: 'cashed out' }, { bets: 1, wins: 1, chainsDone: 0, netCents: 90, step: 1, stakeCents: 190 });
  assert.equal(controller.snapshot().session.nextStakeCents, 190);
  assert.equal(controller.snapshot().session.bets.length, 1);
  controller.stop();
  assert.equal(args.control.stopRequested, true);
  assert.equal(controller.snapshot().session.status, 'stopping');
  finish();
  await until(() => controller.snapshot().session === null);
  assert.equal(controller.snapshot().last.reason, 'target reached');
});

test('practice mode switches to the play-money page and refuses real-money pages', async () => {
  const { controller, runs, page } = makeController();
  await controller.start({ mode: 'practice', plan: DEFAULT_PLAN });
  assert.ok(page.url().includes(PRODUCT.game.demoMarker), 'navigated to the demo game');
  const guard = runs[0].args.beforeBet;
  assert.equal(guard({ page: () => ({ url: () => PRODUCT.game.demoUrl }) }), null);
  assert.match(guard({ page: () => ({ url: () => PRODUCT.game.url }) }), /play-money/);
  assert.equal(runs[0].args.options.live, true); // practice clicks for real, on play money
  runs[0].finish();
});

test('dry runs never click', async () => {
  const { controller, runs } = makeController();
  await controller.start({ mode: 'dry-run', plan: DEFAULT_PLAN });
  assert.equal(runs[0].args.options.live, false);
  assert.equal(runs[0].args.beforeBet, null);
  runs[0].finish();
});

// ---------------- website resources ----------------

test('selector fixes from the website apply only when genuinely signed and meant for this version', () => {
  const target = { balance: 'old', button: 'old-button' };
  const doc = signResource({ kind: 'selectors', version: 3, minAppVersion: '1.0.0', selectors: { balance: '.new-balance', nope: 'x', button: '' } }, privateKey);
  assert.match(applySelectors(doc, { publicKey, appVersion: '1.0.0', target }), /1 updated/);
  assert.deepEqual(target, { balance: '.new-balance', button: 'old-button' });

  const tampered = { ...doc, payload: { ...doc.payload, selectors: { balance: '.evil' } } };
  assert.match(applySelectors(tampered, { publicKey, appVersion: '1.0.0', target }), /not valid/);
  assert.equal(target.balance, '.new-balance');
  const future = signResource({ ...doc.payload, minAppVersion: '2.0.0' }, privateKey);
  assert.match(applySelectors(future, { publicKey, appVersion: '1.0.0', target }), /needs version 2.0.0/);
  assert.match(applySelectors({ payload: doc.payload }, { publicKey, appVersion: '1.0.0', target }), /no signature/);
});

test('version comparison', () => {
  assert.equal(isNewer('1.0.10', '1.0.9'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('0.9.9', '1.0.0'), false);
  assert.equal(isNewer('2.0', '1.9.9'), true);
});
