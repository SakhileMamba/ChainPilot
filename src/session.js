// One betting session from start to finish, shared by the command line
// (aviator-bot.js) and the desktop app: open the game browser, run the plan,
// write every bet to a CSV file.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { Game, Stopped } from './game.js';
import { run } from './runner.js';
import { Strategy, money } from './strategy.js';

/**
 * Start a browser on a persistent profile (it keeps the casino login) and open `url`.
 * `browser` is a Playwright channel: chrome, msedge, or chromium (Playwright's own build).
 * Throws an Error with the first line of Playwright's message.
 */
export async function launchBrowser({ profile, browser = 'chrome', url, log }) {
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      channel: browser === 'chromium' ? undefined : browser,
      viewport: null,
      handleSIGINT: false, // the caller handles Ctrl+C so a bet in the air can settle first
    });
  } catch (err) {
    throw new Error(`Couldn't start the browser: ${err.message.split('\n')[0]}`);
  }
  if (url) {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((err) => {
      log(`Couldn't open ${url} (${err.message.split('\n')[0]}). Open the game yourself in the browser window.`);
    });
  }
  return context;
}

/** A CSV file in `dir` with one row per bet. */
export function openCsv(dir, mode) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${mode}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
  appendFileSync(file, 'time,step,stake,crash,result,payout,net,read_from\n');
  const write = (r) =>
    appendFileSync(
      file,
      [
        new Date().toISOString(),
        r.step,
        money(r.stake),
        r.crash?.toFixed(2) ?? '',
        r.won ? 'won' : 'lost',
        money(r.payoutCents),
        money(r.net),
        r.how,
      ].join(',') + '\n',
    );
  return { file, write };
}

/**
 * Play one session in an open browser `context` until the plan's stop rules, the
 * user (control.stopRequested) or an error end it.
 *   options    Strategy options plus `live`
 *   onBet      called with each settled bet (as written to the CSV) and the Strategy
 *   onWaiting  called with true/false around waiting for a deposit
 *   beforeBet  see Game
 * Returns { reason, failed, strategy, file }.
 */
export async function runSession({ context, options, control, log, logDir, onBet, onWaiting, beforeBet, retryHint }) {
  const strategy = new Strategy(options);
  const csv = openCsv(logDir, options.mode ?? (options.live ? 'live' : 'dry-run'));
  const game = new Game(context, { log, control, beforeBet });
  if (onWaiting) {
    const waitForDeposit = game.waitForDeposit.bind(game);
    game.waitForDeposit = async (stakeCents) => {
      onWaiting(true, stakeCents);
      try {
        return await waitForDeposit(stakeCents);
      } finally {
        onWaiting(false);
      }
    };
  }
  const record = (r) => {
    csv.write(r);
    onBet?.(r, strategy);
  };
  let reason;
  let failed = false;
  try {
    reason = await run({ game, strategy, live: options.live, log, record, retryHint });
  } catch (err) {
    if (err instanceof Stopped) reason = 'stopped by you';
    else {
      failed = true;
      reason = `error: ${err.message}`;
    }
  }
  return { reason, failed, strategy, file: csv.file };
}
