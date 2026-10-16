// The betting plan and the money maths. No browser code here, so it is
// unit-tested (test/strategy.test.js) and shared with the offline simulator.

/** Money is kept in integer cents so that 36.10 x 1.90 is exactly 68.59. */
export const toCents = (amount) => Math.round(Number(amount) * 100);
export const money = (cents) => (cents / 100).toFixed(2);
export const signed = (cents) => (cents > 0 ? '+' : cents < 0 ? '-' : '') + money(Math.abs(cents));

/** What a stake pays when cashed out at `multiplier`, cut down to whole cents. */
export function payoutCents(stakeCents, multiplier) {
  return Math.floor((stakeCents * Math.round(multiplier * 100)) / 100);
}

/**
 * Start with the initial bet. After a win, bet the whole payout again; `steps`
 * wins in a row complete a chain. Any loss starts over from the initial bet.
 */
export class Strategy {
  constructor({ betCents, steps, cashout, maxGap = 1, chains = 1, maxLossCents = Infinity, random = Math.random }) {
    Object.assign(this, { betCents, steps, cashout, maxGap, chains, maxLossCents, random });
    this.step = 0; // wins so far in the current chain
    this.stakeCents = betCents; // the next bet
    this.netCents = 0; // session profit (+) or loss (-)
    this.chainsDone = 0;
    this.bets = 0;
    this.wins = 0;
  }

  /** Rounds from now to place the next bet: 1 = the very next round, k = sit out k-1 rounds. */
  nextGap() {
    return 1 + Math.floor(this.random() * this.maxGap);
  }

  /** Why the session should end before the next bet, or null to carry on. */
  stopReason() {
    if (this.chains > 0 && this.chainsDone >= this.chains) {
      return `target reached: ${this.chainsDone} chain(s) of ${this.steps} win(s)`;
    }
    // A chain in progress only bets its own winnings (losing it costs exactly one
    // initial bet), so the loss limit is checked when a new chain would start.
    if (this.step === 0 && this.betCents - this.netCents > this.maxLossCents) {
      return `loss limit: another lost chain could take the loss past ${money(this.maxLossCents)}`;
    }
    return null;
  }

  /** Book a settled bet. Returns 'win', 'loss', or 'chain' for the win that completes a chain. */
  record(won, payout = 0) {
    const stake = this.stakeCents;
    this.bets += 1;
    if (!won) {
      this.netCents -= stake;
      this.reset();
      return 'loss';
    }
    this.wins += 1;
    this.netCents += payout - stake;
    this.step += 1;
    if (this.step >= this.steps) {
      this.chainsDone += 1;
      this.reset();
      return 'chain';
    }
    this.stakeCents = payout; // reinvest the whole payout
    return 'win';
  }

  /** Go back to the initial bet at step 0 (any winnings already booked are kept). */
  reset() {
    this.step = 0;
    this.stakeCents = this.betCents;
  }
}

/**
 * Decide a live bet from what was seen during its round:
 *   cashedOut  - the bet panel went back to "Bet" while the plane was still flying
 *   toastCents - payout shown by a "You have cashed out!" toast, or null
 *   crash      - the round's crash multiplier, or null if it wasn't seen
 *   deltaCents - balance after the round minus balance before the bet, or null
 * Payouts are never taken above stake x target unless the game itself showed
 * them, so a misread can't make the next bet bigger than the real winnings.
 */
export function decideOutcome({ cashedOut, toastCents, crash, deltaCents }, stakeCents, target) {
  const expected = payoutCents(stakeCents, target);
  if (cashedOut || toastCents != null) {
    // A payout is never below the stake (multipliers start at 1.00x); ignore a toast that says otherwise.
    const shown = toastCents != null && toastCents >= stakeCents ? toastCents : null;
    return { won: true, payoutCents: shown ?? expected, how: 'cashed out' };
  }
  if (crash != null && crash < target) return { won: false, payoutCents: 0, how: 'crashed before target' };
  // The plane reached the target (or the crash wasn't seen) but no cash-out was seen.
  if (deltaCents === -stakeCents) return { won: false, payoutCents: 0, how: 'balance shows no payout' };
  if (deltaCents != null && deltaCents > 0) {
    return { won: true, payoutCents: Math.min(stakeCents + deltaCents, expected), how: 'balance went up' };
  }
  if (crash != null && crash > target) return { won: true, payoutCents: expected, how: 'crashed after target' };
  return { won: false, payoutCents: 0, how: 'unclear - treated as a loss' };
}

/** A crash point from the usual crash-game distribution: P(crash >= m) = rtp / m. */
export function randomCrash(rtp, random = Math.random) {
  return Math.max(1, Math.floor((100 * rtp) / (1 - random())) / 100);
}

/** Play `sessions` independent sessions against random rounds and summarise them. */
export function simulate({ sessions, rtp, plan, maxBetsPerSession = 100_000 }) {
  const nets = [];
  let reachedGoal = 0;
  let totalBets = 0;
  for (let i = 0; i < sessions; i++) {
    const s = new Strategy(plan);
    while (!s.stopReason() && s.bets < maxBetsPerSession) {
      const won = randomCrash(rtp) >= s.cashout;
      s.record(won, won ? payoutCents(s.stakeCents, s.cashout) : 0);
    }
    if (s.chains > 0 && s.chainsDone >= s.chains) reachedGoal += 1;
    nets.push(s.netCents);
    totalBets += s.bets;
  }
  nets.sort((a, b) => a - b);
  return {
    sessions,
    reachedGoal,
    avgNetCents: nets.reduce((sum, n) => sum + n, 0) / sessions,
    medianNetCents: nets[Math.floor(sessions / 2)],
    worstNetCents: nets[0],
    bestNetCents: nets[sessions - 1],
    avgBets: totalBets / sessions,
    nets, // every session's result, sorted (for histograms)
  };
}
