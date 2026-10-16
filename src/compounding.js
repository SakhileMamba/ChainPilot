// The maths behind the compounding plan, for the strategy explainer in the app and
// on the website. Pure functions, no DOM.
//
// A chain: bet the initial stake; after a win, bet the whole payout again; after
// `steps` wins in a row the chain is complete. A loss at any step costs exactly the
// initial stake (everything above it was winnings from the same chain).
import { payoutCents, simulate } from './strategy.js';

/** Chance that one bet cashed out at `cashout` wins, when P(crash >= m) = rtp / m. */
export const winChance = (cashout, rtp) => Math.min(1, rtp / cashout);

/** One row per step: the stake (the previous payout), what it pays, and how likely the chain gets there. */
export function chainLadder({ betCents, steps, cashout, rtp }) {
  const p = winChance(cashout, rtp);
  const rows = [];
  let stake = betCents;
  for (let step = 1; step <= steps; step++) {
    const pays = payoutCents(stake, cashout);
    rows.push({
      step,
      stakeCents: stake,
      paysCents: pays,
      profitCents: pays - betCents, // if the chain ended with this win
      reachChance: p ** (step - 1), // the chain gets as far as placing this bet
      winChance: p ** step, // ...and this bet wins too
    });
    stake = pays;
  }
  return rows;
}

/**
 * Headline numbers for a plan ({ betCents, steps, cashout, rtp, maxLossCents, chains }).
 * goalChance is exact for a 1-chain goal; other goals need the simulator.
 */
export function planSummary(plan) {
  const { betCents, steps, cashout, rtp, maxLossCents, chains } = plan;
  const p = winChance(cashout, rtp);
  const ladder = chainLadder(plan);
  const fullPaysCents = ladder.at(-1).paysCents;
  const chainChance = p ** steps;
  // Each chain stops at its first loss, so it averages 1 + p + ... + p^(steps-1) bets.
  const betsPerChain = p === 1 ? steps : (1 - chainChance) / (1 - p);
  // A new chain only starts while one more lost chain keeps the loss within the limit.
  const attempts = Math.floor(maxLossCents / betCents);
  return {
    betWinChance: p,
    chainChance,
    fullPaysCents,
    chainProfitCents: fullPaysCents - betCents,
    // What a chain returns on average, as a share of its initial bet: about rtp^steps.
    avgReturn: (chainChance * fullPaysCents) / betCents,
    avgNetPerChainCents: chainChance * fullPaysCents - betCents,
    betsPerChain,
    chainsPerWin: 1 / chainChance, // attempts it takes, on average, to complete one chain
    attempts,
    goalChance: chains === 1 ? 1 - (1 - chainChance) ** attempts : null,
    houseEdge: 1 - rtp,
  };
}

/**
 * Simulate sessions in chunks so a page stays responsive. Calls onProgress(result)
 * after each chunk; stop early by returning false from it. Resolves with the final
 * result: { sessions, reachedGoal, avgBets, nets (sorted, cents) }.
 */
export async function simulateSessions(plan, { sessions = 4000, chunk = 250, maxBetsPerSession = 5000, onProgress } = {}) {
  const nets = [];
  let reachedGoal = 0;
  let bets = 0;
  while (nets.length < sessions) {
    const n = Math.min(chunk, sessions - nets.length);
    const r = simulate({ sessions: n, rtp: plan.rtp, plan, maxBetsPerSession });
    nets.push(...r.nets);
    reachedGoal += r.reachedGoal;
    bets += r.avgBets * n;
    const result = { sessions: nets.length, reachedGoal, avgBets: bets / nets.length, nets };
    if (onProgress && onProgress(result) === false) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  nets.sort((a, b) => a - b);
  return { sessions: nets.length, reachedGoal, avgBets: bets / nets.length, nets };
}

/** Summary statistics of sorted session results (cents). */
export function describeResults(nets) {
  const n = nets.length;
  const sum = nets.reduce((s, x) => s + x, 0);
  return {
    avg: sum / n,
    median: nets[Math.floor(n / 2)],
    worst: nets[0],
    best: nets[n - 1],
    lostShare: nets.filter((x) => x < 0).length / n,
    wonShare: nets.filter((x) => x > 0).length / n,
  };
}

/**
 * Group sorted results (cents) for a histogram. Few distinct outcomes (the usual
 * case: one per number of lost chains) get a column each; otherwise equal-width
 * bins, split at 0 so no bin mixes losses and gains.
 * Returns [{ from, to, count, sign }] with sign -1 (loss), 0 (break-even), 1 (gain).
 */
export function histogram(nets, maxBins = 24) {
  const counts = new Map();
  for (const x of nets) counts.set(x, (counts.get(x) ?? 0) + 1);
  const sign = (x) => Math.sign(x);
  if (counts.size <= maxBins) {
    return [...counts].sort((a, b) => a[0] - b[0]).map(([v, count]) => ({ from: v, to: v, count, sign: sign(v) }));
  }
  const lo = nets[0];
  const hi = nets.at(-1);
  const width = Math.max(1, Math.ceil((hi - lo) / maxBins));
  const bins = new Map();
  for (const x of nets) {
    // Bins are aligned to 0, so each one is entirely below, at, or above zero.
    const start = x === 0 ? 0 : x > 0 ? Math.floor((x - 1) / width) * width + 1 : -Math.ceil(-x / width) * width;
    const key = x === 0 ? '0' : String(start);
    const bin = bins.get(key) ?? { from: x === 0 ? 0 : start, to: x === 0 ? 0 : start + width - 1, count: 0, sign: sign(x) };
    bin.count += 1;
    bins.set(key, bin);
  }
  return [...bins.values()].sort((a, b) => a.from - b.from);
}
