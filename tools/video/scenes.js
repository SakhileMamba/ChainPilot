// Full-screen concept animations for the tutorial, generated from the real maths
// (src/compounding.js) so every number shown is the app's own. Elements with
// data-step="n" appear when the director calls stageStep(n).
import { chainLadder, planSummary } from '../../src/compounding.js';

const money = (cents) => (cents / 100).toFixed(2);
const pct = (x) => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const EXAMPLE = { betCents: 1000, steps: 5, cashout: 1.9, rtp: 0.97, maxLossCents: 10_000, chains: 1 };

export function card({ icon, kicker, title, sub, items = [] }) {
  return `<img src="${icon}" alt="">
    ${kicker ? `<div class="t-kicker">${esc(kicker)}</div>` : ''}
    <h1>${esc(title)}</h1>
    ${sub ? `<p>${esc(sub)}</p>` : ''}
    ${items.length ? `<ol>${items.map((item, i) => `<li>${i + 1}. ${esc(item)}</li>`).join('')}</ol>` : ''}`;
}

export function installScene(installerName) {
  return `<div class="c-wrap">
    <h2 class="c-title">Install in about a minute</h2>
    <p class="c-sub">Windows 10 or 11, with Chrome or Edge. No administrator rights needed.</p>
    <div class="c-row">
      <div data-step="1" style="flex:1">
        <div class="c-win"><div class="bar">Downloads</div><div class="body"><span>${esc(installerName)}</span><span class="c-btn">Open file</span></div></div>
        <div class="c-caption">1. Download from the website</div>
      </div>
      <div data-step="2" style="flex:1">
        <div class="c-win warn"><div class="bar">Windows protected your PC</div><div class="body"><span>Unrecognised app…</span><span class="c-link">More info</span><span class="c-btn">Run anyway</span></div></div>
        <div class="c-caption">2. More info, then Run anyway</div>
      </div>
      <div data-step="3" style="flex:1">
        <div class="c-win"><div class="bar">ChainPilot Setup</div><div class="body"><span>Installing…</span><div class="c-progress"><i></i></div><span class="c-btn">Finish</span></div></div>
        <div class="c-caption">3. Next, I agree, Install</div>
      </div>
      <div data-step="4" style="flex:1">
        <div class="c-win"><div class="bar">Start</div><div class="body"><span style="font-size:22px;color:#fff;font-weight:700">ChainPilot</span><span>Control panel + log window</span></div></div>
        <div class="c-caption">4. Open it from the Start menu</div>
      </div>
    </div>
  </div>`;
}

/** The chain growing: the first bet (step 1), each win (steps 2..steps+1), then a lost chain (steps+2). */
export function chainScene(plan = EXAMPLE) {
  const rows = chainLadder(plan);
  const nodes = [`<div class="c-box" data-step="1"><small>You bet</small><b>${money(plan.betCents)}</b><small>start</small></div>`];
  rows.forEach((r, i) => {
    const last = i === rows.length - 1;
    nodes.push(`<div class="c-arrow" data-step="${i + 2}">×${plan.cashout.toFixed(1)}</div>`);
    nodes.push(
      `<div class="c-box${last ? ' gold' : ''}" data-step="${i + 2}"><small>${last ? 'Chain complete' : `Win ${i + 1}`}</small><b>${money(r.paysCents)}</b><small>${last ? `+${money(r.profitCents)} profit` : 'rides again'}</small></div>`,
    );
  });
  return `<div class="c-wrap">
    <h2 class="c-title">A compounding chain</h2>
    <p class="c-sub">Every win's whole payout rides on the next round.</p>
    <div class="c-row" style="gap:8px">${nodes.join('')}</div>
    <div class="c-row" style="margin-top:26px" data-step="${rows.length + 2}">
      <div class="c-box red"><small>One crash before ${plan.cashout.toFixed(2)}× at any step</small><b>Chain over: −${money(plan.betCents)}</b><small>only the first bet is lost; then a new chain starts from ${money(plan.betCents)}</small></div>
    </div>
  </div>`;
}

/** How likely the chain gets to each bet (steps 1..6). */
export function oddsScene(plan = EXAMPLE) {
  const rows = chainLadder(plan);
  const s = planSummary(plan);
  const bars = rows.map(
    (r, i) => `<div class="c-barrow" data-step="${i + 1}"><span>${i === 0 ? 'Bet 1 is placed' : `Reach bet ${i + 1}`}</span><span class="c-track"><i style="--w:${(r.reachChance * 100).toFixed(2)}%"></i></span><b>${pct(r.reachChance)}</b></div>`,
  );
  bars.push(
    `<div class="c-barrow" data-step="${rows.length + 1}"><span><strong>Chain complete</strong></span><span class="c-track"><i style="--w:${(s.chainChance * 100).toFixed(2)}%;background:#f5a524"></i></span><b>${pct(s.chainChance)}</b></div>`,
  );
  return `<div class="c-wrap">
    <h2 class="c-title">The chance shrinks as fast as the stake grows</h2>
    <p class="c-sub">At ${plan.cashout.toFixed(2)}× one bet wins ${pct(s.betWinChance)} of the time. Each step needs one more win.</p>
    <div class="c-bars">${bars.join('')}</div>
    <p class="c-note" data-step="${rows.length + 1}">About <strong>1 chain in ${Math.round(s.chainsPerWin)}</strong> completes.</p>
  </div>`;
}

/** The house edge compounding: rtp × rtp × ... = average return per chain (steps 1..steps+1). */
export function edgeScene(plan = EXAMPLE) {
  const s = planSummary(plan);
  const parts = [];
  for (let i = 0; i < plan.steps; i++) {
    if (i) parts.push(`<span class="op" data-step="${i + 1}">×</span>`);
    parts.push(`<span data-step="${i + 1}">${pct(plan.rtp)}</span>`);
  }
  parts.push(`<span class="op" data-step="${plan.steps + 1}">=</span><span class="res" data-step="${plan.steps + 1}">${pct(s.avgReturn)}</span>`);
  return `<div class="c-wrap" style="text-align:center">
    <h2 class="c-title">The house edge compounds too</h2>
    <p class="c-sub">On average every bet returns ${pct(plan.rtp)} of its stake, at any multiplier.</p>
    <div class="c-eq">${parts.join('')}</div>
    <p class="c-note" data-step="${plan.steps + 1}">A ${plan.steps}-step chain returns about <strong>${pct(s.avgReturn)}</strong> of its first bet on average.<br>Compounding makes rare wins bigger. It doesn't change which way the average points.</p>
  </div>`;
}

/** A phone receiving the MoMo approval prompt (step 1 prompt, 2-5 PIN digits, 6 approved). */
export function phoneScene({ amount, currency, product, plan }) {
  return `<div class="c-wrap" style="display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:40px">
    <div>
      <h2 class="c-title">Approve on your phone</h2>
      <p class="c-sub">A Mobile Money prompt arrives on the number you entered. Check the amount, then approve it with your PIN.</p>
      <p class="c-note" data-step="6">Approved. ${esc(product)} activates by itself.</p>
    </div>
    <div class="c-phone">
      <div class="c-sheet" data-step="1">
        <b>Mobile Money</b>
        Pay ${esc(currency)} ${esc(amount)} to ${esc(product)} (${esc(plan)})?<br>Enter your PIN to approve.
        <div class="c-pin"><i data-step="2" class="pin"></i><i data-step="3" class="pin"></i><i data-step="4" class="pin"></i><i data-step="5" class="pin"></i></div>
      </div>
      <div class="c-ok" data-step="6"><big>✓</big>Payment approved</div>
    </div>
  </div>
  <style>#__tour .c-pin i[data-step] { transform: none; opacity: 1; } #__tour .c-pin i[data-step].on { background: #3b4660; }</style>`;
}
