// Runs the bot for the control panel: opens the game window, starts and stops
// sessions, and keeps a live picture of what is happening.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { MODES, strategyOptions, validatePlan } from '../src/plan.js';
import { PRODUCT } from '../src/product.js';
import { launchBrowser, runSession } from '../src/session.js';
import { money, signed } from '../src/strategy.js';
import { browserName, findBrowsers } from './browsers.js';

export const MODE_LABEL = { 'dry-run': 'dry run', practice: 'practice (play money)', live: 'LIVE (real money)' };

export class Controller extends EventEmitter {
  /**
   * licenses: LicenseStore. launch/run/browsers can be replaced in tests.
   */
  constructor({ dataDir, licenses, launch = launchBrowser, run = runSession, browsers = findBrowsers }) {
    super();
    Object.assign(this, { dataDir, licenses, launch, run, browsers });
    this.context = null; // the game window (a Playwright browser context)
    this.channel = null;
    this.opening = null;
    this.session = null; // the session in progress, as shown in the UI
    this.last = null; // how the previous session ended
    this.control = null; // { stopRequested, retryNow } for the running session
    this.running = null; // promise of the running session
    this.logs = [];
  }

  log(message) {
    const line = { time: Date.now(), message };
    this.logs.push(line);
    if (this.logs.length > 500) this.logs.shift();
    this.emit('log', line);
  }

  changed() {
    this.emit('state');
  }

  snapshot() {
    return {
      browser: this.context ? 'open' : this.opening ? 'opening' : 'closed',
      browserName: this.channel ? browserName(this.channel) : null,
      session: this.session,
      last: this.last,
    };
  }

  /** Open the game window (or bring it to the front). `browser`: auto, chrome or msedge. */
  async openGame({ mode = 'dry-run', browser = 'auto' } = {}) {
    if (this.context) return this.focusGame();
    if (this.opening) return this.opening;
    const installed = this.browsers().map((b) => b.channel);
    const channels = browser === 'auto' ? (installed.length ? installed : ['chrome', 'msedge']) : [browser];
    this.opening = (async () => {
      let lastError;
      for (const channel of channels) {
        try {
          this.context = await this.launch({
            profile: path.join(this.dataDir, `browser-${channel}`),
            browser: channel,
            url: mode === 'practice' ? PRODUCT.game.demoUrl : PRODUCT.game.url,
            log: (m) => this.log(m),
          });
          this.channel = channel;
          this.context.on('close', () => {
            this.context = null;
            this.channel = null;
            this.log('The game window was closed.');
            this.changed();
          });
          this.log(`Game window open in ${browserName(channel)}. Log in to ${PRODUCT.game.name} there if you haven't yet. Keep the window open and not minimised while the bot plays.`);
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw new Error(`${lastError?.message ?? "Couldn't start a browser"}. ${PRODUCT.name} needs Google Chrome or Microsoft Edge.`);
    })();
    this.changed();
    try {
      await this.opening;
    } finally {
      this.opening = null;
      this.changed();
    }
  }

  async focusGame() {
    await this.context?.pages()[0]?.bringToFront().catch(() => {});
  }

  /** Make sure the game window shows the real-money game for live, or the play-money one for practice. */
  async ensureGamePage(mode) {
    const pages = this.context.pages();
    const site = new URL(PRODUCT.game.url).hostname;
    const page = pages.find((p) => p.url().includes(site)) ?? pages[0] ?? (await this.context.newPage());
    const onSite = page.url().includes(site);
    const onDemo = page.url().includes(PRODUCT.game.demoMarker);
    let target = null;
    if (mode === 'practice' && !onDemo) target = PRODUCT.game.demoUrl;
    else if (mode === 'live' && (!onSite || onDemo)) target = PRODUCT.game.url;
    else if (mode === 'dry-run' && !onSite) target = PRODUCT.game.url;
    if (target) {
      this.log(mode === 'practice' ? 'Switching the game window to practice mode (play money).' : 'Opening the game in the game window.');
      await page.goto(target, { waitUntil: 'domcontentloaded' }).catch((err) => this.log(`Couldn't open the game page: ${err.message.split('\n')[0]}`));
    }
    await page.bringToFront().catch(() => {});
  }

  /** Start a session. Throws an Error (with .fields for invalid settings, .needsLicense for live without one). */
  async start({ mode, plan: input, browser = 'auto' }) {
    if (this.session || this.starting) throw new Error('A session is already running.');
    if (!MODES.includes(mode)) throw new Error('Choose a mode.');
    const { ok, plan, errors } = validatePlan(input);
    if (!ok) throw Object.assign(new Error('Check the highlighted settings.'), { fields: errors });
    if (mode === 'live') {
      const license = this.licenses.status();
      if (license.state !== 'active') {
        throw Object.assign(new Error(license.state === 'none' ? 'Live betting needs a subscription.' : license.message), { needsLicense: true });
      }
    }
    this.starting = true; // opening the window takes a while; don't let a second click start another session
    try {
      await this.openGame({ mode, browser });
      if (!this.context) throw new Error('The game window was closed.');
      await this.ensureGamePage(mode);
    } finally {
      this.starting = false;
    }

    const options = { ...strategyOptions(plan), live: mode !== 'dry-run', mode };
    const control = { stopRequested: false, retryNow: false };
    const startedAt = Date.now();
    this.control = control;
    this.session = {
      mode,
      plan,
      startedAt,
      endsAt: plan.maxMinutes ? startedAt + plan.maxMinutes * 60_000 : null,
      status: 'running',
      waitingForCents: null,
      bets: [],
      count: 0,
      wins: 0,
      chainsDone: 0,
      netCents: 0,
      step: 0,
      nextStakeCents: options.betCents,
    };
    this.log(
      `Starting a ${MODE_LABEL[mode]} session: bet ${money(options.betCents)}, cash out at ${plan.cashout.toFixed(2)}x, ` +
        `${plan.steps} win(s) per chain, loss limit ${money(options.maxLossCents)}${plan.maxMinutes ? `, time limit ${plan.maxMinutes} min` : ''}.`,
    );
    this.changed();

    const timer = plan.maxMinutes
      ? setTimeout(() => {
          if (!control.stopRequested) {
            this.log(`Time limit of ${plan.maxMinutes} minutes reached.`);
            this.stop();
          }
        }, plan.maxMinutes * 60_000)
      : null;
    // Practice mode must never bet real money: refuse unless the game page is the play-money one.
    const beforeBet =
      mode === 'practice'
        ? (frame) =>
            frame.page().url().includes(PRODUCT.game.demoMarker)
              ? null
              : "practice mode only bets on the game's play-money page, and the game window has left it"
        : null;

    this.running = this.run({
      context: this.context,
      options,
      control,
      log: (m) => this.log(m),
      logDir: path.join(this.dataDir, 'logs'),
      retryHint: 'Use "Retry now" to try again sooner, or Stop to end the session.',
      beforeBet,
      onBet: (r, strategy) => this.recordBet(r, strategy),
      onWaiting: (waiting, stakeCents) => {
        this.session.status = waiting ? 'waiting' : control.stopRequested ? 'stopping' : 'running';
        this.session.waitingForCents = waiting ? stakeCents : null;
        this.changed();
      },
    })
      .then(({ reason, failed, strategy, file }) => {
        this.last = { mode, reason, failed, startedAt, endedAt: Date.now(), count: strategy.bets, wins: strategy.wins, chainsDone: strategy.chainsDone, netCents: strategy.netCents, file };
        this.log(`Session over - ${reason}. Net ${signed(strategy.netCents)}${mode === 'live' ? '' : mode === 'practice' ? ' (play money)' : ' (paper bets)'}.`);
      })
      .catch((err) => {
        this.last = { mode, reason: `error: ${err.message}`, failed: true, startedAt, endedAt: Date.now() };
        this.log(`Session stopped by an error: ${err.message}`);
      })
      .finally(() => {
        clearTimeout(timer);
        this.session = null;
        this.control = null;
        this.running = null;
        this.changed();
      });
    return this.session;
  }

  recordBet(r, strategy) {
    const s = this.session;
    s.bets.unshift({ time: Date.now(), step: r.step, stakeCents: r.stake, crash: r.crash ?? null, won: r.won, payoutCents: r.payoutCents, netCents: r.net, how: r.how });
    if (s.bets.length > 200) s.bets.pop();
    Object.assign(s, {
      count: strategy.bets,
      wins: strategy.wins,
      chainsDone: strategy.chainsDone,
      netCents: strategy.netCents,
      step: strategy.step,
      nextStakeCents: strategy.stakeCents,
    });
    this.changed();
  }

  /** Stop after any bet in the air has settled. */
  stop() {
    if (!this.control || this.control.stopRequested) return;
    this.control.stopRequested = true;
    this.session.status = 'stopping';
    this.log('Stopping - any bet in the air settles first.');
    this.changed();
  }

  retry() {
    if (this.control) this.control.retryNow = true;
  }

  /** Stop any session (waiting up to `timeoutMs` for it to settle) and close the game window. */
  async shutdown({ timeoutMs = 90_000 } = {}) {
    this.stop();
    if (this.running) await Promise.race([this.running, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    await this.context?.close().catch(() => {});
  }
}
