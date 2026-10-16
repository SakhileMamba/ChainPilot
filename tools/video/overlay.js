// The annotation layer drawn on top of the page while the tutorial is recorded: a
// cursor, click ripples, a spotlight that dims everything but one element, callout
// bubbles, chapter cards, a full-screen "stage" for concept animations, a chapter
// label and a badge. installOverlay runs inside the page (page.evaluate), so it can't
// use anything from this module except what is passed to it.

export const OVERLAY_CSS = `
#__tour[popover] { position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0;
  padding: 0; border: 0; background: transparent; overflow: visible; pointer-events: none; color: #eef2f8;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
#__tour * { box-sizing: border-box; }
#__tour .t-spot { position: fixed; border-radius: 12px; border: 2px solid #f5a524; opacity: 0;
  box-shadow: 0 0 0 9999px rgba(4, 7, 16, 0.64), 0 0 28px 6px rgba(245, 165, 36, 0.45);
  transition: left .45s ease, top .45s ease, width .45s ease, height .45s ease, opacity .3s ease; }
#__tour .t-spot.on { opacity: 1; }
#__tour .t-callout { position: fixed; width: 360px; background: #fff8ea; color: #10131c; border-radius: 12px;
  padding: 14px 18px; border-left: 6px solid #f5a524; box-shadow: 0 18px 44px rgba(0, 0, 0, .5);
  opacity: 0; transform: translateY(8px); transition: opacity .3s ease, transform .3s ease; }
#__tour .t-callout.on { opacity: 1; transform: none; }
#__tour .t-callout b { display: block; font-size: 18px; margin-bottom: 4px; }
#__tour .t-callout p { margin: 0; font-size: 15.5px; line-height: 1.45; color: #2b3140; }
#__tour .t-callout p:empty { display: none; }
#__tour .t-callout::before { content: ''; position: absolute; width: 16px; height: 16px; background: #fff8ea; transform: rotate(45deg); }
#__tour .t-callout.side-right::before { left: -8px; top: calc(var(--ay, 30px) - 8px); background: #f5a524; }
#__tour .t-callout.side-left::before { right: -8px; top: calc(var(--ay, 30px) - 8px); }
#__tour .t-callout.side-below::before { top: -8px; left: calc(var(--ax, 30px) - 8px); }
#__tour .t-callout.side-above::before { bottom: -8px; left: calc(var(--ax, 30px) - 8px); }
#__tour .t-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 30px; opacity: 0; z-index: 9;
  transition-property: transform, opacity; transition-timing-function: cubic-bezier(.45, .05, .25, 1);
  filter: drop-shadow(0 3px 4px rgba(0, 0, 0, .55)); }
#__tour .t-ripple { position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
  border: 3px solid #f5a524; opacity: 0; z-index: 8; }
#__tour .t-ripple.go { animation: t-ripple .55s ease-out; }
@keyframes t-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
#__tour .t-card, #__tour .t-stage { position: fixed; inset: 0; opacity: 0; transition: opacity .5s ease;
  background: radial-gradient(900px 480px at 85% 0%, rgba(245, 165, 36, .2), transparent 70%),
    radial-gradient(800px 420px at 0% 100%, rgba(57, 135, 229, .16), transparent 70%), #0b1020; }
#__tour .t-card.on, #__tour .t-stage.on { opacity: 1; }
#__tour .t-card { display: grid; place-content: center; text-align: center; gap: 10px; }
#__tour .t-card img { width: 92px; height: 92px; border-radius: 22px; justify-self: center; margin-bottom: 10px; }
#__tour .t-card .t-kicker { color: #f5a524; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; font-size: 16px; }
#__tour .t-card h1 { font-size: 52px; line-height: 1.08; margin: 0; letter-spacing: -.02em; max-width: 1000px; }
#__tour .t-card p { font-size: 21px; color: #b4bfd3; margin: 4px 0 0; max-width: 820px; justify-self: center; }
#__tour .t-card ol { list-style: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding: 0;
  margin: 22px auto 0; max-width: 980px; }
#__tour .t-card li { background: #18223a; border: 1px solid rgba(255, 255, 255, .14); border-radius: 999px; padding: 6px 14px;
  font-size: 15px; color: #b4bfd3; }
#__tour .t-stage { display: grid; place-items: center; }
#__tour .t-chapter { position: fixed; left: 18px; bottom: 16px; padding: 7px 14px; border-radius: 999px;
  background: rgba(11, 16, 32, .9); border: 1px solid rgba(255, 255, 255, .18); font-size: 14px; font-weight: 650;
  color: #d5dcea; opacity: 0; transition: opacity .3s; }
#__tour .t-chapter.on { opacity: 1; }
#__tour .t-badge { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); background: #f5a524; color: #0b1020;
  font-weight: 800; font-size: 13px; letter-spacing: .07em; padding: 6px 14px; border-radius: 999px; opacity: 0; transition: opacity .3s; }
#__tour .t-badge.on { opacity: 1; }

/* concept scenes on the stage */
#__tour .c-wrap { width: min(1120px, 92vw); }
#__tour .c-title { font-size: 38px; font-weight: 800; margin: 0 0 8px; letter-spacing: -.01em; }
#__tour .c-sub { color: #b4bfd3; font-size: 20px; margin: 0 0 30px; }
#__tour [data-step] { opacity: 0; transform: translateY(10px); transition: opacity .45s ease, transform .45s ease; }
#__tour [data-step].on { opacity: 1; transform: none; }
#__tour .c-row { display: flex; align-items: stretch; gap: 14px; }
#__tour .c-box { flex: 1; background: #18223a; border: 1px solid rgba(255, 255, 255, .14); border-radius: 14px; padding: 16px; text-align: center; }
#__tour .c-box b { display: block; font-size: 28px; margin: 4px 0; }
#__tour .c-box small { color: #8391ab; font-size: 14px; }
#__tour .c-box.gold { border-color: #f5a524; box-shadow: 0 0 0 1px #f5a524 inset; }
#__tour .c-box.red { border-color: #e66767; background: rgba(230, 103, 103, .12); }
#__tour .c-arrow { align-self: center; color: #f5a524; font-weight: 800; font-size: 17px; white-space: nowrap; }
#__tour .c-note { margin-top: 26px; font-size: 21px; color: #d5dcea; }
#__tour .c-note strong { color: #fff; }
#__tour .c-bars { display: grid; gap: 12px; }
#__tour .c-barrow { display: grid; grid-template-columns: 260px 1fr 90px; align-items: center; gap: 14px; font-size: 18px; }
#__tour .c-barrow span:first-child { color: #b4bfd3; }
#__tour .c-track { height: 22px; border-radius: 6px; background: #1c2c4d; overflow: hidden; }
#__tour .c-track i { display: block; height: 100%; width: 0; border-radius: 6px; background: #3987e5; transition: width .9s ease; }
#__tour [data-step].on .c-track i { width: var(--w); }
#__tour .c-barrow b { text-align: right; font-variant-numeric: tabular-nums; }
#__tour .c-eq { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 40px; font-weight: 800; margin: 20px 0; }
#__tour .c-eq .op { color: #8391ab; font-weight: 600; }
#__tour .c-eq .res { color: #f5a524; }
#__tour .c-win { background: #121a2e; border: 1px solid rgba(255, 255, 255, .16); border-radius: 10px; overflow: hidden; text-align: left; min-height: 170px; }
#__tour .c-win .bar { background: #212c48; padding: 8px 12px; font-size: 14px; font-weight: 700; }
#__tour .c-win .body { padding: 14px 12px; font-size: 15px; color: #b4bfd3; display: grid; gap: 10px; }
#__tour .c-win.warn .bar { background: #1f4f8f; color: #fff; }
#__tour .c-btn { display: inline-block; background: #f5a524; color: #0b1020; border-radius: 6px; padding: 5px 12px; font-weight: 800; font-size: 14px; justify-self: start; }
#__tour .c-link { color: #7fb2ff; text-decoration: underline; font-size: 14px; }
#__tour .c-progress { height: 10px; border-radius: 5px; background: #1c2c4d; overflow: hidden; }
#__tour .c-progress i { display: block; height: 100%; width: 100%; background: #3987e5; }
#__tour .c-caption { margin-top: 10px; font-size: 16px; color: #d5dcea; text-align: center; }
#__tour .c-phone { width: 290px; height: 560px; border-radius: 40px; border: 10px solid #26324f; background: #0f1526;
  margin: 0 auto; display: grid; place-items: center; position: relative; box-shadow: 0 24px 60px rgba(0, 0, 0, .5); }
#__tour .c-sheet { width: 230px; background: #f4f6fb; color: #10131c; border-radius: 14px; padding: 18px; text-align: left; font-size: 16px; line-height: 1.4; }
#__tour .c-sheet b { display: block; margin-bottom: 8px; }
#__tour .c-pin { display: flex; gap: 10px; margin: 14px 0 6px; }
#__tour .c-pin i { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #3b4660; }
#__tour .c-pin i.on { background: #3b4660; }
#__tour .c-ok { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; background: rgba(12, 163, 12, .92);
  color: #fff; font-size: 24px; font-weight: 800; border-radius: 30px; }
#__tour .c-ok big { font-size: 64px; display: block; }
`;

/** Runs in the page: adds the layer and window.__tour (no-op if already there). */
export function installOverlay({ css, cursorAt }) {
  if (window.__tour) return;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const root = document.createElement('div');
  root.id = '__tour';
  root.setAttribute('popover', 'manual'); // the top layer: above modal dialogs too
  root.innerHTML = `
    <div class="t-stage"></div>
    <div class="t-card"></div>
    <div class="t-spot"></div>
    <div class="t-callout"><b></b><p></p></div>
    <div class="t-chapter"></div>
    <div class="t-badge"></div>
    <div class="t-ripple"></div>
    <svg class="t-cursor" viewBox="0 0 30 30"><path d="M3 2 L3 24 L9 18.5 L13.2 27.5 L17 25.8 L12.8 17 L21 17 Z" fill="#fff" stroke="#0b1020" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  document.body.append(root);
  root.showPopover();
  const $ = (selector) => root.querySelector(selector);
  const raise = () => {
    // Re-showing puts the layer back on top of anything opened since (e.g. a modal dialog).
    if (document.querySelector('dialog[open]')) {
      root.hidePopover();
      root.showPopover();
    }
  };
  const place = (x, y, ms) => {
    const cursor = $('.t-cursor');
    cursor.style.transitionDuration = `${ms}ms`;
    cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`; // the tip of the arrow is the hotspot
    cursor.style.opacity = '1';
  };
  place(cursorAt.x, cursorAt.y, 0);
  $('.t-cursor').style.opacity = '0'; // shown on its first move
  window.__tour = {
    raise,
    cursor(x, y, ms) {
      raise();
      place(x, y, ms);
    },
    hideCursor() {
      $('.t-cursor').style.opacity = '0';
    },
    ripple(x, y) {
      const r = $('.t-ripple');
      r.style.left = `${x}px`;
      r.style.top = `${y}px`;
      r.classList.remove('go');
      void r.offsetWidth;
      r.classList.add('go');
    },
    spot(rect, pad = 8) {
      raise();
      const s = $('.t-spot');
      if (!rect) return s.classList.remove('on');
      // Moving between targets glides; appearing after being hidden fades in where it is.
      const appearing = !s.classList.contains('on');
      if (appearing) s.style.transitionProperty = 'opacity';
      Object.assign(s.style, {
        left: `${rect.x - pad}px`,
        top: `${rect.y - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
      });
      if (appearing) {
        void s.offsetWidth;
        s.style.transitionProperty = '';
      }
      s.classList.add('on');
    },
    callout({ title = '', body = '', rect, side }) {
      raise();
      const el = $('.t-callout');
      el.querySelector('b').textContent = title;
      el.querySelector('p').textContent = body;
      el.classList.remove('on');
      const W = window.innerWidth;
      const H = window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 24;
      const room = { right: W - rect.x - rect.width, left: rect.x, below: H - rect.y - rect.height, above: rect.y - 60 };
      const fits = { right: room.right > w + gap + 12, left: room.left > w + gap + 12, below: room.below > h + gap + 12, above: room.above > h + gap };
      // The requested side if there's room, otherwise the first side that fits.
      side = [side, 'right', 'left', 'below', 'above'].find((s) => s && fits[s]) ?? 'below';
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      let x;
      let y;
      if (side === 'right' || side === 'left') {
        x = side === 'right' ? rect.x + rect.width + gap : rect.x - w - gap;
        y = rect.y + rect.height / 2 - h / 2;
      } else {
        x = rect.x + rect.width / 2 - w / 2;
        y = side === 'below' ? rect.y + rect.height + gap : rect.y - h - gap;
      }
      x = clamp(x, 14, W - w - 14); // always fully on screen
      y = clamp(y, 70, H - h - 14);
      el.style.setProperty('--ay', `${clamp(rect.y + rect.height / 2 - y, 18, h - 18)}px`);
      el.style.setProperty('--ax', `${clamp(rect.x + rect.width / 2 - x, 18, w - 18)}px`);
      el.className = `t-callout side-${side}`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      requestAnimationFrame(() => el.classList.add('on'));
    },
    hideCallout() {
      $('.t-callout').classList.remove('on');
    },
    card(html) {
      raise();
      const card = $('.t-card');
      if (html == null) return card.classList.remove('on');
      $('.t-cursor').style.opacity = '0'; // back on its next move
      card.innerHTML = html;
      requestAnimationFrame(() => card.classList.add('on'));
    },
    stage(html) {
      raise();
      const stage = $('.t-stage');
      if (html == null) return stage.classList.remove('on');
      $('.t-cursor').style.opacity = '0';
      stage.innerHTML = html;
      requestAnimationFrame(() => stage.classList.add('on'));
    },
    stageStep(n) {
      for (const el of $('.t-stage').querySelectorAll('[data-step]')) el.classList.toggle('on', Number(el.dataset.step) <= n);
    },
    chapter(text) {
      const el = $('.t-chapter');
      el.textContent = text ?? '';
      el.classList.toggle('on', Boolean(text));
    },
    badge(text) {
      const el = $('.t-badge');
      el.textContent = text ?? '';
      el.classList.toggle('on', Boolean(text));
    },
  };
}
