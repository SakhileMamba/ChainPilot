// A stand-in for the casino while the tutorial is recorded: the controller's game
// window and session runner are replaced by a simulation that draws rounds from the
// same crash distribution the simulator uses (P(crash >= m) = rtp / m), with a fixed
// seed so every render is the same. The seed is not chosen for a flattering result.
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCsv } from '../../src/session.js';
import { Strategy, money, payoutCents, randomCrash, signed } from '../../src/strategy.js';

/** Small seeded random number generator (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Replaces launchBrowser: a game "window" that only remembers its address. */
export async function fakeLaunch({ url }) {
  const page = { current: url, url: () => page.current, goto: async (u) => (page.current = u), bringToFront: async () => {} };
  const context = Object.assign(new EventEmitter(), {
    pages: () => [page],
    newPage: async () => page,
    close: async () => context.emit('close'),
  });
  return context;
}

/** Replaces runSession: plays simulated rounds every `roundMs` until the plan or the user stops it. */
export function simulatedRun({ seed = 1, rtp = 0.97, roundMs = 1400 } = {}) {
  const random = seededRandom(seed);
  return async ({ options, control, log, logDir, onBet }) => {
    const strategy = new Strategy({ ...options, random });
    const csv = openCsv(logDir, options.mode ?? 'dry-run');
    const done = (reason) => ({ reason, failed: false, strategy, file: csv.file });
    log('Found the game (simulated rounds for this video).');
    log(`First bet panel ready: Auto Cash Out at ${options.cashout.toFixed(2)}x.`);
    for (;;) {
      const reason = strategy.stopReason();
      if (reason) return done(reason);
      for (let t = 0; t < roundMs; t += 100) {
        if (control.stopRequested) return done('stopped by you');
        await sleep(100);
      }
      const stake = strategy.stakeCents;
      const step = strategy.step + 1;
      const crash = randomCrash(rtp, random);
      const won = crash >= options.cashout;
      const payout = won ? payoutCents(stake, options.cashout) : 0;
      strategy.record(won, payout);
      const r = { step, stake, crash, won, payoutCents: payout, how: 'dry run', net: strategy.netCents };
      csv.write(r);
      log(`Paper bet ${money(stake)} (step ${step}/${options.steps}) | crashed at ${crash.toFixed(2)}x | ${won ? `WON ${money(payout)}` : 'LOST'} | net ${signed(strategy.netCents)}`);
      onBet(r, strategy);
    }
  };
}
