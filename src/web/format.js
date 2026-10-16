// Formatting and tiny DOM helpers for the app UI and the website (browser only).

const amount = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat('en');

/** 123456 cents -> "1,234.56" */
export const fmtMoney = (cents) => (Number.isFinite(cents) ? amount.format(cents / 100) : '—');

/** Signed, with a real minus sign: "+1.20", "−3.40", "0.00". */
export function fmtSigned(cents) {
  if (!Number.isFinite(cents)) return '—';
  const rounded = Math.round(cents);
  return (rounded > 0 ? '+' : rounded < 0 ? '−' : '') + fmtMoney(Math.abs(rounded));
}

export const fmtCount = (n) => count.format(n);

/** 0.0347 -> "3.47%", with more decimals for small chances. */
export function fmtPct(x) {
  if (!Number.isFinite(x)) return '—';
  const pct = 100 * x;
  const digits = x >= 0.1 || x === 0 ? 1 : x >= 0.001 ? 2 : 4;
  return `${pct.toFixed(digits)}%`;
}

/** 0.0347 -> "about 1 in 29" */
export function oneIn(p) {
  if (!(p > 0)) return 'never';
  if (p >= 0.5) return `${fmtPct(p)} of the time`;
  const n = 1 / p;
  return `about 1 in ${n >= 100 ? count.format(Math.round(n)) : n.toFixed(n < 10 ? 1 : 0)}`;
}

export const fmtDate = (ms) =>
  ms == null ? 'never' : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-GB');

/**
 * h('p', { class: 'x', onclick }, 'text', child) - strings become text nodes, never HTML.
 * Attributes: class, dataset-style data-*, aria-*, on* listeners, hidden, and the rest via setAttribute.
 */
export function h(tag, attrs = {}, ...children) {
  const isSvg = ['svg', 'g', 'rect', 'path', 'line', 'text', 'title', 'circle'].includes(tag);
  const node = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (name === 'text') node.textContent = value;
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
