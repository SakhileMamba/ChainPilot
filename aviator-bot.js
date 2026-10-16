#!/usr/bin/env node
// Aviator bot for mulasport.com, command-line version. See README.md, or run with --help.
// (The packaged Windows app is desktop/main.js; both run sessions through src/session.js.)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchBrowser, runSession } from './src/session.js';
import { money, payoutCents, signed, simulate, toCents } from './src/strategy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The site opens the game named by ?gameID=<slug> on any page; mode=demo opens practice mode.
const DEFAULT_URL = 'https://www.mulasport.com/?gameID=aviator-spribe&mode=real';

const USAGE = `Usage: node aviator-bot.js --bet <amount> --steps <n> [options]

Plays Aviator on mulasport.com: bets <amount>, cashes out automatically at the
--cashout multiplier, reinvests the whole payout after every win until <n> wins
in a row, and starts again from <amount> after any loss.

Required:
  --bet <amount>       initial stake, e.g. 10
  --steps <n>          wins in a row that complete a chain, e.g. 5

Options:
  --cashout <x>        cash-out multiplier (default 1.9)
  --max-gap <k>        after each bet, wait a random 1 to k rounds before the
                       next one; 1 = bet every round (default 1)
  --chains <c>         stop after c completed chains, 0 = never (default 1)
  --max-loss <amount>  stop before the session's net loss could go past this
                       (default 10 x --bet)
  --live               place real bets. Without it the bot only watches the
                       game and paper-trades (dry run)
  --simulate <runs>    no browser: play <runs> sessions on random rounds
  --rtp <percent>      return to player assumed by --simulate (default 97)
  --url <url>          page to open (default ${DEFAULT_URL})
  --browser <name>     chrome (your Google Chrome, default), msedge, or chromium
  --profile <dir>      browser profile folder that keeps you logged in
                       (default: .browser-profile next to this script)
  -h, --help           show this help

Examples:
  node aviator-bot.js --bet 10 --steps 5 --simulate 10000
  node aviator-bot.js --bet 10 --steps 5 --max-gap 3
  node aviator-bot.js --bet 10 --steps 5 --cashout 1.9 --max-gap 3 --live`;

function usageError(message) {
  console.error(`Error: ${message}\nRun with --help for usage.`);
  process.exit(2);
}

function parseOptions(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        bet: { type: 'string' },
        steps: { type: 'string' },
        cashout: { type: 'string', default: '1.9' },
        'max-gap': { type: 'string', default: '1' },
        chains: { type: 'string', default: '1' },
        'max-loss': { type: 'string' },
        live: { type: 'boolean', default: false },
        simulate: { type: 'string' },
        rtp: { type: 'string', default: '97' },
        url: { type: 'string', default: DEFAULT_URL },
        browser: { type: 'string', default: 'chrome' },
        profile: { type: 'string', default: path.join(HERE, '.browser-profile') },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    usageError(err.message);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const read = (name, rule, isValid) => {
    const raw = values[name];
    if (raw === undefined) usageError(`--${name} is required`);
    const value = Number(raw);
    if (!Number.isFinite(value) || !isValid(value)) usageError(`--${name} must be ${rule} (got "${raw}")`);
    return value;
  };
  const whole = (min) => (v) => Number.isInteger(v) && v >= min;

  const betCents = toCents(read('bet', 'an amount of at least 0.01', (v) => v >= 0.01));
  values['max-loss'] ??= money(betCents * 10);
  const options = {
    betCents,
    steps: read('steps', 'a whole number of at least 1', whole(1)),
    cashout: toCents(read('cashout', 'a multiplier from 1.01 to 100', (v) => v >= 1.01 && v <= 100)) / 100,
    maxGap: read('max-gap', 'a whole number of at least 1', whole(1)),
    chains: read('chains', 'a whole number of at least 0', whole(0)),
    maxLossCents: toCents(read('max-loss', `an amount of at least --bet`, (v) => toCents(v) >= betCents)),
    live: values.live,
    simulate: values.simulate === undefined ? 0 : read('simulate', 'a whole number of at least 1', whole(1)),
    rtp: read('rtp', 'a percentage above 0, up to 100', (v) => v > 0 && v <= 100) / 100,
    url: values.url,
    browser: values.browser,
    profile: path.resolve(values.profile),
  };
  if (!['chrome', 'msedge', 'chromium'].includes(options.browser)) usageError('--browser must be chrome, msedge or chromium');
  return options;
}

const log = (message) => console.log(`[${new Date().toLocaleTimeString('en-GB')}] ${message}`);
const percent = (x) => `${(100 * x).toFixed(x < 0.001 ? 4 : x < 0.1 ? 2 : 1)}%`;

function describePlan(o, mode) {
  let chainPays = o.betCents;
  for (let i = 0; i < o.steps; i++) chainPays = payoutCents(chainPays, o.cashout);
  const winChance = Math.min(1, o.rtp / o.cashout);
  console.log(`Aviator bot - ${mode}
  Bet ${money(o.betCents)}, cash out at ${o.cashout.toFixed(2)}x, reinvest the whole payout for ${o.steps} win(s) in a row (a full chain pays ${money(chainPays)})
  Any loss: back to ${money(o.betCents)} at step 1
  Bets: ${o.maxGap === 1 ? 'every round' : `a random 1 to ${o.maxGap} rounds apart`}
  Stops: ${o.chains ? `after ${o.chains} completed chain(s), or ` : ''}before the net loss could pass ${money(o.maxLossCents)}
  Odds at ${percent(o.rtp)} RTP: a bet wins ${percent(winChance)} of the time, a full chain ${percent(winChance ** o.steps)}; on average a chain returns ${percent(o.rtp ** o.steps)} of its stake
`);
}

async function play(o) {
  const control = { stopRequested: false, retryNow: false };
  process.on('SIGINT', () => {
    if (control.stopRequested) process.exit(130);
    control.stopRequested = true;
    log('Stopping - any bet in the air settles first. Press Ctrl+C again to quit at once.');
  });
  // Enter in the terminal: try again now (used while waiting for a deposit).
  const onEnter = () => {
    control.retryNow = true;
  };
  process.stdin.on('data', onEnter);

  let context;
  try {
    context = await launchBrowser({ profile: o.profile, browser: o.browser, url: o.url, log });
  } catch (err) {
    console.error(`${err.message}
Close any other window using ${o.profile}, or try --browser chromium (after: npx playwright-core install chromium).`);
    process.exit(1);
  }

  const { reason, failed, strategy, file } = await runSession({
    context,
    options: o,
    control,
    log,
    logDir: path.join(HERE, 'logs'),
  });
  if (failed) process.exitCode = 1;
  console.log(`
Session over - ${reason}
  bets ${strategy.bets} (won ${strategy.wins}, lost ${strategy.bets - strategy.wins}), chains completed ${strategy.chainsDone}
  net result ${signed(strategy.netCents)}${o.live ? '' : ' (paper money - dry run)'}
  log: ${path.relative(process.cwd(), file)}`);
  process.stdin.off('data', onEnter).pause();
  await context.close().catch(() => {});
}

const options = parseOptions(process.argv.slice(2));
if (options.simulate) {
  describePlan(options, `SIMULATION (${options.simulate} sessions, no browser, no money)`);
  const r = simulate({ sessions: options.simulate, rtp: options.rtp, plan: options });
  console.log(`Results:${options.chains ? `\n  reached the goal:            ${percent(r.reachedGoal / r.sessions)} of sessions` : ''}
  average result per session:  ${signed(r.avgNetCents)}
  median / best / worst:       ${signed(r.medianNetCents)} / ${signed(r.bestNetCents)} / ${signed(r.worstNetCents)}
  average bets per session:    ${r.avgBets.toFixed(1)}`);
} else {
  describePlan(options, options.live ? 'LIVE: placing real bets' : 'DRY RUN: watching only, no bets (add --live to bet)');
  await play(options);
}
