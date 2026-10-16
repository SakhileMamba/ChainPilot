// What the storyboard uses to act out a scene: move a visible cursor, click and type
// for real, spotlight elements with callouts, show chapter cards and concept scenes,
// and wait for a phrase in the narration so actions line up with the voice.
import { setTimeout as sleep } from 'node:timers/promises';
import { OVERLAY_CSS, installOverlay } from './overlay.js';

export class Director {
  constructor(page) {
    this.page = page;
    this.cursorAt = { x: 900, y: 420 };
    this.scene = { start: Date.now(), ms: 0, text: '' };
  }

  /** Called by the engine at the start of each scene. */
  begin(text, narrationMs) {
    this.scene = { start: Date.now(), ms: narrationMs, text };
  }

  /** Wait until `seconds` into the scene. */
  async at(seconds) {
    const wait = this.scene.start + seconds * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  }

  /** Wait until the narration reaches `phrase` (estimated from its position in the text). */
  async cue(phrase) {
    const i = this.scene.text.indexOf(phrase);
    if (i < 0) throw new Error(`cue "${phrase}" is not in the narration: ${this.scene.text}`);
    await this.at(((i / this.scene.text.length) * this.scene.ms) / 1000);
  }

  wait(ms) {
    return sleep(ms);
  }

  async tour(method, ...args) {
    const installed = await this.page.evaluate(() => Boolean(window.__tour)).catch(() => false);
    if (!installed) await this.page.evaluate(installOverlay, { css: OVERLAY_CSS, cursorAt: this.cursorAt });
    return this.page.evaluate(([m, a]) => window.__tour[m](...a), [method, args]);
  }

  async goto(url) {
    // Not 'networkidle': the control panel keeps its event stream open.
    await this.page.goto(url, { waitUntil: 'load' });
    await sleep(500);
    await this.tour('chapter', this.chapterText ?? null);
  }

  async chapter(text) {
    this.chapterText = text;
    await this.tour('chapter', text);
  }

  locator(selector) {
    return this.page.locator(selector).first();
  }

  async visible(selector) {
    return this.locator(selector).isVisible().catch(() => false);
  }

  /** Scroll so the element sits comfortably in view (below the sticky header). */
  async reveal(selector) {
    const el = this.locator(selector);
    await el.waitFor({ state: 'visible', timeout: 15_000 });
    const box = await el.boundingBox();
    const viewport = this.page.viewportSize();
    if (box.y < 70 || box.y + Math.min(box.height, viewport.height - 140) > viewport.height - 20) {
      await el.evaluate((node) => node.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await sleep(750);
    }
    return el.boundingBox();
  }

  async moveTo(x, y, ms) {
    const distance = Math.hypot(x - this.cursorAt.x, y - this.cursorAt.y);
    const duration = ms ?? Math.round(Math.min(950, 260 + distance * 0.75));
    this.cursorAt = { x, y };
    await this.tour('cursor', x, y, duration);
    await this.page.mouse.move(x, y);
    await sleep(duration + 80);
  }

  async point(selector) {
    const box = await this.reveal(selector);
    await this.moveTo(box.x + box.width / 2, box.y + box.height / 2);
    return box;
  }

  async click(selector) {
    await this.point(selector);
    await this.tour('ripple', this.cursorAt.x, this.cursorAt.y);
    await this.locator(selector).click();
    await sleep(300);
  }

  async check(selector) {
    await this.point(selector);
    await this.tour('ripple', this.cursorAt.x, this.cursorAt.y);
    await this.locator(selector).check();
    await sleep(250);
  }

  async type(selector, text, { delay = 110 } = {}) {
    await this.click(selector);
    await this.locator(selector).fill('');
    await this.page.keyboard.type(String(text), { delay });
    await sleep(250);
  }

  async hover(selector) {
    await this.point(selector);
    await this.locator(selector).hover();
  }

  /** Spotlight an element, optionally with a callout ({ title, body, side }). */
  async spot(selector, callout) {
    const box = await this.reveal(selector);
    await this.tour('spot', box);
    if (callout) await this.tour('callout', { ...callout, rect: box });
    else await this.tour('hideCallout');
    await sleep(500);
    return box;
  }

  async unspot() {
    await this.tour('spot', null);
    await this.tour('hideCallout');
    await sleep(300);
  }

  async card(html) {
    await this.tour('card', html);
    await sleep(html == null ? 550 : 650);
  }

  async stage(html) {
    await this.tour('stage', html);
    await sleep(html == null ? 550 : 650);
  }

  async step(n) {
    await this.tour('stageStep', n);
  }

  async badge(text) {
    await this.tour('badge', text);
  }

  async hideCursor() {
    await this.tour('hideCursor');
  }
}
