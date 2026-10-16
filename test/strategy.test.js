import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Strategy, decideOutcome, payoutCents, randomCrash, simulate } from '../src/strategy.js';

const plan = (extra = {}) => ({ betCents: 1000, steps: 3, cashout: 1.9, maxLossCents: 10_000, ...extra });

test('payouts are exact to the cent and never rounded up', () => {
  assert.equal(payoutCents(1000, 1.9), 1900);
  assert.equal(payoutCents(3610, 1.9), 6859); // 36.10 x 1.9 = 68.59 exactly, no float drift
  assert.equal(payoutCents(13032, 1.9), 24760); // 247.608 -> 247.60
});

test('a win reinvests the whole payout, a loss resets to the initial bet', () => {
  const s = new Strategy(plan());
  assert.equal(s.record(true, 1900), 'win');
  assert.equal(s.stakeCents, 1900);
  assert.equal(s.step, 1);
  assert.equal(s.record(false), 'loss');
  assert.equal(s.stakeCents, 1000);
  assert.equal(s.step, 0);
  assert.equal(s.netCents, -1000); // +9.00 then -19.00: a lost chain costs one initial bet
});

test('n wins in a row complete a chain and the session stops (default 1 chain)', () => {
  const s = new Strategy(plan());
  assert.equal(s.record(true, 1900), 'win');
  assert.equal(s.record(true, 3610), 'win');
  assert.equal(s.stopReason(), null);
  assert.equal(s.record(true, 6859), 'chain');
  assert.equal(s.netCents, 5859);
  assert.equal(s.stakeCents, 1000);
  assert.match(s.stopReason(), /target reached/);
});

test('chains: 0 keeps going after a completed chain', () => {
  const s = new Strategy(plan({ chains: 0, steps: 1 }));
  s.record(true, 1900);
  assert.equal(s.chainsDone, 1);
  assert.equal(s.stopReason(), null);
});

test('the loss limit is never exceeded and is only checked between chains', () => {
  const s = new Strategy(plan({ maxLossCents: 3000 }));
  for (let i = 0; i < 3; i++) {
    assert.equal(s.stopReason(), null);
    s.record(false);
  }
  assert.equal(s.netCents, -3000);
  assert.match(s.stopReason(), /loss limit/);

  const midChain = new Strategy(plan({ maxLossCents: 1000 }));
  midChain.record(false); // at the limit
  assert.match(midChain.stopReason(), /loss limit/);
  const riding = new Strategy(plan({ maxLossCents: 1000 }));
  riding.record(true, 1900); // betting its own winnings now: no new money at risk
  assert.equal(riding.stopReason(), null);
});

test('gaps are 1..maxGap rounds', () => {
  const values = [0, 0.2, 0.5, 0.999];
  const s = new Strategy(plan({ maxGap: 5, random: () => values.shift() }));
  assert.deepEqual([s.nextGap(), s.nextGap(), s.nextGap(), s.nextGap()], [1, 2, 3, 5]);
  assert.equal(new Strategy(plan()).nextGap(), 1);
});

test('decideOutcome', () => {
  const none = { cashedOut: false, toastCents: null, crash: null, deltaCents: null };
  const decide = (seen) => decideOutcome({ ...none, ...seen }, 1000, 1.9);

  assert.deepEqual(decide({ cashedOut: true, crash: 5 }), { won: true, payoutCents: 1900, how: 'cashed out' });
  assert.equal(decide({ toastCents: 1950 }).payoutCents, 1950); // the game's own figure wins
  assert.equal(decide({ cashedOut: true, toastCents: 950 }).payoutCents, 1900); // nonsense toast ignored
  assert.equal(decide({ crash: 1.89 }).won, false);
  assert.equal(decide({ crash: 1.89, deltaCents: 900 }).won, false); // crash below target wins over a balance blip
  assert.equal(decide({ crash: 2.5 }).won, true); // auto cash-out fired between two reads
  assert.equal(decide({ crash: 2.5, deltaCents: -1000 }).won, false); // ...unless the balance says it didn't
  assert.deepEqual(decide({ crash: 1.9, deltaCents: 900 }), { won: true, payoutCents: 1900, how: 'balance went up' });
  assert.equal(decide({ crash: 1.9, deltaCents: 5000 }).payoutCents, 1900); // never above stake x target
  assert.equal(decide({ crash: 1.9 }).won, false); // can't tell -> treat as a loss
});

test('random crashes follow P(crash >= m) = rtp / m', () => {
  let wins = 0;
  const n = 200_000;
  for (let i = 0; i < n; i++) if (randomCrash(0.97) >= 1.9) wins += 1;
  assert.ok(Math.abs(wins / n - 0.97 / 1.9) < 0.005, `win rate ${wins / n}`);
});

test('simulation ends every session and reports the spread', () => {
  const r = simulate({ sessions: 2000, rtp: 0.97, plan: plan() });
  assert.equal(r.sessions, 2000);
  assert.ok(r.reachedGoal > 0 && r.reachedGoal < 2000);
  assert.ok(r.worstNetCents >= -10_000, 'the loss limit holds in every session');
  assert.ok(r.worstNetCents <= r.medianNetCents && r.medianNetCents <= r.bestNetCents);
});
