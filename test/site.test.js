// The website build: every page renders with the product's details, prices and the
// explainer, links resolve (the build checks), and a release's installer is published.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(path.join(ROOT, 'product.config.json'), 'utf8'));
const build = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-site.js'), ...args], { cwd: ROOT, stdio: 'pipe' });

test('the website builds with every page filled in', () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'chainpilot-site-'));
  try {
    build('--out', out);
    const pages = readdirSync(out).filter((f) => f.endsWith('.html'));
    assert.deepEqual(pages.sort(), ['404.html', 'download.html', 'guide.html', 'index.html', 'privacy.html', 'responsible-gambling.html', 'strategy.html', 'subscribe.html', 'terms.html', 'tutorial.html']);
    for (const page of pages) {
      const html = readFileSync(path.join(out, page), 'utf8');
      assert.doesNotMatch(html, /\{\{|\}\}/, `${page} has an unreplaced token`);
      assert.match(html, new RegExp(`<title>[^<]*${config.name}`), `${page} title`);
      assert.match(html, /Content-Security-Policy/, `${page} CSP`);
    }
    const home = readFileSync(path.join(out, 'index.html'), 'utf8');
    for (const plan of config.plans) assert.match(home, new RegExp(`>${plan.price} <small>${config.currency}`));
    assert.match(home, /doesn't predict rounds/);
    const strategy = readFileSync(path.join(out, 'strategy.html'), 'utf8');
    assert.match(strategy, /assets\/shared\/web\/explainer\.css/);
    assert.match(strategy, /strategy-page\.js/);
    assert.match(readFileSync(path.join(out, 'assets', 'config.js'), 'utf8'), /"apiUrl"/);
    for (const file of ['revoked.json', 'selectors.json', 'favicon.ico', 'assets/shared/compounding.js', 'assets/shared/web/explainer.js']) {
      assert.ok(readFileSync(path.join(out, file)), file);
    }
    assert.match(readFileSync(path.join(out, 'download.html'), 'utf8'), /first release is on its way/);

    // The video tutorial: embedded with captions and chapters once tools/video/make-video.js has made it.
    const tutorial = readFileSync(path.join(out, 'tutorial.html'), 'utf8');
    const videoInfo = path.join(ROOT, 'site', 'assets', 'video', 'tutorial.json');
    try {
      const video = JSON.parse(readFileSync(videoInfo, 'utf8'));
      assert.match(tutorial, new RegExp(`<source src="assets/video/${video.video}"`));
      assert.match(tutorial, /<track kind="captions"/);
      assert.equal((tutorial.match(/class="chapters"[\s\S]*?<\/ol>/)[0].match(/data-seek=/g) ?? []).length, video.chapters.length);
      assert.match(tutorial, /Read the transcript/);
      assert.match(home, /See it in action/);
      assert.match(strategy, /tutorial\.html#t=/);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      assert.match(tutorial, /video tutorial is on its way/);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('with a release, the installer is published on the download page', () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'chainpilot-site-'));
  const downloads = mkdtempSync(path.join(os.tmpdir(), 'chainpilot-dl-'));
  try {
    const latest = { version: '9.9.9', file: 'App-Setup-9.9.9.exe', size: 26_000_000, sha256: 'ab'.repeat(32), date: '2026-10-16T00:00:00Z' };
    writeFileSync(path.join(downloads, 'latest.json'), JSON.stringify(latest));
    writeFileSync(path.join(downloads, latest.file), 'installer');
    build('--out', out, '--downloads', downloads);
    const page = readFileSync(path.join(out, 'download.html'), 'utf8');
    assert.match(page, /href="downloads\/App-Setup-9\.9\.9\.exe"/);
    assert.match(page, new RegExp(latest.sha256));
    assert.match(page, /24\.8 MB/);
    assert.equal(readFileSync(path.join(out, 'downloads', latest.file), 'utf8'), 'installer');
    assert.equal(JSON.parse(readFileSync(path.join(out, 'downloads', 'latest.json'), 'utf8')).version, '9.9.9');
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(downloads, { recursive: true, force: true });
  }
});
