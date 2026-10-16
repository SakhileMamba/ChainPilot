// Drives the Aviator game page with Playwright.
//
// mulasport.com embeds Aviator from games.phoenixbet.io (provider "Fun Games
// Live"), not from Spribe's own servers, so the selectors below come from that
// build's bundle (games.phoenixbet.io/aviator/assets/index-Cgn6ru8Z.js). Its
// labels are translated, so everything keys off class names and structure.
import { setTimeout as sleep } from 'node:timers/promises';
import { money, toCents } from './strategy.js';

export const SEL = {
  stage: '.stage-dom', // play area, showing one of the next three
  waiting: '.waiting-progress', // WAITING: the betting window before take-off
  crashed: '.flew-away-text', // CRASHED: "Flew away!"
  multiplier: '.multiplier-text', // live multiplier, or the crash point once crashed
  panel: '.bet-control', // a bet panel; the bot only uses the first one
  // The panel's main button: Bet (no bet) / Cancel (bet placed) / Cash out (bet flying)
  button: 'button.btn-success, button.btn-cancel, button.btn-warning',
  amount: 'section input', // stake field inside the panel
  toggle: 'div[class~="w-[36px]"][class~="h-[24px]"]', // Auto tab switches: [Auto Bet, Auto Cash Out]
  balance: '[class~="text-[#28a909]"]', // balance in the game header
  winToast: '.notification-section .win-toast',
  errorToast: '.notification-section .error-notification',
};

const POLL_MS = 50;
const MANUAL_CASHOUT_GRACE_MS = 150; // how long past the target before cashing out by hand
const SETTLE_MS = 500; // after the crash, time for the balance to update
const NO_FUNDS = /not enough balance|insufficient/i; // the game's (and our) low-balance messages

export class Stopped extends Error {
  constructor() {
    super('stopped');
  }
}

export class Closed extends Error {
  constructor() {
    super('the browser window was closed');
  }
}

// ---- Functions run inside the game frame (they can't use anything from this module) ----

function readState(sel) {
  const number = (el) => (el ? parseFloat(el.textContent.replace(/,/g, '')) : null);
  const stage = document.querySelector(sel.stage);
  const phase = !stage
    ? null
    : stage.querySelector(sel.waiting)
      ? 'WAITING'
      : stage.querySelector(sel.crashed)
        ? 'CRASHED'
        : stage.querySelector(sel.multiplier)
          ? 'FLYING'
          : null;
  const button = document.querySelector(sel.panel)?.querySelector(sel.button);
  const slip = !button
    ? null
    : button.classList.contains('btn-success')
      ? 'EMPTY'
      : button.classList.contains('btn-warning')
        ? 'OPEN_BET'
        : 'BET_PLACED';
  // Toasts have no ids, so remember the ones already reported and return each once.
  // A page without that memory is a freshly (re)loaded game.
  const newDocument = !window.__aviatorBotSeen;
  const seen = (window.__aviatorBotSeen ??= new WeakSet());
  const fresh = (selector) =>
    [...document.querySelectorAll(selector)].filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  return {
    newDocument,
    phase,
    multiplier: number(stage?.querySelector(sel.multiplier)),
    slip,
    balance: number(document.querySelector(sel.balance)),
    wins: fresh(sel.winToast).map((el) => ({
      multiplier: number(el.querySelector('.multiplier .value')),
      won: number(el.querySelector('.win .value')),
    })),
    errors: fresh(sel.errorToast).map((el) => (el.querySelector('span') ?? el).textContent.trim()),
  };
}

// Clicks the first panel's main button only if it is in the expected state. For
// "Bet" it also requires the expected stake and Auto Cash Out switched on at the
// expected multiplier. Checks and click happen in one step, so nothing can change
// in between (e.g. Bet turning into Cancel, or a reload resetting Auto Cash Out).
function pressButton({ sel, cls, amount, cashout }) {
  const panel = document.querySelector(sel.panel);
  const button = panel?.querySelector(sel.button);
  if (!button || !button.classList.contains(cls) || button.disabled) return 'the button was not ready';
  if (amount != null) {
    const stake = button.querySelectorAll('label')[1]?.querySelector('span')?.textContent;
    if (stake !== amount) return `the panel showed a stake of ${stake}`;
    const autoCashOut = panel.querySelectorAll(sel.toggle)[1];
    const multiplier = panel.querySelectorAll('input')[1]?.value;
    if (!autoCashOut?.querySelector('span').style.transform.includes('12px') || multiplier !== cashout) {
      return 'Auto Cash Out was not set';
    }
  }
  button.click();
  return null;
}

function clickTab({ sel, name }) {
  const tabs = document.querySelector(sel.panel)?.querySelectorAll('button') ?? [];
  const tab = [...tabs].find((b) => b.textContent.trim() === name);
  tab?.click();
  return Boolean(tab);
}

// A switch is on when its knob is slid right (translateX(12px)).
function toggleState({ sel, index }) {
  const toggle = document.querySelector(sel.panel)?.querySelectorAll(sel.toggle)[index];
  return toggle ? toggle.querySelector('span').style.transform.includes('12px') : null;
}

function clickToggle({ sel, index }) {
  document.querySelector(sel.panel)?.querySelectorAll(sel.toggle)[index]?.click();
}

// ---- Node side ----

/** Types into one of the game's number fields and presses Enter, which is when the game reads it. */
async function commit(input, text) {
  await input.fill(text, { timeout: 10_000 });
  await input.press('Enter');
  let shown = await input.inputValue();
  for (let i = 0; i < 10 && shown !== text; i++) {
    await sleep(50);
    shown = await input.inputValue();
  }
  return shown; // the game clamps out-of-range values, so this can differ from `text`
}

export class Game {
  constructor(context, { log, control, beforeBet = null }) {
    this.context = context;
    this.log = log;
    this.control = control; // { stopRequested } set by Ctrl+C, { retryNow } by Enter
    // Called with the game frame just before Bet is pressed; a returned message
    // blocks the bet and ends the session (e.g. practice mode on a real-money page).
    this.beforeBet = beforeBet;
    this.frame = null;
    this.ready = false; // first panel set up (Auto tab, Auto Cash Out on)
    this.last = null; // most recent state read from the page
    this.loads = 0; // game page loads seen, to notice reloads
    this.skipBalanceCheck = false; // after Enter: let the game itself judge the balance once
  }

  /** Find the frame (in any tab) that holds the game, waiting while you log in and open it. */
  async attach() {
    this.frame = null;
    this.ready = false; // the panel's Auto settings live in the page and reset when it reloads
    for (let tries = 0; ; tries++) {
      for (const page of this.context.pages()) {
        for (const frame of page.frames()) {
          if (await frame.locator(SEL.panel).count().catch(() => 0)) {
            this.frame = frame;
            this.log(`Found the game (${new URL(frame.url()).host}).`);
            return;
          }
        }
      }
      if (!this.context.pages().length) throw new Closed();
      if (this.control.stopRequested) throw new Stopped();
      if (tries % 30 === 0) this.log('Waiting for Aviator - log in and open the game in the browser window.');
      await sleep(1000);
    }
  }

  async snapshot() {
    for (;;) {
      if (!this.frame || this.frame.isDetached()) await this.attach();
      try {
        const state = await this.frame.evaluate(readState, SEL);
        if (state.newDocument) {
          this.loads += 1;
          if (this.ready) this.log('The game page reloaded; the bet panel will be set up again.');
          this.ready = false; // a reload resets the panel's Auto settings
        }
        this.last = state;
        return state;
      } catch (err) {
        if (!this.context.pages().length) throw new Closed();
        // Usually the game reloaded: find it again (the panel gets set up again too).
        this.log(`Lost contact with the game (${err.message.split('\n')[0]}). Reconnecting...`);
        this.frame = null;
        await sleep(500);
      }
    }
  }

  /** Poll the game until `check(state, previous)` returns something truthy, and return that. */
  async until(check, { stoppable = true, timeoutMs = Infinity } = {}) {
    const deadline = Date.now() + timeoutMs;
    let prev = this.last ?? (await this.snapshot());
    while (Date.now() < deadline) {
      if (stoppable && this.control.stopRequested) throw new Stopped();
      await sleep(POLL_MS);
      const state = await this.snapshot();
      const result = check(state, prev);
      if (result) return result;
      prev = state;
    }
    return null;
  }

  /** Wait until the plane isn't flying: a bet placed then goes into the next flight. */
  betweenFlights() {
    return this.until((s) => s.phase === 'WAITING' || s.phase === 'CRASHED');
  }

  /** Let `count` rounds go by (each round ends with a crash). */
  async skipRounds(count) {
    let ended = 0;
    await this.until((s, prev) => {
      if (s.phase === 'CRASHED' && prev.phase !== 'CRASHED') ended += 1;
      return ended >= count;
    });
  }

  /** Dry run: watch the next flight and return its crash point. */
  async watchRound() {
    await this.betweenFlights();
    return this.until((s, prev) => (s.phase === 'CRASHED' && prev.phase !== 'CRASHED' ? { crash: s.multiplier } : null));
  }

  /** Put the first bet panel on its Auto tab with Auto Bet off and Auto Cash Out on at `target`. */
  async setup(target) {
    await this.snapshot(); // finds the game frame if needed
    const panel = this.frame.locator(SEL.panel).first();
    const toggles = panel.locator(SEL.toggle);
    // Auto Bet re-bets the moment a round ends, so the panel would never come free.
    // It can be switched off at any time, so do that first.
    if ((await toggles.count()) > 0) await this.setToggle(0, false, 'Auto Bet');
    await this.panelFree();
    if ((await toggles.count()) === 0) {
      await this.frame.evaluate(clickTab, { sel: SEL, name: 'Auto' });
      await toggles.first().waitFor({ timeout: 5000 }).catch(() => {
        throw new Error("couldn't open the Auto tab of the first bet panel - reload the game and try again");
      });
    }
    await this.setToggle(0, false, 'Auto Bet'); // the bot places every bet itself
    await this.setToggle(1, true, 'Auto Cash Out');
    const shown = await commit(panel.locator('input').nth(1), target.toFixed(2));
    if (shown !== target.toFixed(2)) {
      throw new Error(`the game won't take an auto cash-out of ${target.toFixed(2)}x (it shows ${shown}x)`);
    }
    this.ready = true;
    this.log(`First bet panel ready: Auto Cash Out at ${shown}x.`);
  }

  async setToggle(index, on, name) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await this.frame.evaluate(toggleState, { sel: SEL, index })) === on) return;
      await this.frame.evaluate(clickToggle, { sel: SEL, index });
      await sleep(300);
    }
    throw new Error(`couldn't switch ${name} ${on ? 'on' : 'off'}`);
  }

  /** Wait until the first panel has no bet in it. */
  async panelFree() {
    if ((await this.snapshot()).slip === 'EMPTY') return;
    this.log('Waiting for the bet already in the first panel to finish...');
    await this.until((s) => s.slip === 'EMPTY');
  }

  /**
   * Place a bet of `stakeCents` on the next flight and follow it until its
   * round ends. Returns what was seen (for decideOutcome), or { error } if no bet
   * was placed.
   */
  async bet(stakeCents, target) {
    let placed;
    try {
      placed = await this.place(stakeCents, target);
    } catch (err) {
      if (err instanceof Stopped || err instanceof Closed) throw err;
      this.ready = false; // e.g. the game reloaded mid-setup: set it up again next time
      return { error: err.message.split('\n')[0] };
    }
    return placed.error ? placed : this.follow(placed.before, placed.loads, stakeCents, target);
  }

  async place(stakeCents, target) {
    if (!this.ready) await this.setup(target);
    await this.panelFree();
    const panel = this.frame.locator(SEL.panel).first();
    const stake = toCents(await commit(panel.locator(SEL.amount), money(stakeCents)));
    if (stake !== stakeCents) return { error: `the game only allows ${money(stake)} here`, limit: stake };

    await this.betweenFlights();
    const before = this.last;
    const loads = this.loads;
    if (!this.skipBalanceCheck && before.balance != null && toCents(before.balance) < stakeCents) {
      return { error: `not enough balance (${before.balance.toFixed(2)})`, deposit: true };
    }
    this.skipBalanceCheck = false;
    if (this.control.stopRequested) throw new Stopped();
    const blocked = this.beforeBet?.(this.frame);
    if (blocked) return { error: blocked, fatal: true };
    const refused = await this.frame.evaluate(pressButton, {
      sel: SEL,
      cls: 'btn-success',
      amount: money(stakeCents),
      cashout: target.toFixed(2),
    });
    if (refused) {
      this.ready = false; // set the panel up again before the next try
      return { error: `didn't press Bet: ${refused}` };
    }
    // A bet may be live from here on, so Ctrl+C waits for it to settle.
    const placed = await this.until((s) => (s.slip !== 'EMPTY' ? 'placed' : s.errors[0]), {
      stoppable: false,
      timeoutMs: 10_000,
    });
    if (placed !== 'placed') {
      return { error: placed ?? 'the game did not confirm the bet', deposit: NO_FUNDS.test(placed ?? '') };
    }
    return { before, loads };
  }

  /**
   * Wait (Ctrl+C still stops) until the game shows more money than now and at least
   * `stakeCents`, or until Enter is pressed in the terminal. After Enter the next bet
   * is tried even if the game's balance display hasn't caught up; the game refuses
   * it if the money isn't there.
   */
  async waitForDeposit(stakeCents) {
    const start = this.last?.balance;
    this.control.retryNow = false;
    let remindAt = Date.now() + 5 * 60_000;
    const how = await this.until((s) => {
      if (this.control.retryNow) return 'enter';
      if (Date.now() > remindAt) {
        this.log(`Still waiting for a deposit (game balance ${s.balance?.toFixed(2) ?? 'not shown'}).`);
        remindAt = Date.now() + 5 * 60_000;
      }
      const shown = s.balance == null ? null : toCents(s.balance);
      const enough = shown != null && shown >= stakeCents && (start == null || shown > toCents(start));
      return enough ? 'balance' : null;
    });
    this.skipBalanceCheck = how === 'enter';
    return how;
  }

  /** Watch a placed bet until its round ends. */
  async follow(before, loads, stakeCents, target) {
    const seen = { cashedOut: false, toastCents: null, crash: null, deltaCents: null };
    // After a reload the panel no longer shows which round the bet was in, and the
    // balance can be stale for a moment, so then nothing below is trusted.
    const reloaded = () => this.loads !== loads;
    let overSince = null;
    let pressedCashOut = false;
    let lastNote = Date.now();
    for (;;) {
      await sleep(POLL_MS);
      const s = await this.snapshot();
      const toast = s.wins.at(-1);
      if (toast?.won > 0) seen.toastCents = toCents(toast.won);
      if (s.slip === 'EMPTY') {
        if (reloaded()) break;
        if (s.phase === 'FLYING') seen.cashedOut = true; // closed while the plane is still up
        else if (s.phase === 'CRASHED') {
          seen.crash = s.multiplier;
          break;
        } else break; // gone before take-off (cancelled?) - the balance tells below
      }
      // Safety net: Auto Cash Out should already have closed the bet at the target.
      // If it is still open shortly after, cash out by hand.
      if (s.slip === 'OPEN_BET' && s.multiplier >= target && !pressedCashOut) {
        overSince ??= Date.now();
        if (Date.now() - overSince >= MANUAL_CASHOUT_GRACE_MS) {
          const refused = await this.frame
            .evaluate(pressButton, { sel: SEL, cls: 'btn-warning' })
            .catch(() => 'the page was busy');
          pressedCashOut = !refused;
          if (pressedCashOut) this.log(`Auto cash-out didn't fire - cashed out by hand at about ${s.multiplier.toFixed(2)}x.`);
        }
      } else {
        overSince = null;
      }
      if (Date.now() - lastNote > 60_000) {
        this.log('Still waiting for the bet to settle...');
        lastNote = Date.now();
      }
    }
    await sleep(SETTLE_MS);
    const after = await this.snapshot();
    const lateToast = after.wins.at(-1);
    if (seen.toastCents == null && lateToast?.won > 0) seen.toastCents = toCents(lateToast.won);
    if (reloaded()) {
      // Only what was seen before the reload counts (no balance comparison).
      if (!seen.cashedOut && seen.toastCents == null && seen.crash == null) {
        this.log("The game reloaded while the bet was open, so its result can't be read; counting it as lost.");
      }
      return seen;
    }
    if (before.balance != null && after.balance != null) {
      seen.deltaCents = toCents(after.balance) - toCents(before.balance);
    }
    if (!seen.cashedOut && seen.crash == null && seen.deltaCents === 0) {
      return { error: 'the bet was cancelled before take-off' };
    }
    return seen;
  }
}
