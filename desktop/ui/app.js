// Control panel: renders the state pushed by the local server (desktop/server.js)
// and sends the user's actions back to it.
import { planSummary } from '/shared/compounding.js';
import { DEFAULT_PLAN, strategyOptions, validatePlan } from '/shared/plan.js';
import { mountExplainer } from '/shared/web/explainer.js';
import { fmtDate, fmtMoney, fmtPct, fmtSigned, fmtTime, h, oneIn } from '/shared/web/format.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const MODE_NAME = { 'dry-run': 'dry run', practice: 'practice', live: 'LIVE' };
const START_LABEL = { 'dry-run': 'Start dry run', practice: 'Start practice', live: 'Start live betting' };

const token = readToken();
const form = $('#plan-form');
let state = null;
let explainer = null;
let explainerPlan = '';
let shownBets = [];
let disconnectedSince = null;

// ---------------- talking to the app ----------------

function readToken() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
  try {
    if (fromHash) {
      sessionStorage.setItem('token', fromHash);
      history.replaceState(null, '', '/');
      return fromHash;
    }
    return sessionStorage.getItem('token');
  } catch {
    return fromHash;
  }
}

async function call(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-token': token ?? '', ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Something went wrong (${res.status}).`), data);
  return data.result;
}

function connect() {
  const events = new EventSource(`/api/events?token=${encodeURIComponent(token ?? '')}`);
  events.addEventListener('state', (e) => {
    disconnectedSince = null;
    render(JSON.parse(e.data));
  });
  events.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
  events.addEventListener('error', () => {
    disconnectedSince ??= Date.now();
    setTimeout(renderBanner, 4000);
  });
}

/** Run an action with `button` disabled; show any error in `noteEl`. */
async function act(button, fn, noteEl = $('#session-note')) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    say(noteEl, err.message, true);
    throw err;
  } finally {
    if (button) button.disabled = false;
  }
}

function say(el, text, bad = false) {
  el.textContent = text ?? '';
  el.classList.toggle('bad', Boolean(bad));
}

// ---------------- rendering ----------------

function render(next) {
  state = next;
  const { product, settings } = state;
  document.title = product.name;
  for (const el of $$('[data-product-name]')) el.textContent = product.name;
  for (const el of $$('[data-game-name]')) el.textContent = product.game.name;
  for (const el of $$('[data-min-age]')) el.textContent = product.minimumAge;
  if (!form.dataset.loaded) {
    fillPlanForm(settings);
    form.dataset.loaded = '1';
    $('#browser-select').value = settings.browser;
  }
  const welcome = $('#welcome');
  if (!settings.accepted && !welcome.open) welcome.showModal();
  explainer ??= mountExplainer($('#explainer'), { plan: settings.plan, rtp: product.game.rtp, onUse: usePlan });
  renderLicenseChip();
  renderBanner();
  renderGlance();
  renderSession();
  renderSubscription();
  renderHelp();
}

function renderLicenseChip() {
  const l = state.license;
  const days = l.daysLeft == null ? 'no end date' : `${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left`;
  const [text, tone] = {
    active: [`Subscribed · ${days}`, 'good'],
    expired: ['Subscription ended', 'bad'],
    none: ['Free version', ''],
    clock: ['Check your PC date', 'warn'],
  }[l.state] ?? ['License problem', 'bad'];
  const chip = $('#license-chip');
  chip.textContent = text;
  chip.className = `license-chip pill ${tone}`;
}

function renderBanner() {
  const banner = $('#banner');
  if (disconnectedSince && Date.now() - disconnectedSince > 3000) {
    banner.className = 'banner bad';
    banner.replaceChildren(`${state?.product.name ?? 'The app'} has closed. You can close this window.`);
    banner.hidden = false;
  } else if (state?.update) {
    banner.className = 'banner';
    banner.replaceChildren(
      h('span', {}, `Version ${state.update.version} is available.`),
      h('button', { type: 'button', class: 'btn', 'data-open': 'download' }, 'Get the update'),
    );
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

// ---------------- play ----------------

function fillPlanForm(settings) {
  for (const [name, value] of Object.entries(settings.plan)) if (form.elements[name]) form.elements[name].value = value;
  for (const radio of form.elements.mode) radio.checked = radio.value === settings.mode;
  updateStartButton();
}

function readPlanForm() {
  const plan = Object.fromEntries(Object.keys(DEFAULT_PLAN).map((name) => [name, form.elements[name].value]));
  return { mode: form.elements.mode.value || 'dry-run', plan };
}

function showFieldErrors(errors = {}) {
  for (const el of $$('[data-error]', form)) el.textContent = errors[el.dataset.error] ?? '';
  for (const name of Object.keys(DEFAULT_PLAN)) form.elements[name].toggleAttribute('aria-invalid', Boolean(errors[name]));
}

function updateStartButton() {
  const mode = form.elements.mode.value || 'dry-run';
  const start = $('#start');
  start.textContent = START_LABEL[mode];
  start.classList.toggle('live', mode === 'live');
  start.classList.toggle('primary', mode !== 'live');
}

let saveTimer;
form.addEventListener('input', () => {
  const { plan } = readPlanForm();
  showFieldErrors(validatePlan(plan).errors);
  updateStartButton();
  renderGlance();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
});

async function saveSettings() {
  const { mode, plan } = readPlanForm();
  if (!validatePlan(plan).ok) return;
  try {
    await call('settings', { mode, plan, browser: $('#browser-select').value });
  } catch (err) {
    say($('#session-note'), err.message, true);
  }
}

function renderGlance() {
  if (!state) return;
  const box = $('#glance');
  const { ok, plan } = validatePlan(readPlanForm().plan);
  if (!ok) {
    box.replaceChildren(h('p', { class: 'muted' }, 'Fix the highlighted settings to see what this plan does.'));
    return;
  }
  const s = planSummary({ ...strategyOptions(plan), rtp: state.product.game.rtp });
  const row = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
  box.replaceChildren(
    h('h3', {}, 'This plan at a glance'),
    h(
      'dl',
      {},
      row('A full chain pays', `${fmtMoney(s.fullPaysCents)} (${fmtSigned(s.chainProfitCents)})`),
      row('Chance one bet wins', fmtPct(s.betWinChance)),
      row('Chance a chain completes', fmtPct(s.chainChance)),
      row('Completed chains', oneIn(s.chainChance)),
      row('Lost chains your limit allows', String(s.attempts)),
      s.goalChance != null ? row('Chance to complete a chain first', fmtPct(s.goalChance)) : null,
      row('Average return per chain', fmtPct(s.avgReturn)),
    ),
    h('button', { type: 'button', class: 'link-button', onclick: () => selectTab('strategy') }, 'See how compounding works'),
  );
}

function renderSession() {
  const { bot, settings } = state;
  const s = bot.session;
  const [label, tone] = !s
    ? bot.browser === 'opening'
      ? ['Opening the game…', 'warn']
      : ['Idle', '']
    : s.status === 'waiting'
      ? ['Waiting for funds', 'warn']
      : s.status === 'stopping'
        ? ['Stopping…', 'warn']
        : [`Running · ${MODE_NAME[s.mode]}`, s.mode === 'live' ? 'bad' : 'good'];
  const pill = $('#status-pill');
  pill.textContent = label;
  pill.className = `pill ${tone}`;

  $('#start').hidden = Boolean(s);
  $('#stop').hidden = !s;
  $('#stop').disabled = s?.status === 'stopping';
  $('#retry').hidden = s?.status !== 'waiting';
  $('#open-game').textContent = bot.browser === 'open' ? 'Show game window' : 'Open game window';
  $('#open-game').disabled = bot.browser === 'opening';
  for (const el of form.querySelectorAll('input')) el.disabled = Boolean(s);

  const kpi = (name, value, hero = false) => h('div', { class: `kpi${hero ? ' hero' : ''}` }, h('span', {}, name), h('strong', {}, value));
  const plan = s?.plan ?? settings.plan;
  if (s) {
    shownBets = s.bets;
    const money = s.mode === 'live' ? '' : s.mode === 'practice' ? ' (play money)' : ' (paper)';
    $('#kpis').replaceChildren(
      ...[
        kpi(`Session net${money}`, fmtSigned(s.netCents), true),
        kpi('Bets won', `${s.wins} of ${s.count}`),
        kpi('Chains done', plan.chains ? `${s.chainsDone} of ${plan.chains}` : String(s.chainsDone)),
        kpi('Next bet', `${fmtMoney(s.nextStakeCents)} · step ${s.step + 1}/${plan.steps}`),
        s.endsAt && kpi('Time left', h('span', { id: 'time-left' }, timeLeft(s.endsAt))),
      ].filter(Boolean),
    );
  } else if (bot.last) {
    const l = bot.last;
    $('#kpis').replaceChildren(
      kpi(`Last session${l.mode === 'live' ? '' : ` (${MODE_NAME[l.mode]})`}`, fmtSigned(l.netCents ?? 0), true),
      kpi('Bets won', `${l.wins ?? 0} of ${l.count ?? 0}`),
      kpi('Chains done', String(l.chainsDone ?? 0)),
    );
  } else {
    $('#kpis').replaceChildren(kpi('Session net', fmtSigned(0), true), kpi('Bets won', '0 of 0'), kpi('Chains done', '0'));
  }

  const note = $('#session-note');
  if (s?.status === 'waiting') {
    say(note, `The balance is too low for the next bet of ${fmtMoney(s.waitingForCents)}. Add funds in the game window and the bot carries on by itself (within your loss limit), or press Stop.`);
  } else if (!s && bot.last && !note.classList.contains('bad')) {
    say(note, `Last session ended: ${bot.last.reason}.`, bot.last.failed);
  } else if (s && !note.classList.contains('bad')) {
    say(note, s.mode === 'live' ? 'Betting real money. Keep the game window open and visible.' : 'Keep the game window open and visible.');
  }

  const tbody = $('#bets tbody');
  tbody.replaceChildren(
    ...shownBets.map((b) =>
      h(
        'tr',
        {},
        h('td', {}, fmtTime(b.time)),
        h('td', {}, `${b.step}/${plan.steps}`),
        h('td', { class: 'num' }, fmtMoney(b.stakeCents)),
        h('td', { class: 'num' }, b.crash == null ? '?' : `${b.crash.toFixed(2)}×`),
        h('td', {}, h('span', { class: `result ${b.won ? 'won' : 'lost'}` }, h('i', { 'aria-hidden': 'true' }, b.won ? '▲' : '▼'), b.won ? `Won ${fmtMoney(b.payoutCents)}` : 'Lost')),
        h('td', { class: 'num' }, fmtSigned(b.netCents)),
      ),
    ),
  );
  $('#bets-empty').hidden = shownBets.length > 0;
}

function timeLeft(endsAt) {
  const s = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(() => {
  const el = $('#time-left');
  if (el && state?.bot.session?.endsAt) el.textContent = timeLeft(state.bot.session.endsAt);
}, 1000);

function addLog(line) {
  const list = $('#log');
  list.append(h('li', {}, h('time', {}, fmtTime(line.time)), line.message));
  while (list.children.length > 300) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

$('#start').addEventListener('click', async (e) => {
  const { mode, plan } = readPlanForm();
  const check = validatePlan(plan);
  if (!check.ok) {
    showFieldErrors(check.errors);
    return say($('#session-note'), 'Check the highlighted settings.', true);
  }
  if (mode === 'live') {
    const p = check.plan;
    const ok = confirm(`Start betting real money?\n\nInitial bet ${fmtMoney(p.bet * 100)}, cash out at ${p.cashout.toFixed(2)}×, loss limit ${fmtMoney(p.maxLoss * 100)}.`);
    if (!ok) return;
  }
  say($('#session-note'), 'Starting…');
  try {
    await act(e.currentTarget, () => call('session/start', { mode, plan, browser: $('#browser-select').value }));
    say($('#session-note'), '');
  } catch (err) {
    if (err.fields) showFieldErrors(err.fields);
    if (err.needsLicense) selectTab('subscription');
  }
});
$('#stop').addEventListener('click', (e) => act(e.currentTarget, () => call('session/stop', {})).catch(() => {}));
$('#retry').addEventListener('click', (e) => act(e.currentTarget, () => call('session/retry', {})).catch(() => {}));
$('#open-game').addEventListener('click', async (e) => {
  say($('#session-note'), state?.bot.browser === 'open' ? '' : 'Opening the game window…');
  await act(e.currentTarget, () => call('game/open', {})).catch(() => {});
});

function usePlan(plan) {
  for (const name of ['bet', 'cashout', 'steps', 'maxLoss', 'chains']) form.elements[name].value = plan[name];
  form.dispatchEvent(new Event('input'));
  selectTab('play');
  say($('#session-note'), 'Settings copied from "How compounding works".');
}

// ---------------- subscription ----------------

function renderSubscription() {
  const { license: l, machineId, subscription: sub, product } = state;
  const ends = l.expiresAt == null ? 'no end date' : fmtDate(l.expiresAt);
  const planName = sub.plans.find((p) => p.id === l.plan)?.name ?? l.plan;
  const status = {
    none: ['Free version', '', 'Simulator, dry run and practice are free. Live betting needs a subscription.'],
    active: [`Subscribed: ${planName}`, 'good', l.expiresAt == null ? 'Your subscription has no end date.' : `Active until ${ends} (${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left). Renewing early adds the days on top.`],
    expired: ['Subscription ended', 'bad', `It ended on ${ends}. Renew below to keep betting live.`],
  }[l.state] ?? ['License problem', 'bad', l.message];
  $('#license-card').replaceChildren(
    h('h2', {}, 'Your subscription'),
    h('div', { class: 'license-state' }, h('span', { class: `pill ${status[1]}` }, status[0]), h('p', {}, status[2])),
    h('p', { class: 'field-label' }, "This computer's machine ID"),
    h(
      'div',
      { class: 'machine' },
      h('code', {}, machineId),
      h('button', { type: 'button', class: 'btn', onclick: (e) => copy(e.currentTarget, machineId) }, 'Copy'),
    ),
    h('p', { class: 'fineprint' }, 'Subscriptions are tied to this machine ID. Quote it if you contact support.'),
  );

  $('#sub-intro').textContent = sub.online
    ? `Choose a plan and enter your MoMo number.${sub.sandbox ? ' (Test mode: payments use the MoMo sandbox, no real money.)' : ''}`
    : 'Online payment is not set up yet. You can pay manually: see "Already paid?".';
  $('#dial-code').textContent = `+${product.country.dialCode}`;
  $('#subscribe-form input[name=phone]').placeholder = product.country.example;

  const plansBox = $('#plans');
  const key = JSON.stringify(sub.plans) + sub.currency;
  if (plansBox.dataset.key !== key) {
    const chosen = $('input[name=plan]:checked', plansBox)?.value ?? sub.plans.find((p) => p.best)?.id ?? sub.plans[0]?.id;
    plansBox.dataset.key = key;
    plansBox.replaceChildren(
      ...sub.plans.map((p) =>
        h(
          'label',
          { class: 'plan-option' },
          h('input', { type: 'radio', name: 'plan', value: p.id, checked: p.id === chosen }),
          h('span', {}, h('b', {}, p.name)),
          p.best ? h('span', { class: 'tag' }, 'Best value') : null,
          h('span', { class: 'price' }, `${sub.currency} ${p.price}`),
        ),
      ),
    );
  }
  const pending = sub.order?.status === 'PENDING';
  $('#pay').disabled = !sub.online || pending;
  renderOrder(sub.order);
  renderManualPayment();
}

function renderOrder(order) {
  const box = $('#order');
  if (!order) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const tone = { PAID: 'good', FAILED: 'bad', REVIEW: 'bad' }[order.status] ?? '';
  box.className = `order ${tone}`;
  const clear = h('button', { type: 'button', class: 'link-button', onclick: () => call('subscribe/clear', {}) }, order.status === 'PENDING' ? 'Cancel' : 'Dismiss');
  // (replaceChildren would print a null as "null", so leave out the empty parts first)
  if (order.status === 'PENDING') {
    box.replaceChildren(
      ...[
        h('p', {}, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('strong', {}, 'Waiting for your approval')),
        h('p', {}, order.message ?? 'Approve the payment on your phone.'),
        h('p', { class: 'muted' }, `Prompt sent to ${order.phone}. It expires after a few minutes. `, clear),
        order.problem && h('p', { class: 'muted' }, `Still checking: ${order.problem}`),
      ].filter(Boolean),
    );
  } else if (order.status === 'PAID') {
    box.replaceChildren(
      ...[
        h('p', {}, h('strong', {}, 'Payment received. Thank you!')),
        h('p', {}, order.expiresAt ? `Your subscription is active until ${fmtDate(Date.parse(order.expiresAt))}.` : 'Your subscription is active.'),
        order.problem && h('p', {}, order.problem),
        clear,
      ].filter(Boolean),
    );
  } else {
    box.replaceChildren(h('p', {}, h('strong', {}, order.status === 'TIMEOUT' ? 'Still waiting' : 'Payment not completed')), h('p', {}, order.message ?? ''), clear);
  }
}

function renderManualPayment() {
  const { product, machineId, subscription: sub } = state;
  const { momoNumber, accountName } = product.manualPayment ?? {};
  const whatsapp = product.support?.whatsapp;
  const box = $('#manual-pay');
  if (!momoNumber && !whatsapp) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    h(
      'div',
      { class: 'manual' },
      h('h3', {}, 'Pay manually'),
      h(
        'ol',
        {},
        momoNumber
          ? h('li', {}, `Send the plan price (${sub.plans.map((p) => `${sub.currency} ${p.price} for ${p.name}`).join(', ')}) with MoMo to ${momoNumber}${accountName ? ` (${accountName})` : ''}.`)
          : null,
        h('li', {}, `Send us the MoMo transaction ID and your machine ID (${machineId}).`),
        h('li', {}, 'We reply with a license key. Paste it above and press "Activate key".'),
      ),
      whatsapp ? h('button', { type: 'button', class: 'btn', 'data-open': 'whatsapp' }, 'Message us on WhatsApp') : null,
    ),
  );
}

$('#subscribe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plan = $('input[name=plan]:checked')?.value;
  const phone = e.currentTarget.elements.phone.value;
  const box = $('#order');
  try {
    await act($('#pay'), () => call('subscribe', { plan, phone }), box);
  } catch (err) {
    box.hidden = false;
    box.className = 'order bad';
    box.replaceChildren(h('p', {}, err.message));
  }
});

$('#restore').addEventListener('click', async (e) => {
  const note = $('#restore-note');
  say(note, 'Looking for your subscription…');
  const result = await act(e.currentTarget, () => call('license/restore', {}), note).catch(() => null);
  if (result) say(note, `Subscription restored. ${result.message}`);
});

$('#key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const keyForm = e.currentTarget;
  const note = $('#restore-note');
  const result = await act($('button[type=submit]', keyForm), () => call('license/activate', { key: keyForm.elements.key.value }), note).catch(() => null);
  if (result) {
    keyForm.reset();
    say(note, `License activated. ${result.message}`);
  }
});

async function copy(button, text) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Select and copy';
  }
  setTimeout(() => (button.textContent = 'Copy'), 2000);
}

// ---------------- help ----------------

function renderHelp() {
  const { product } = state;
  $('#about').textContent = `${product.name} ${product.version}, for ${product.game.name}.`;
  const list = $('#helplines');
  if (!list.childElementCount) {
    list.replaceChildren(...(product.helplines ?? []).map((line) => h('li', {}, h('a', { href: line.url, target: '_blank', rel: 'noopener' }, line.name))));
  }
}

$('#browser-select').addEventListener('change', saveSettings);
$('#check-updates').addEventListener('click', async (e) => {
  await act(e.currentTarget, () => call('refresh', {})).catch(() => {});
  alert(state.update ? `Version ${state.update.version} is available on the website.` : 'You have the latest version.');
});
$('#quit').addEventListener('click', async () => {
  if (!confirm(`Quit ${state.product.name}? A running session stops after the bet in the air settles.`)) return;
  await call('quit', {}).catch(() => {});
});
$('#license-chip').addEventListener('click', () => selectTab('subscription'));
$('#accept').addEventListener('click', () => call('accept', {}).catch(() => {}));
$('#welcome').addEventListener('cancel', (e) => e.preventDefault()); // Escape doesn't skip the notice

// Links to the website, folders and WhatsApp go through the app (it opens them outside this window).
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-open]');
  if (target) call('open', { target: target.dataset.open }).catch((err) => alert(err.message));
});

// ---------------- tabs ----------------

function selectTab(name) {
  for (const tab of $$('[role=tab]')) {
    const on = tab.id === `tab-${name}`;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
  }
  if (name === 'strategy' && explainer) {
    // Start the explainer from the plan on the Play tab, unless it hasn't changed since last time.
    const { ok, plan } = validatePlan(readPlanForm().plan);
    const key = JSON.stringify(plan);
    if (ok && key !== explainerPlan) {
      explainerPlan = key;
      explainer.setPlan(plan);
    }
  }
  try {
    sessionStorage.setItem('tab', name);
  } catch {}
}
const tabs = $$('[role=tab]');
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab.id.slice(4)));
  tab.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(tab);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
    if (next) {
      next.focus();
      selectTab(next.id.slice(4));
    }
  });
}

// ---------------- start ----------------

try {
  const initial = await call('state');
  render(initial);
  for (const line of initial.logs ?? []) addLog(line);
  let tab = null;
  try {
    tab = sessionStorage.getItem('tab');
  } catch {}
  if (tab && $(`#tab-${tab}`)) selectTab(tab);
  connect();
} catch (err) {
  const banner = $('#banner');
  banner.className = 'banner bad';
  banner.textContent = err.message || 'Could not connect. Close this window and open the app again.';
  banner.hidden = false;
}
