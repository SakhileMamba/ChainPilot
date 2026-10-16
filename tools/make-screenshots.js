#!/usr/bin/env node
// Captures the control panel for the website: site/assets/screenshot-play.png.
// Runs the real app (no window) on a temporary data folder and photographs it with Chrome.
//   npm run screenshots
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { ROOT } from './lib/sign.js';

const data = mkdtempSync(path.join(os.tmpdir(), 'chainpilot-shots-'));
writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ accepted: true, mode: 'dry-run', plan: { bet: 10, cashout: 1.9, steps: 5, chains: 1, maxLoss: 100, maxGap: 1, maxMinutes: 60 } }));
const app = spawn(process.execPath, [path.join(ROOT, 'desktop', 'main.js'), '--no-window'], {
  env: { ...process.env, CHAINPILOT_DATA_DIR: data },
  stdio: 'ignore',
});

try {
  let lock;
  for (let i = 0; i < 50 && !lock; i++) {
    await sleep(200);
    try {
      lock = JSON.parse(readFileSync(path.join(data, 'instance.json'), 'utf8'));
    } catch {}
  }
  if (!lock) throw new Error('the app did not start');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
  await page.goto(lock.url);
  await page.waitForSelector('#glance h3');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ROOT, 'site', 'assets', 'screenshot-play.png') });
  await browser.close();
  await fetch(`http://127.0.0.1:${lock.port}/api/quit`, { method: 'POST', headers: { 'x-token': lock.token, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  console.log('Wrote site/assets/screenshot-play.png');
} finally {
  app.kill();
  rmSync(data, { recursive: true, force: true });
}
