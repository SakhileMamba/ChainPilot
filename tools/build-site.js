#!/usr/bin/env node
// Builds the website for GitHub Pages into dist/site:
//   - each site/*.html page is wrapped in site/_layout.html with the shared header and footer
//   - {{name}} tokens are filled from product.config.json (HTML-escaped); {{{name}}} inserts generated HTML
//   - assets, the website's resources (revoked.json, selectors.json) and the browser modules
//     shared with the app (the compounding explainer) are copied
//   - with --downloads <dir>: the installer and latest.json from that folder go to downloads/
// It fails on unknown tokens and on links to files that don't exist.
//
//   node tools/build-site.js [--out dist/site] [--downloads dist/windows]
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const { values } = parseArgs({
  options: { out: { type: 'string', default: path.join(ROOT, 'dist', 'site') }, downloads: { type: 'string' } },
});
const OUT = path.resolve(values.out);
const config = JSON.parse(readFileSync(path.join(ROOT, 'product.config.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// Browser modules shared with the app's control panel (keep in step with desktop/server.js).
const SHARED = ['strategy.js', 'compounding.js', 'plan.js', 'web/format.js', 'web/charts.js', 'web/explainer.js', 'web/theme.css', 'web/explainer.css'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const placeholder = (url) => !url || /YOUR-|example\.com/i.test(url);
const warnings = [];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---- downloads (the installer, from the Windows build) ----
let download = null;
if (values.downloads) {
  const latestFile = path.join(values.downloads, 'latest.json');
  if (!existsSync(latestFile)) throw new Error(`No latest.json in ${values.downloads}`);
  download = JSON.parse(readFileSync(latestFile, 'utf8'));
  mkdirSync(path.join(OUT, 'downloads'), { recursive: true });
  copyFileSync(path.join(values.downloads, download.file), path.join(OUT, 'downloads', download.file));
  copyFileSync(latestFile, path.join(OUT, 'downloads', 'latest.json'));
} else {
  warnings.push('no --downloads given: the download page says the first release is coming');
}

// ---- generated blocks ----
const { name, currency, plans, support = {}, manualPayment = {}, game } = config;
const apiOrigin = config.apiUrl ? new URL(config.apiUrl).origin : '';
if (placeholder(config.siteUrl)) warnings.push('siteUrl in product.config.json is still the template value');
if (!config.apiUrl) warnings.push('apiUrl is empty: the subscribe page offers manual payment only');

const contacts = [
  support.whatsapp && `<a href="https://wa.me/${esc(support.whatsapp.replace(/\D/g, ''))}">WhatsApp: ${esc(support.whatsapp)}</a>`,
  support.email && `<a href="mailto:${esc(support.email)}">${esc(support.email)}</a>`,
].filter(Boolean);
if (!contacts.length) warnings.push('no support WhatsApp number or email in product.config.json');

const planCards = `<div class="price-grid">${plans
  .map(
    (p) => `
  <article class="card price-card${p.best ? ' best' : ''}">
    ${p.best ? '<span class="tag">Best value</span>' : ''}
    <h3>${esc(p.name)}</h3>
    <p class="price">${esc(p.price)} <small>${esc(currency)}</small></p>
    <p class="per-day">${p.days ? `${esc(currency)} ${(p.price / p.days).toFixed(2)} a day` : 'No end date'}</p>
    <a class="btn${p.best ? ' primary' : ''}" href="subscribe.html">Subscribe</a>
  </article>`,
  )
  .join('')}
</div>`;

const bestPlan = plans.find((p) => p.best) ?? plans[0];
const planOptions = plans
  .map(
    (p) =>
      `<label class="plan-choice"><input type="radio" name="plan" value="${esc(p.id)}"${p === bestPlan ? ' checked' : ''} /><b>${esc(p.name)}</b><span class="amount">${esc(currency)} ${esc(p.price)}</span></label>`,
  )
  .join('\n');

const downloadCard = download
  ? `<div class="card download-card">
  <a class="btn primary big" href="downloads/${esc(download.file)}" download>Download ${esc(name)} ${esc(download.version)} for Windows</a>
  <dl>
    <dt>Version</dt><dd>${esc(download.version)}, ${esc(new Date(download.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</dd>
    <dt>Size</dt><dd>${(download.size / 1_048_576).toFixed(1)} MB</dd>
    <dt>SHA-256</dt><dd><code>${esc(download.sha256)}</code></dd>
  </dl>
</div>`
  : `<div class="card download-card"><p><strong>The first release is on its way.</strong> Please check back soon.</p></div>`;

const manualBlock =
  manualPayment.momoNumber || support.whatsapp
    ? `<div class="card manual-card">
  <h2>Pay manually</h2>
  <ol>
    ${manualPayment.momoNumber ? `<li>Send the plan price with MTN MoMo to <strong>${esc(manualPayment.momoNumber)}</strong>${manualPayment.accountName ? ` (${esc(manualPayment.accountName)})` : ''}.</li>` : ''}
    <li>Send us the MoMo transaction ID and your machine ID${support.whatsapp ? ` on WhatsApp (${esc(support.whatsapp)})` : ''}.</li>
    <li>We reply with your license key. In ${esc(name)}, open Subscription, paste it and press "Activate key".</li>
  </ol>
</div>`
    : '';

// ---- the video tutorial (made by tools/video/make-video.js), if there is one ----
const videoInfo = path.join(SITE, 'assets', 'video', 'tutorial.json');
const video = existsSync(videoInfo) ? JSON.parse(readFileSync(videoInfo, 'utf8')) : null;
if (!video) warnings.push('no video tutorial yet (npm run video): the tutorial page says it is coming');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const player = (preload) =>
  `<figure class="video-frame">
    <video id="tutorial-video" controls playsinline preload="${preload}" poster="assets/video/${esc(video.poster)}" width="1920" height="1080">
      <source src="assets/video/${esc(video.video)}" type="video/mp4" />
      <track kind="captions" src="assets/video/${esc(video.captions)}" srclang="en" label="English" default />
      Your browser can't play this video. <a href="assets/video/${esc(video.video)}">Download it</a> instead.
    </video>
  </figure>
  <p class="video-meta">${clock(video.duration)} · ${(video.size / 1_048_576).toFixed(0)} MB · captions available</p>`;
const strategyChapter = video?.chapters.find((c) => /compounding/i.test(c.title));

const vars = {
  name,
  tagline: config.tagline,
  publisher: config.publisher,
  minimumAge: config.minimumAge,
  currency,
  country: config.country,
  game,
  version,
  year: new Date().getFullYear(),
  rtpPercent: pct(game.rtp),
  edgePercent: pct(1 - game.rtp),
  lowestPrice: Math.min(...plans.map((p) => p.price)),
  installerName: download?.file ?? `${name}-Setup-${version}.exe`,
  absRoot: placeholder(config.siteUrl) ? '' : config.siteUrl,
  csp: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}; object-src 'none'; base-uri 'self'; form-action 'self'`,
  planCards,
  planOptions,
  downloadCard,
  manualPayment: manualBlock,
  contactLinks: contacts.length ? `<div class="contact">${contacts.join('')}</div>` : '<p class="muted">Contact details are coming soon.</p>',
  helplineList: `<ul>${(config.helplines ?? []).map((l) => `<li><a href="${esc(l.url)}" rel="noopener">${esc(l.name)}</a>${l.phone ? `: ${esc(l.phone)}` : ''}</li>`).join('')}</ul>`,
  videoPlayer: video ? player('metadata') : '<div class="card"><p><strong>The video tutorial is on its way.</strong> Meanwhile, the <a href="guide.html">user guide</a> covers everything.</p></div>',
  videoTeaser: video
    ? `<section class="wrap section narrow" aria-labelledby="video-title">
  <h2 id="video-title" class="section-title">See it in action</h2>
  <p class="section-lead">A ${Math.round(video.duration / 60)}-minute walkthrough: install, set your plan, how compounding really works, subscribe with MoMo, and play.</p>
  ${player('none')}
  <p class="center"><a href="tutorial.html">Chapters and transcript</a></p>
</section>`
    : '',
  videoChapters: video
    ? `<ol class="chapters">${video.chapters.map((c) => `<li><button type="button" data-seek="${c.start}"><span class="time">${clock(c.start)}</span>${esc(c.title)}</button></li>`).join('')}</ol>`
    : '',
  videoTranscript: video
    ? `<details class="transcript card"><summary>Read the transcript</summary>${video.transcript
        .map(
          (t, i) =>
            `${i === 0 || video.transcript[i - 1].chapter !== t.chapter ? `<h3>${esc(t.chapter)}</h3>` : ''}<p><button type="button" class="ts" data-seek="${t.start}">${clock(t.start)}</button><span>${esc(t.text)}</span></p>`,
        )
        .join('')}</details>`
    : '',
  strategyVideoLink: strategyChapter
    ? `<p class="video-link"><a class="btn" href="tutorial.html#t=${strategyChapter.start}">▶ Watch it explained in the video (${clock(strategyChapter.start)})</a></p>`
    : '',
};

// ---- templates ----
const partials = Object.fromEntries(readdirSync(path.join(SITE, '_partials')).map((f) => [path.basename(f, '.html'), readFileSync(path.join(SITE, '_partials', f), 'utf8')]));
const layout = readFileSync(path.join(SITE, '_layout.html'), 'utf8');

function lookup(data, key, where) {
  const value = key.split('.').reduce((obj, part) => obj?.[part], data);
  if (value === undefined || value === null) throw new Error(`${where}: unknown token {{${key}}}`);
  return value;
}

/** One pass, so inserted HTML is never scanned for tokens again. */
function render(template, data, where) {
  return template.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{>\s*([\w-]+)\s*\}\}|\{\{\s*([\w.]+)\s*\}\}/g, (_, raw, partial, text) => {
    if (partial) {
      if (!(partial in partials)) throw new Error(`${where}: unknown partial {{> ${partial}}}`);
      return render(partials[partial], data, `${where} > ${partial}`);
    }
    if (raw) return String(lookup(data, raw, where));
    return esc(lookup(data, text, where));
  });
}

const basePath = placeholder(config.siteUrl) ? '/' : new URL(config.siteUrl).pathname;
for (const file of readdirSync(SITE).filter((f) => f.endsWith('.html') && !f.startsWith('_'))) {
  const source = readFileSync(path.join(SITE, file), 'utf8');
  const header = /^<!--(\{[\s\S]*?\})-->\s*/.exec(source);
  if (!header) throw new Error(`${file}: missing the <!--{ ... }--> page header`);
  const page = JSON.parse(header[1]);
  const data = {
    ...vars,
    root: file === '404.html' ? basePath : '', // the 404 page is served at any address
    page: {
      ...page,
      fullTitle: page.id === 'home' ? `${name}: ${page.title}` : `${page.title} · ${name}`,
      head: page.head ?? '',
      scripts: page.scripts ?? '',
    },
  };
  data.content = render(source.slice(header[0].length), data, file);
  writeFileSync(path.join(OUT, file), render(layout, data, `${file} (layout)`));
}

// ---- files ----
cpSync(path.join(SITE, 'assets'), path.join(OUT, 'assets'), { recursive: true });
for (const file of SHARED) {
  mkdirSync(path.dirname(path.join(OUT, 'assets', 'shared', file)), { recursive: true });
  copyFileSync(path.join(ROOT, 'src', file), path.join(OUT, 'assets', 'shared', file));
}
copyFileSync(path.join(ROOT, 'desktop', 'ui', 'icon.svg'), path.join(OUT, 'assets', 'icon.svg'));
for (const file of ['revoked.json', 'selectors.json', 'robots.txt', 'favicon.ico']) {
  if (existsSync(path.join(SITE, file))) copyFileSync(path.join(SITE, file), path.join(OUT, file));
}
writeFileSync(path.join(OUT, '.nojekyll'), '');
writeFileSync(
  path.join(OUT, 'assets', 'config.js'),
  `// Generated by tools/build-site.js from product.config.json
export default ${JSON.stringify({ name, apiUrl: config.apiUrl, currency, rtp: game.rtp, country: config.country, plans }, null, 2)};
`,
);

// ---- check every local link and asset ----
const broken = [];
for (const file of readdirSync(OUT).filter((f) => f.endsWith('.html') && f !== '404.html')) {
  const html = readFileSync(path.join(OUT, file), 'utf8');
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#|data:)/.test(ref)) continue;
    const target = path.join(OUT, decodeURI(ref.split(/[?#]/)[0]));
    if (!existsSync(target) || !statSync(target).isFile()) broken.push(`${file} -> ${ref}`);
  }
}
if (broken.length) throw new Error(`Broken links:\n  ${broken.join('\n  ')}`);

for (const w of warnings) console.warn(`warning: ${w}`);
console.log(`Website built in ${path.relative(process.cwd(), OUT) || OUT}${download ? ` with ${download.file}` : ''}.`);
