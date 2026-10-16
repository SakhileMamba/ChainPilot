// The compounding explainer: for a plan, how a chain grows, how likely each step
// is, what that means on average, and what thousands of simulated sessions look
// like. Used by the app's "How compounding works" tab and the website.
import { chainLadder, describeResults, histogram, planSummary, simulateSessions } from '../compounding.js';
import { DEFAULT_PLAN, strategyOptions, validatePlan } from '../plan.js';
import { renderResultsChart } from './charts.js';
import { fmtCount, fmtMoney, fmtPct, fmtSigned, h, oneIn } from './format.js';

const FIELDS = [
  { name: 'bet', label: 'Initial bet', step: '0.01', min: '0.01' },
  { name: 'cashout', label: 'Cash out at', step: '0.01', min: '1.01', max: '100', suffix: '×' },
  { name: 'steps', label: 'Wins per chain', step: '1', min: '1', max: '30' },
  { name: 'maxLoss', label: 'Loss limit', step: '0.01', min: '0.01' },
  { name: 'chains', label: 'Stop after', step: '1', min: '0', suffix: 'chains' },
];
const MAX_BETS = 5000; // per simulated session, for plans with no chain target

const tile = (label, value, note) =>
  h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), h('strong', { class: 'tile-value' }, value), note ? h('span', { class: 'tile-note' }, note) : null);

const meter = (p) =>
  h('span', { class: 'meter', 'aria-hidden': 'true' }, h('span', { class: 'meter-fill', style: `width:${Math.max(0.6, p * 100).toFixed(2)}%` }));

/**
 * Render into `root`. Options: plan (DEFAULT_PLAN fields), rtp, sessions to
 * simulate, and onUse(plan) to show a "Use these settings" button.
 * Returns { setPlan(plan) }.
 */
export function mountExplainer(root, { plan = DEFAULT_PLAN, rtp = 0.97, sessions = 4000, onUse } = {}) {
  let current = { ...DEFAULT_PLAN, ...plan };
  let generation = 0; // the latest simulation; older ones stop when they see it changed
  let chart = null;

  const inputs = {};
  const errors = {};
  const form = h(
    'form',
    { class: 'ex-controls', novalidate: true, onsubmit: (e) => e.preventDefault() },
    FIELDS.map((f) => {
      inputs[f.name] = h('input', {
        type: 'number',
        name: f.name,
        step: f.step,
        min: f.min,
        max: f.max,
        inputmode: 'decimal',
        value: current[f.name],
        'aria-describedby': `ex-error-${f.name}`,
      });
      errors[f.name] = h('small', { class: 'field-error', id: `ex-error-${f.name}` });
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label), h('span', { class: 'input' }, inputs[f.name], f.suffix ? h('em', {}, f.suffix) : null), errors[f.name]);
    }),
    onUse ? h('button', { type: 'button', class: 'btn', onclick: () => onUse({ ...current }) }, 'Use these settings') : null,
  );
  const story = h('p', { class: 'ex-story' });
  const tiles = h('div', { class: 'tiles' });
  const ladder = h('div', { class: 'table-scroll' });
  const edge = h('div', { class: 'ex-edge' });
  const simIntro = h('p', { class: 'muted' });
  const simTiles = h('div', { class: 'tiles' });
  const simChart = h('div', { class: 'ex-chart' });
  root.replaceChildren(
    form,
    story,
    tiles,
    h('h3', {}, 'The chain, step by step'),
    ladder,
    edge,
    h('h3', {}, 'What sessions look like'),
    simIntro,
    simTiles,
    simChart,
    h(
      'p',
      { class: 'fineprint' },
      `Simulated with the ${fmtPct(rtp)} return to player the casino states for this game: every round's crash point is random, ` +
        `with a ${fmtPct(rtp)} ÷ m chance of reaching m×, and past rounds don't change the next one. Real sessions vary.`,
    ),
  );

  let timer;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  });
  update();

  function update() {
    const raw = Object.fromEntries(FIELDS.map((f) => [f.name, inputs[f.name].value]));
    const result = validatePlan({ ...current, ...raw });
    for (const f of FIELDS) {
      errors[f.name].textContent = result.errors[f.name] ?? '';
      inputs[f.name].toggleAttribute('aria-invalid', Boolean(result.errors[f.name]));
    }
    if (!result.ok) return;
    current = result.plan;
    const opts = { ...strategyOptions(current), rtp };
    renderStatic(opts);
    simulate(opts);
  }

  function renderStatic(opts) {
    const s = planSummary(opts);
    const rows = chainLadder(opts);
    const bet = fmtMoney(opts.betCents);
    const x = `${opts.cashout.toFixed(2)}×`;
    story.textContent =
      opts.steps === 1
        ? `You bet ${bet}. If the plane flies past ${x}, the game's Auto Cash Out pays ${fmtMoney(rows[0].paysCents)} and the chain is complete. ` +
          `If it crashes first, you lose ${bet}. With one win per chain there is no compounding: every bet stands alone.`
        : `You bet ${bet}. If the plane flies past ${x}, the game's Auto Cash Out pays ${fmtMoney(rows[0].paysCents)}, and all of it rides on the next round. ` +
          `${opts.steps} wins in a row turn ${bet} into ${fmtMoney(s.fullPaysCents)}, a profit of ${fmtMoney(s.chainProfitCents)}. ` +
          `One loss anywhere ends the chain: you lose your ${bet} (everything above it was this chain's winnings), and the next chain starts again from ${bet}.`;

    tiles.replaceChildren(
      tile('Chance one bet wins', fmtPct(s.betWinChance), `cashing out at ${x}`),
      tile('Chance a chain completes', fmtPct(s.chainChance), oneIn(s.chainChance)),
      tile('A complete chain pays', fmtMoney(s.fullPaysCents), `${fmtSigned(s.chainProfitCents)} profit`),
      tile('Average return per chain', fmtPct(s.avgReturn), `${fmtSigned(s.avgNetPerChainCents)} per chain on average`),
    );

    ladder.replaceChildren(
      h(
        'table',
        { class: 'data ladder' },
        h('caption', { class: 'sr-only' }, 'Each step of a chain: the bet, what it pays, and the chance the chain gets that far'),
        h(
          'thead',
          {},
          h('tr', {}, h('th', { scope: 'col' }, 'Step'), h('th', { scope: 'col', class: 'num' }, 'You bet'), h('th', { scope: 'col', class: 'num' }, 'If it wins'), h('th', { scope: 'col' }, 'Chance the chain gets this far')),
        ),
        h(
          'tbody',
          {},
          rows.map((r) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, String(r.step)),
              h('td', { class: 'num' }, fmtMoney(r.stakeCents)),
              h('td', { class: 'num' }, fmtMoney(r.paysCents)),
              h('td', {}, h('span', { class: 'chance' }, meter(r.reachChance), h('span', { class: 'num' }, fmtPct(r.reachChance)))),
            ),
          ),
          h(
            'tr',
            { class: 'done' },
            h('th', { scope: 'row' }, 'Done'),
            h('td', { class: 'num' }, '—'),
            h('td', { class: 'num' }, `${fmtSigned(s.chainProfitCents)} profit`),
            h('td', {}, h('span', { class: 'chance' }, meter(s.chainChance), h('span', { class: 'num' }, fmtPct(s.chainChance)))),
          ),
        ),
      ),
    );

    const rtpText = fmtPct(rtp);
    edge.replaceChildren(
      h(
        'p',
        {},
        h('strong', {}, 'The catch: the house edge compounds too. '),
        `On average every bet returns ${rtpText} of its stake, whatever multiplier you pick: the house keeps ${fmtPct(1 - rtp)}. ` +
          (opts.steps === 1
            ? `So each bet loses ${fmtPct(1 - rtp)} of its stake on average.`
            : `A chain is ${opts.steps} bets riding on each other, so on average it returns ${rtpText} multiplied ${opts.steps} times: ${fmtPct(s.avgReturn)}. ` +
              `Compounding makes the rare wins bigger, but it doesn't change which way the average points.`),
      ),
      h(
        'p',
        {},
        `Your loss limit of ${fmtMoney(opts.maxLossCents)} allows up to ${fmtCount(s.attempts)} lost chain${s.attempts === 1 ? '' : 's'}, ` +
          `because each lost chain costs exactly one initial bet.` +
          (s.goalChance != null ? ` The chance of completing a chain before the limit stops you is ${fmtPct(s.goalChance)}.` : ''),
      ),
    );
  }

  async function simulate(opts) {
    const id = ++generation;
    simTiles.classList.add('stale');
    simChart.classList.add('stale');
    const result = await simulateSessions(opts, { sessions, maxBetsPerSession: MAX_BETS, onProgress: () => id === generation });
    if (id !== generation) return;
    const stats = describeResults(result.nets);
    const goal = opts.chains > 0;
    simIntro.textContent =
      `${fmtCount(result.sessions)} simulated sessions with these settings. Each one ends ` +
      (goal ? `after ${opts.chains} completed chain${opts.chains === 1 ? '' : 's'}, or ` : '') +
      `when one more lost chain could take the loss past ${fmtMoney(opts.maxLossCents)}` +
      (goal ? '.' : ` (or after ${fmtCount(MAX_BETS)} bets).`) +
      ` On average a session took ${result.avgBets.toFixed(1)} bets.`;
    simTiles.replaceChildren(
      goal ? tile('Reached the goal', fmtPct(result.reachedGoal / result.sessions), 'of sessions') : tile('Ended up', fmtPct(stats.wonShare), 'of sessions'),
      tile('Ended down', fmtPct(stats.lostShare), 'of sessions'),
      tile('Average result', fmtSigned(stats.avg), 'per session'),
      tile('Typical result', fmtSigned(stats.median), 'the median session'),
    );
    chart?.destroy();
    chart = renderResultsChart(simChart, histogram(result.nets), result.sessions);
    simTiles.classList.remove('stale');
    simChart.classList.remove('stale');
  }

  return {
    setPlan(next) {
      for (const f of FIELDS) inputs[f.name].value = next[f.name];
      update();
    },
  };
}
