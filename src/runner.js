// The session loop: sit out the random gap, place one bet (or, in a dry run,
// just watch the round), book the result, and repeat until the plan says stop.
import { decideOutcome, money, payoutCents, signed } from './strategy.js';

// Bet errors that won't fix themselves by trying again next round.
const FATAL = /stake too (high|low)|invalid stake/i;

/** Runs until the strategy's stop rules (or an error) end the session; returns the reason. */
export async function run({
  game,
  strategy,
  live,
  log,
  record = () => {},
  retryHint = 'Press Enter here to try again sooner, or Ctrl+C to quit.',
}) {
  const target = strategy.cashout;
  let failures = 0;
  let gapDue = false; // the random gap goes between bets, not before the first one or a retry
  for (;;) {
    const reason = strategy.stopReason();
    if (reason) return reason;
    if (gapDue) {
      const gap = strategy.nextGap();
      if (gap > 1) {
        log(`Sitting out ${gap - 1} round${gap > 2 ? 's' : ''}.`);
        await game.skipRounds(gap - 1);
      }
      gapDue = false;
    }

    const stake = strategy.stakeCents;
    const step = strategy.step + 1;
    let crash;
    let outcome;
    if (live) {
      const seen = await game.bet(stake, target);
      if (seen.error) {
        log(`Bet of ${money(stake)} not placed: ${seen.error}.`);
        if (seen.deposit) {
          log(
            `Deposit to carry on - you can leave the game page to do it, then come back to Aviator. ` +
              `The bot continues by itself once the game shows at least ${money(stake)}. ` +
              retryHint,
          );
          const how = await game.waitForDeposit(stake);
          log(how === 'enter' ? 'Trying again...' : `Balance is ${game.last.balance.toFixed(2)} now - carrying on.`);
          continue;
        }
        if (seen.limit != null && strategy.step > 0) {
          log(`Can't reinvest ${money(stake)} - keeping the winnings and starting over from ${money(strategy.betCents)}.`);
          strategy.reset();
          continue;
        }
        if (seen.fatal || seen.limit != null || FATAL.test(seen.error)) return `can't bet ${money(stake)}: ${seen.error}`;
        if (++failures >= 3) return '3 bets in a row could not be placed';
        continue;
      }
      failures = 0;
      crash = seen.crash;
      outcome = decideOutcome(seen, stake, target);
    } else {
      ({ crash } = await game.watchRound());
      const won = crash != null && crash >= target;
      outcome = { won, payoutCents: won ? payoutCents(stake, target) : 0, how: 'dry run' };
    }

    const result = strategy.record(outcome.won, outcome.payoutCents);
    const next =
      result === 'chain'
        ? `CHAIN COMPLETE (${strategy.chainsDone}${strategy.chains ? `/${strategy.chains}` : ''})`
        : result === 'win'
          ? `next bet ${money(strategy.stakeCents)}`
          : `back to ${money(strategy.betCents)}`;
    log(
      `${live ? 'Bet' : 'Paper bet'} ${money(stake)} (step ${step}/${strategy.steps}) | ` +
        `crashed at ${crash != null ? `${crash.toFixed(2)}x` : '?'} | ` +
        `${outcome.won ? `WON ${money(outcome.payoutCents)}` : 'LOST'} | ${next} | net ${signed(strategy.netCents)}`,
    );
    if (live && outcome.how !== 'cashed out' && outcome.how !== 'crashed before target') {
      log(`(result read from: ${outcome.how})`);
    }
    record({ step, stake, crash, ...outcome, net: strategy.netCents });
    gapDue = true;
  }
}
