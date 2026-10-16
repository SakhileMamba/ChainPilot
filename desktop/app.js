// Everything the control panel can see and do: settings, the license, subscribing
// with MoMo, the bot, and the files the website provides. The local web server
// (server.js) only turns HTTP requests into calls on this object.
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PLAN, MODES, validatePlan } from '../src/plan.js';
import { PRODUCT, VERSION, siteLink } from '../src/product.js';
import { openExternal } from './browsers.js';
import { applySelectors, fetchJson, isNewer } from './remote.js';

const ORDER_POLL_MS = 4000;
const ORDER_TIMEOUT_MS = 10 * 60_000;
const BROWSERS = ['auto', 'chrome', 'msedge'];
const USABLE = ['active', 'expired', 'clock'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DesktopApp extends EventEmitter {
  constructor({ dataDir, licenses, controller, api, open = openExternal, fetch = globalThis.fetch, pollMs = ORDER_POLL_MS }) {
    super();
    Object.assign(this, { dataDir, licenses, controller, api, openTarget: open, fetch, pollMs });
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.settings = this.loadSettings();
    this.pricing = { currency: PRODUCT.currency, plans: PRODUCT.plans, sandbox: false }; // the server's list replaces this when online
    this.order = null; // the MoMo payment in progress or just finished
    this.update = null; // { version } when the website has a newer version
    controller.on('state', () => this.changed());
    controller.on('log', (line) => this.emit('log', line));
  }

  changed() {
    this.emit('state');
  }

  loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(readFileSync(this.settingsFile, 'utf8'));
    } catch {}
    const plan = validatePlan({ ...DEFAULT_PLAN, ...saved.plan });
    return {
      accepted: saved.accepted === true,
      mode: MODES.includes(saved.mode) ? saved.mode : 'dry-run',
      browser: BROWSERS.includes(saved.browser) ? saved.browser : 'auto',
      plan: plan.ok ? plan.plan : { ...DEFAULT_PLAN },
    };
  }

  writeSettings() {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
  }

  state({ logs = false } = {}) {
    const { name, tagline, currency, country, support, manualPayment, minimumAge, helplines, game } = PRODUCT;
    return {
      product: {
        name,
        tagline,
        version: VERSION,
        currency,
        country,
        support,
        manualPayment,
        minimumAge,
        helplines,
        game: { name: game.name, rtp: game.rtp },
        siteUrl: siteLink(),
      },
      settings: this.settings,
      machineId: this.licenses.machine,
      license: this.licenses.status(),
      subscription: { online: this.api.configured, ...this.pricing, order: this.order },
      bot: this.controller.snapshot(),
      update: this.update,
      ...(logs && { logs: this.controller.logs.slice(-200) }),
    };
  }

  /** Save mode, browser and plan. Returns { ok, settings } or { ok: false, errors }. */
  saveSettings({ mode, browser, plan } = {}) {
    const result = validatePlan(plan ?? this.settings.plan);
    if (!result.ok) return { ok: false, errors: result.errors };
    this.settings = {
      ...this.settings,
      plan: result.plan,
      mode: MODES.includes(mode) ? mode : this.settings.mode,
      browser: BROWSERS.includes(browser) ? browser : this.settings.browser,
    };
    this.writeSettings();
    this.changed();
    return { ok: true, settings: this.settings };
  }

  /** The first-run notice (age and risks) was accepted. */
  accept() {
    this.settings = { ...this.settings, accepted: true, acceptedAt: new Date().toISOString() };
    this.writeSettings();
    this.changed();
  }

  openGame() {
    return this.controller.openGame({ mode: this.settings.mode, browser: this.settings.browser });
  }

  async start(input = {}) {
    if (!this.settings.accepted) throw new Error('Please read and accept the notice first.');
    const saved = this.saveSettings(input);
    if (!saved.ok) throw Object.assign(new Error('Check the highlighted settings.'), { fields: saved.errors });
    await this.controller.start({ mode: this.settings.mode, plan: this.settings.plan, browser: this.settings.browser });
  }

  stop() {
    this.controller.stop();
  }

  retry() {
    this.controller.retry();
  }

  activate(key) {
    const result = this.licenses.save(String(key ?? ''));
    this.changed();
    if (!USABLE.includes(result.state)) throw new Error(result.message);
    this.controller.log(`License ${result.id} saved. ${result.message}`);
    return result;
  }

  removeLicense() {
    this.licenses.remove();
    this.changed();
  }

  /** Fetch the keys already issued to this computer and keep the one that lasts longest. */
  async restore() {
    const { licenses = [] } = await this.api.licenses(this.licenses.machine);
    const usable = licenses.map((l) => ({ key: l.key, check: this.licenses.check(l.key) })).filter((l) => USABLE.includes(l.check.state));
    if (!usable.length) throw new Error('No subscription has been paid for this computer yet.');
    const ends = (l) => l.check.expiresAt ?? Infinity;
    usable.sort((a, b) => (ends(b) === ends(a) ? 0 : ends(b) > ends(a) ? 1 : -1));
    return this.activate(usable[0].key);
  }

  /** Ask MoMo to charge `phone` for `plan`; the payment is then followed in the background. */
  async subscribe({ plan, phone } = {}) {
    if (this.order?.status === 'PENDING' && Date.now() - this.order.startedAt < ORDER_TIMEOUT_MS) {
      throw new Error('A payment is already waiting for approval on your phone.');
    }
    const order = await this.api.createOrder({ plan, phone, machineId: this.licenses.machine });
    this.order = { ...order, startedAt: Date.now() };
    this.controller.log(`MoMo payment requested (order ${order.id.slice(0, 8)}). Approve it on your phone.`);
    this.changed();
    this.followOrder(order.id);
    return this.order;
  }

  async followOrder(id) {
    const deadline = Date.now() + ORDER_TIMEOUT_MS;
    while (this.order?.id === id && Date.now() < deadline) {
      await sleep(this.pollMs);
      let order;
      try {
        order = await this.api.order(id);
      } catch (err) {
        if (this.order?.id === id && err.status !== 404) {
          this.order = { ...this.order, problem: err.message };
          this.changed();
        }
        continue;
      }
      if (this.order?.id !== id) return;
      this.order = { ...order, startedAt: this.order.startedAt };
      if (order.status === 'PAID') {
        try {
          this.activate(order.license);
          this.controller.log('Payment received - your subscription is active.');
        } catch (err) {
          this.order.problem = err.message;
        }
      }
      this.changed();
      if (order.status !== 'PENDING') return;
    }
    if (this.order?.id === id && this.order.status === 'PENDING') {
      this.order = {
        ...this.order,
        status: 'TIMEOUT',
        message: 'No confirmation from MoMo yet. If you approved the payment, press "Restore purchase" in a minute.',
      };
      this.changed();
    }
  }

  /** Forget the order on screen (a payment already approved still activates through "Restore purchase"). */
  clearOrder() {
    this.order = null;
    this.changed();
  }

  open(target) {
    const pages = {
      site: '',
      guide: 'guide.html',
      strategy: 'strategy.html',
      subscribe: `subscribe.html#machine=${this.licenses.machine}`,
      download: 'download.html',
      terms: 'terms.html',
      privacy: 'privacy.html',
      responsible: 'responsible-gambling.html',
    };
    if (target === 'logs' || target === 'data') {
      const dir = target === 'logs' ? path.join(this.dataDir, 'logs') : this.dataDir;
      mkdirSync(dir, { recursive: true });
      return this.openTarget(dir);
    }
    if (target === 'whatsapp') {
      const number = String(PRODUCT.support.whatsapp ?? '').replace(/\D/g, '');
      if (!number) throw new Error('No WhatsApp number is set up.');
      const text = `Hi, I'd like a ${PRODUCT.name} subscription. My machine ID is ${this.licenses.machine}.`;
      return this.openTarget(`https://wa.me/${number}?text=${encodeURIComponent(text)}`);
    }
    if (target === 'help-line') {
      const url = PRODUCT.helplines?.[0]?.url;
      if (url) return this.openTarget(url);
    }
    if (target in pages) {
      const url = siteLink(pages[target]);
      if (!url) throw new Error('The website address is not set up yet.');
      return this.openTarget(url);
    }
    throw new Error('Unknown link.');
  }

  /** Fetch the website's resources: newest version, cancelled licenses, selector fixes, current prices. */
  async refreshRemote() {
    const tasks = [];
    if (siteLink()) {
      const get = async (file) => {
        const { body, serverTime } = await fetchJson(`${siteLink(file)}?t=${Date.now()}`, { fetch: this.fetch });
        if (serverTime) this.licenses.noteServerTime(serverTime);
        return body;
      };
      tasks.push(
        get('downloads/latest.json').then((latest) => {
          this.update = latest?.version && isNewer(latest.version, VERSION) ? { version: latest.version } : null;
        }),
        get('revoked.json').then((doc) => this.licenses.setRevoked(doc?.revoked ?? [])),
        get('selectors.json').then((doc) => {
          const note = applySelectors(doc, { publicKey: this.licenses.publicKey, appVersion: VERSION });
          if (note) this.controller.log(`Website: ${note}.`);
        }),
      );
    }
    if (this.api.configured) {
      tasks.push(
        this.api.plans().then((p) => {
          if (p?.plans?.length) this.pricing = { currency: p.currency, plans: p.plans, sandbox: Boolean(p.sandbox) };
        }),
      );
    }
    await Promise.allSettled(tasks);
    this.changed();
  }

  quit() {
    this.emit('quit');
  }
}
