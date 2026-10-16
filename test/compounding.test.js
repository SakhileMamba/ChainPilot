import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainLadder, describeResults, histogram, planSummary, simulateSessions, winChance } from '../src/compounding.js';
import { DEFAULT_PLAN, strategyOptions, validatePlan } from '../src/plan.js';

const plan = { betCents: 1000, steps: 5, cashout: 1.9, rtp: 0.97, maxLossCents: 10_000, chains: 1 };

test('the ladder compounds the whole payout, to the cent', () => {
  const rows = chainLadder(plan);
  assert.deepEqual(
    rows.map((r) => [r.stakeCents, r.paysCents]),
    [
      [1000, 1900],
      [1900, 3610],
      [3610, 6859],
      [6859, 13032],
      [13032, 24760],
    ],
  );
  const p = 0.97 / 1.9;
  assert.equal(rows[0].reachChance, 1);
  assert.ok(Math.abs(rows[4].reachChance - p ** 4) < 1e-12);
  assert.ok(Math.abs(rows[4].winChance - p ** 5) < 1e-12);
});

test('the summary: chance, payout, average return and the chance to reach a 1-chain goal', () => {
  const s = planSummary(plan);
  const p = 0.97 / 1.9;
  assert.ok(Math.abs(s.chainChance - p ** 5) < 1e-12);
  assert.equal(s.fullPaysCents, 24760);
  assert.equal(s.chainProfitCents, 23760);
  assert.ok(Math.abs(s.avgReturn - 0.97 ** 5) < 0.005); // cent rounding makes it a touch lower
  assert.equal(s.attempts, 10);
  assert.ok(Math.abs(s.goalChance - (1 - (1 - p ** 5) ** 10)) < 1e-12);
  assert.ok(Math.abs(s.betsPerChain - (1 - p ** 5) / (1 - p)) < 1e-12);
  assert.equal(planSummary({ ...plan, chains: 0 }).goalChance, null);
  assert.equal(winChance(1.01, 1), 1 / 1.01);
  assert.equal(winChance(0.5, 0.97), 1); // capped
});

test('the simulator agrees with the exact chance of reaching the goal', async () => {
  const result = await simulateSessions(plan, { sessions: 20_000, chunk: 5000 });
  const exact = planSummary(plan).goalChance;
  assert.equal(result.sessions, 20_000);
  assert.ok(Math.abs(result.reachedGoal / result.sessions - exact) < 0.015, `${result.reachedGoal / result.sessions} vs ${exact}`);
  const stats = describeResults(result.nets);
  assert.ok(stats.worst >= -10_000, 'the loss limit holds');
  assert.ok(stats.avg < 0, 'the average session loses');
});

test('histogram: one column per outcome when there are few, sign-pure bins otherwise', () => {
  const few = histogram([-100, -100, -100, 50, 237, 237]);
  assert.deepEqual(
    few.map((b) => [b.from, b.count, b.sign]),
    [
      [-100, 3, -1],
      [50, 1, 1],
      [237, 2, 1],
    ],
  );
  const many = Array.from({ length: 1000 }, (_, i) => i * 7 - 3000);
  const bins = histogram(many, 10);
  assert.equal(
    bins.reduce((n, b) => n + b.count, 0),
    1000,
  );
  for (const b of bins) {
    assert.ok(b.from <= b.to);
    assert.ok(b.sign < 0 ? b.to < 0 : b.sign > 0 ? b.from > 0 : b.from === 0 && b.to === 0, `bin ${b.from}..${b.to} mixes signs`);
  }
});

test('plan validation rounds like the bot and explains each mistake', () => {
  const ok = validatePlan({ ...DEFAULT_PLAN, bet: '2.005', cashout: '1.899' });
  assert.equal(ok.ok, true);
  assert.equal(ok.plan.bet, 2.01);
  assert.equal(ok.plan.cashout, 1.9);
  assert.deepEqual(strategyOptions(ok.plan), { betCents: 201, steps: 5, cashout: 1.9, maxGap: 1, chains: 1, maxLossCents: 1000 });

  const bad = validatePlan({ bet: '0', cashout: '1', steps: '2.5', chains: '-1', maxLoss: '5', maxGap: '0', maxMinutes: 'x' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['bet', 'cashout', 'chains', 'maxGap', 'maxMinutes', 'steps']);
  assert.match(validatePlan({ ...DEFAULT_PLAN, bet: 10, maxLoss: 5 }).errors.maxLoss, /at least the initial bet/);
  assert.equal(validatePlan({ ...DEFAULT_PLAN, steps: 31 }).ok, false);
});
