// A column chart of simulated session results: one column per outcome (or bin),
// losses and gains in the two diverging colors, a hover/focus tooltip per column,
// a legend, and a table view with the same numbers. Colors come from CSS
// variables (--loss, --gain, --flat) set in explainer.css.
import { fmtCount, fmtPct, fmtSigned, h } from './format.js';

const PAD = { top: 22, right: 8, bottom: 30, left: 44 };
const HEIGHT = 230;

/**
 * bins: [{ from, to, count, sign }] from compounding.histogram(); total: number of sessions.
 * Re-renders itself when the container is resized. Returns { destroy }.
 */
export function renderResultsChart(container, bins, total) {
  container.replaceChildren();
  const figure = h('figure', { class: 'chart' });
  const canvas = h('div', {});
  const tooltip = h('div', { class: 'chart-tooltip', role: 'status', hidden: true });
  const plot = h('div', { class: 'chart-plot' }, canvas, tooltip); // positioned: the tooltip is placed inside it
  const tableWrap = h('div', { class: 'chart-table', hidden: true }, resultsTable(bins, total));
  const toggle = h('button', { type: 'button', class: 'link-button' }, 'Show as table');
  toggle.addEventListener('click', () => {
    const showTable = tableWrap.hidden;
    tableWrap.hidden = !showTable;
    plot.hidden = showTable;
    toggle.textContent = showTable ? 'Show as chart' : 'Show as table';
  });
  const legend = h(
    'div',
    { class: 'chart-legend' },
    h('span', {}, h('i', { class: 'swatch loss' }), 'Ended down'),
    h('span', {}, h('i', { class: 'swatch gain' }), 'Ended up'),
    bins.some((b) => b.sign === 0) ? h('span', {}, h('i', { class: 'swatch flat' }), 'Broke even') : null,
    toggle,
  );
  figure.append(legend, plot, tableWrap);
  container.append(figure);

  let drawnWidth = 0;
  const draw = () => {
    const width = Math.max(280, Math.floor(plot.clientWidth || container.clientWidth || 600));
    if (width === drawnWidth) return;
    drawnWidth = width;
    tooltip.hidden = true;
    canvas.replaceChildren(svgChart(bins, total, width, tooltip));
  };
  draw();
  const observer = new ResizeObserver(draw);
  observer.observe(plot);
  return { destroy: () => observer.disconnect() };
}

function label(bin) {
  return bin.from === bin.to ? fmtSigned(bin.from) : `${fmtSigned(bin.from)} to ${fmtSigned(bin.to)}`;
}

/** The chart at `width` px, drawn 1:1 so the tooltip can be placed in SVG coordinates. */
function svgChart(bins, total, width, tooltip) {
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const maxShare = Math.max(...bins.map((b) => b.count / total));
  const top = niceCeil(maxShare);
  const y = (share) => PAD.top + innerH - (share / top) * innerH;
  const slot = innerW / bins.length;
  const barW = Math.max(2, Math.min(24, slot - 2)); // thin columns, at least a 2px gap
  const svg = h('svg', {
    viewBox: `0 0 ${width} ${HEIGHT}`,
    width,
    height: HEIGHT,
    role: 'img',
    'aria-label': `Share of ${fmtCount(total)} simulated sessions by final result`,
  });

  // Recessive hairline grid with clean percentage ticks.
  for (let i = 0; i <= 4; i++) {
    const share = (top * i) / 4;
    const gy = y(share);
    svg.append(
      h('line', { x1: PAD.left, x2: width - PAD.right, y1: gy, y2: gy, class: i === 0 ? 'axis' : 'grid' }),
      h('text', { x: PAD.left - 6, y: gy + 4, class: 'tick', 'text-anchor': 'end' }, `${Math.round(share * 100)}%`),
    );
  }

  // Label only a few columns on the x axis: the first, the last, and the tallest of each sign.
  const tallest = (sign) => bins.reduce((best, b, i) => (b.sign === sign && (best < 0 || b.count > bins[best].count) ? i : best), -1);
  const marked = new Set([0, bins.length - 1, tallest(-1), tallest(1)].filter((i) => i >= 0));
  const direct = new Set([tallest(-1), tallest(1)].filter((i) => i >= 0));

  bins.forEach((bin, i) => {
    const share = bin.count / total;
    const cx = PAD.left + slot * i + slot / 2;
    const x = cx - barW / 2;
    const yTop = y(share);
    const hBar = Math.max(1, PAD.top + innerH - yTop);
    const r = Math.min(4, barW / 2, hBar);
    const cls = bin.sign < 0 ? 'loss' : bin.sign > 0 ? 'gain' : 'flat';
    const text = `${label(bin)}: ${fmtPct(share)} of sessions (${fmtCount(bin.count)})`;
    const group = h('g', { class: `bar ${cls}`, tabindex: 0, role: 'img', 'aria-label': text });
    // Hit target: the whole column slot, taller than the bar itself.
    group.append(h('rect', { x: PAD.left + slot * i, y: PAD.top, width: slot, height: innerH, class: 'hit' }));
    // 4px rounded data-end, square at the baseline.
    group.append(
      h('path', {
        class: 'mark',
        d: `M${x},${yTop + hBar} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + hBar} Z`,
      }),
    );
    if (direct.has(i)) group.append(h('text', { x: cx, y: yTop - 6, class: 'value', 'text-anchor': 'middle' }, fmtPct(share)));
    if (marked.has(i)) {
      group.append(h('text', { x: cx, y: HEIGHT - 10, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === bins.length - 1 ? 'end' : 'middle' }, label(bin)));
    }
    const show = () => {
      tooltip.replaceChildren(h('strong', {}, fmtPct(share)), h('span', {}, ` of sessions ended at ${label(bin)}`), h('small', {}, `${fmtCount(bin.count)} of ${fmtCount(total)}`));
      tooltip.hidden = false;
      tooltip.style.left = `${Math.max(0, Math.min(cx - 90, width - 180))}px`;
      tooltip.style.top = `${Math.max(0, yTop - 70)}px`;
    };
    const hide = () => (tooltip.hidden = true);
    group.addEventListener('pointerenter', show);
    group.addEventListener('pointerleave', hide);
    group.addEventListener('focus', show);
    group.addEventListener('blur', hide);
    svg.append(group);
  });
  return svg;
}

function resultsTable(bins, total) {
  return h(
    'table',
    { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Session result'), h('th', { scope: 'col', class: 'num' }, 'Sessions'), h('th', { scope: 'col', class: 'num' }, 'Share'))),
    h(
      'tbody',
      {},
      bins.map((b) => h('tr', {}, h('td', {}, label(b)), h('td', { class: 'num' }, fmtCount(b.count)), h('td', { class: 'num' }, fmtPct(b.count / total)))),
    ),
  );
}

/** A clean axis maximum just above x (a share between 0 and 1). */
function niceCeil(x) {
  for (const step of [0.05, 0.1, 0.2, 0.25, 0.5, 1]) {
    const top = Math.ceil(x / step) * step;
    if (top / step <= 5) return Math.min(1, Math.max(step, top));
  }
  return 1;
}
