// The plan a session follows, as set in the app: the rules for each setting and
// the conversion to Strategy options. Pure, so the browser UI uses it too.
import { toCents } from './strategy.js';

/** dry-run: watch and paper-trade. practice: real clicks on the game's play-money mode. live: real money. */
export const MODES = ['dry-run', 'practice', 'live'];

export const DEFAULT_PLAN = Object.freeze({
  bet: 1,
  cashout: 1.9,
  steps: 5,
  chains: 1,
  maxLoss: 10,
  maxGap: 1,
  maxMinutes: 60,
});

const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Check a plan typed into the app. Returns { ok, plan, errors } where plan has
 * numbers rounded the way the bot uses them and errors maps a field to a message.
 */
export function validatePlan(input = {}) {
  const read = (name) => (input[name] === '' || input[name] == null ? NaN : Number(input[name]));
  const plan = Object.fromEntries(Object.keys(DEFAULT_PLAN).map((name) => [name, read(name)]));
  const errors = {};
  if (!(plan.bet >= 0.01 && plan.bet <= 1_000_000)) errors.bet = 'Enter an amount of at least 0.01.';
  if (!(plan.cashout >= 1.01 && plan.cashout <= 100)) errors.cashout = 'Enter a multiplier from 1.01 to 100.';
  if (!whole(plan.steps, 1, 30)) errors.steps = 'Enter a whole number from 1 to 30.';
  if (!whole(plan.chains, 0, 1000)) errors.chains = 'Enter a whole number (0 = no target).';
  if (!whole(plan.maxGap, 1, 50)) errors.maxGap = 'Enter a whole number from 1 to 50.';
  if (!whole(plan.maxMinutes, 0, 1440)) errors.maxMinutes = 'Enter minutes from 0 (no limit) to 1440.';
  if (!(plan.maxLoss > 0 && plan.maxLoss <= 10_000_000)) errors.maxLoss = 'Enter the most you are willing to lose.';
  else if (!errors.bet && toCents(plan.maxLoss) < toCents(plan.bet)) errors.maxLoss = 'Must be at least the initial bet.';
  if (!errors.bet) plan.bet = toCents(plan.bet) / 100;
  if (!errors.cashout) plan.cashout = toCents(plan.cashout) / 100;
  if (!errors.maxLoss) plan.maxLoss = toCents(plan.maxLoss) / 100;
  return { ok: Object.keys(errors).length === 0, plan, errors };
}

/** Options for `new Strategy(...)` from a validated plan. */
export function strategyOptions(plan) {
  return {
    betCents: toCents(plan.bet),
    steps: plan.steps,
    cashout: plan.cashout,
    maxGap: plan.maxGap,
    chains: plan.chains,
    maxLossCents: toCents(plan.maxLoss),
  };
}
