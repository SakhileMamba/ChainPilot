#!/usr/bin/env node
// ChainPilot desktop app (what the Windows installer runs). It serves the control
// panel on 127.0.0.1, shows it in an app window, and runs the bot when asked.
// Only one copy runs at a time: starting it again reopens the window.
//
//   node desktop/main.js              start
//   node desktop/main.js --no-window  start without opening the window (prints its address)
//   node desktop/main.js --self-test  check that this installation can run, then exit
//   node desktop/main.js --version
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { LicenseStore, loadPublicKey, machineId, osMachineId } from '../src/license.js';
import { normalizeMachineId } from '../src/license-format.js';
import { PRODUCT, VERSION } from '../src/product.js';
import { DesktopApp } from './app.js';
import { findBrowsers, openAppWindow } from './browsers.js';
import { Controller } from './controller.js';
import { dataDir } from './paths.js';
import { startServer } from './server.js';
import { SubscriptionApi } from './subscription.js';

const { values: args } = parseArgs({
  options: {
    version: { type: 'boolean' },
    'self-test': { type: 'boolean' },
    'no-window': { type: 'boolean' },
    port: { type: 'string', default: '0' },
  },
});
if (args.version) {
  console.log(VERSION);
  process.exit(0);
}

const dir = dataDir();
mkdirSync(dir, { recursive: true });
if (args['self-test']) process.exit(await selfTest(dir));

process.title = PRODUCT.name;
const lockFile = path.join(dir, 'instance.json');
const uiProfile = path.join(dir, 'ui-profile');

const running = await runningInstance(lockFile);
if (running) {
  console.log(`${PRODUCT.name} is already running - showing its window.`);
  openAppWindow(running.url, { profileDir: uiProfile });
  process.exit(0);
}

const logFile = path.join(dir, 'app.log');
rotate(logFile);
const say = (message) => {
  const line = `[${new Date().toLocaleString('en-GB')}] ${message}`;
  console.log(line);
  try {
    appendFileSync(logFile, line + '\n');
  } catch {}
};

const licenses = new LicenseStore(dir);
const controller = new Controller({ dataDir: dir, licenses });
controller.on('log', (line) => say(line.message));
// CHAINPILOT_API_URL points the app at another license server, e.g. tools/dev-api.js.
const api = new SubscriptionApi(process.env.CHAINPILOT_API_URL || PRODUCT.apiUrl);
const app = new DesktopApp({ dataDir: dir, licenses, controller, api });
const server = await startServer({ app, port: Number(args.port) || 0 });
writeFileSync(lockFile, JSON.stringify({ pid: process.pid, port: server.port, token: server.token, url: server.url }));

console.log(`
  ${PRODUCT.name} ${VERSION}
  The control panel opens in its own window. If it doesn't, open this address in Chrome or Edge:
  ${server.url}

  Keep this window open while ${PRODUCT.name} runs. Closing the control panel quits ${PRODUCT.name}.
`);
say(`Started. Data folder: ${dir}`);
const ui = args['no-window'] ? null : openAppWindow(server.url, { profileDir: uiProfile });
app.refreshRemote().catch(() => {});
setInterval(() => app.refreshRemote().catch(() => {}), 6 * 3_600_000).unref();

let quitting = null;
function quit(why) {
  quitting ??= (async () => {
    say(`Closing (${why}).${controller.session ? ' Letting the bet in the air settle first...' : ''}`);
    await controller.shutdown();
    await server.close();
    rmSync(lockFile, { force: true });
    try {
      ui?.kill();
    } catch {}
    process.exit(0);
  })();
  return quitting;
}
app.on('quit', () => quit('quit from the control panel'));

// Closing the control panel window quits too. A short grace period covers reloads.
let everConnected = false;
let closeTimer = null;
server.clients.on('count', (count) => {
  if (count > 0) {
    everConnected = true;
    clearTimeout(closeTimer);
    closeTimer = null;
  } else if (everConnected && !closeTimer) {
    closeTimer = setTimeout(() => quit('the control panel was closed'), 15_000);
  }
});

let interrupts = 0;
process.on('SIGINT', () => {
  if (++interrupts > 1) process.exit(130);
  quit('Ctrl+C - press it again to quit at once');
});
process.on('SIGTERM', () => quit('asked to stop'));
// Windows sends SIGHUP when this console window is closed, and ends the process a few
// seconds later. A bet in the air still cashes out: Auto Cash Out runs on the game's server.
process.on('SIGHUP', () => {
  rmSync(lockFile, { force: true });
  controller.context?.close().catch(() => {});
  setTimeout(() => process.exit(0), 2000);
});

/** The copy already running (if its lock file is fresh and it answers), or null. */
async function runningInstance(file) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, 'utf8'));
    process.kill(lock.pid, 0); // throws if no such process
    const res = await fetch(`http://127.0.0.1:${lock.port}/api/ping`, {
      headers: { 'x-token': lock.token },
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return lock;
  } catch {}
  rmSync(file, { force: true });
  return null;
}

function rotate(file) {
  try {
    if (statSync(file).size > 2_000_000) renameSync(file, file.replace(/\.log$/, '.old.log'));
  } catch {}
}

/** Checks that this installation can work on this computer. Prints a report; resolves the exit code. */
async function selfTest(base) {
  let failed = false;
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      console.log(`ok   ${name}${detail ? ` - ${detail}` : ''}`);
    } catch (err) {
      failed = true;
      console.log(`FAIL ${name} - ${err.message}`);
    }
  };
  console.log(`${PRODUCT.name} ${VERSION} self-test (Node ${process.version}, ${process.platform} ${process.arch})`);
  await check('data folder is writable', () => {
    const probe = path.join(base, 'self-test.tmp');
    writeFileSync(probe, 'ok');
    rmSync(probe);
    return base;
  });
  await check('machine ID', () => {
    if (!osMachineId()) throw new Error("couldn't read the computer's ID from the operating system");
    const id = machineId(base);
    if (normalizeMachineId(id) !== id) throw new Error(`malformed: ${id}`);
    return id;
  });
  await check('license public key', () => {
    if (!loadPublicKey()) throw new Error('missing - run "npm run keys" before building');
  });
  const browsers = findBrowsers();
  await check('Chrome or Edge installed', () => {
    if (!browsers.length) throw new Error('neither was found');
    return browsers.map((b) => `${b.channel} (${b.path})`).join(', ');
  });
  await check('browser automation', async () => {
    const { chromium } = await import('playwright-core');
    const profile = await mkdtemp(path.join(os.tmpdir(), 'chainpilot-test-'));
    const context = await chromium.launchPersistentContext(profile, { channel: browsers[0]?.channel ?? 'msedge', headless: true });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.setContent('<p id="x">ready</p>');
      return `${browsers[0]?.channel ?? 'msedge'} answered "${await page.textContent('#x')}"`;
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
  await check('control panel server', async () => {
    const stub = Object.assign(new (await import('node:events')).EventEmitter(), { state: () => ({ ok: true }) });
    const s = await startServer({ app: stub });
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/state`, { headers: { 'x-token': s.token } });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const page = await fetch(`http://127.0.0.1:${s.port}/`);
      if (!(await page.text()).includes('<title>')) throw new Error('UI files are missing');
      return `port ${s.port}`;
    } finally {
      await s.close();
    }
  });
  console.log(failed ? 'Self-test FAILED' : 'Self-test passed');
  return failed ? 1 : 0;
}
