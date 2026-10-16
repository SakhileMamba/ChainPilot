#!/usr/bin/env node
// Builds the Windows installer: dist/windows/<Name>-Setup-<version>.exe and latest.json.
// Runs on Windows, macOS or Linux; needs NSIS's makensis (brew install makensis /
// apt-get install nsis / choco install nsis).
//
//   npm run build:win                    newest Node.js 24 for Windows (checksum-verified)
//   npm run build:win -- --node 24.11.1  a specific Node.js version
//
// The installer contains the official node.exe (unchanged, so it keeps its signature),
// the app's JavaScript, and playwright-core - which drives the Chrome or Edge already
// installed on the customer's PC, so no browser is bundled.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/sign.js';

const NODE_LINE = '24'; // the Node.js major version shipped to customers (an LTS line)
const { values } = parseArgs({ options: { node: { type: 'string' } } });
const config = JSON.parse(readFileSync(path.join(ROOT, 'product.config.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUT = path.join(ROOT, 'dist', 'windows');
const STAGE = path.join(OUT, 'stage');
const CACHE = path.join(ROOT, '.cache', 'node');
const installerName = `${config.name}-Setup-${pkg.version}.exe`;

const fail = (message) => {
  console.error(`Error: ${message}`);
  process.exit(1);
};
const step = (message) => console.log(`- ${message}`);

// ---- checks ----
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail(`package.json version must be x.y.z (is ${pkg.version})`);
if (!/PUBLIC_KEY = '[A-Za-z0-9+/=]{40,}'/.test(readFileSync(path.join(ROOT, 'src', 'public-key.js'), 'utf8'))) {
  fail('src/public-key.js has no key. Run "npm run keys" first.');
}
let makensis = 'makensis';
try {
  execFileSync(makensis, ['-VERSION'], { stdio: 'ignore' });
} catch {
  const windowsDefault = 'C:\\Program Files (x86)\\NSIS\\makensis.exe';
  if (process.platform === 'win32' && existsSync(windowsDefault)) makensis = windowsDefault;
  else fail('makensis (NSIS) not found. Install it: brew install makensis | apt-get install nsis | choco install nsis');
}
if (/YOUR-|example\.com/i.test(config.siteUrl)) console.warn('warning: siteUrl in product.config.json is still the template value');
if (!config.apiUrl) console.warn('warning: apiUrl is empty, so the app can only take manual payments');

// ---- Node.js for Windows ----
async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}
async function resolveNodeVersion() {
  if (values.node) return values.node.replace(/^v/, '');
  const index = JSON.parse(await getText('https://nodejs.org/dist/index.json'));
  const match = index.find((r) => r.version.startsWith(`v${NODE_LINE}.`) && r.files.includes('win-x64-zip'));
  if (!match) fail(`no Node.js ${NODE_LINE}.x for win-x64 found`);
  return match.version.slice(1);
}
const nodeVersion = await resolveNodeVersion();
const zipName = `node-v${nodeVersion}-win-x64.zip`;
const zipFile = path.join(CACHE, zipName);
const sums = await getText(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`);
const expected = sums.split('\n').find((line) => line.endsWith(`  ${zipName}`))?.split(/\s+/)[0];
if (!expected) fail(`${zipName} is not in SHASUMS256.txt`);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
if (!existsSync(zipFile) || sha256(readFileSync(zipFile)) !== expected) {
  step(`downloading Node.js ${nodeVersion} for Windows`);
  const res = await fetch(`https://nodejs.org/dist/v${nodeVersion}/${zipName}`);
  if (!res.ok) fail(`download failed: ${res.status}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
}
const zip = readFileSync(zipFile);
if (sha256(zip) !== expected) fail(`${zipName} does not match its published SHA-256 checksum`);
step(`Node.js ${nodeVersion} verified (sha256 ${expected.slice(0, 16)}…)`);

/** Extract one file from a ZIP archive (central directory + deflate; no ZIP64 needed here). */
function unzipEntry(archive, wanted) {
  let eocd = archive.length - 22;
  while (eocd >= 0 && archive.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a ZIP file');
  let p = archive.readUInt32LE(eocd + 16);
  for (let i = 0, n = archive.readUInt16LE(eocd + 10); i < n; i++) {
    const method = archive.readUInt16LE(p + 10);
    const size = archive.readUInt32LE(p + 20);
    const nameLength = archive.readUInt16LE(p + 28);
    const skip = nameLength + archive.readUInt16LE(p + 30) + archive.readUInt16LE(p + 32);
    const local = archive.readUInt32LE(p + 42);
    const name = archive.toString('utf8', p + 46, p + 46 + nameLength);
    if (name === wanted) {
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const data = archive.subarray(start, start + size);
      return method === 8 ? inflateRawSync(data) : Buffer.from(data);
    }
    p += 46 + skip;
  }
  throw new Error(`${wanted} not found in the ZIP`);
}

// ---- stage the files ----
step('staging files');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(path.join(STAGE, 'runtime'), { recursive: true });
const nodeDir = `node-v${nodeVersion}-win-x64`;
writeFileSync(path.join(STAGE, 'runtime', 'node.exe'), unzipEntry(zip, `${nodeDir}/node.exe`));
const nodeLicense = unzipEntry(zip, `${nodeDir}/LICENSE`).toString('utf8');

const APP = path.join(STAGE, 'app');
const copy = (from, to = from, options = {}) => cpSync(path.join(ROOT, from), path.join(APP, to), { recursive: true, ...options });
copy('desktop');
for (const file of ['game.js', 'runner.js', 'strategy.js', 'session.js', 'license.js', 'license-format.js', 'public-key.js', 'product.js', 'plan.js', 'compounding.js', 'web']) {
  copy(path.join('src', file));
}
copy('product.config.json');
const typings = path.join(ROOT, 'node_modules', 'playwright-core', 'types'); // TypeScript definitions, not needed at run time
copy(path.join('node_modules', 'playwright-core'), undefined, {
  filter: (src) => src !== typings && !src.startsWith(typings + path.sep),
});
writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify({ name: config.id, version: pkg.version, private: true, type: 'module', main: 'desktop/main.js' }, null, 2) + '\n',
);
cpSync(path.join(ROOT, 'installer', 'icon.ico'), path.join(STAGE, 'icon.ico'));
const playwrightLicense = readFileSync(path.join(ROOT, 'node_modules', 'playwright-core', 'LICENSE'), 'utf8');
const playwrightNotice = existsSync(path.join(ROOT, 'node_modules', 'playwright-core', 'NOTICE'))
  ? readFileSync(path.join(ROOT, 'node_modules', 'playwright-core', 'NOTICE'), 'utf8')
  : '';
writeFileSync(
  path.join(STAGE, 'THIRD-PARTY-NOTICES.txt'),
  `${config.name} includes the following third-party software.\r\n\r\n` +
    `==== Node.js ${nodeVersion} (runtime\\node.exe) ====\r\n${nodeLicense}\r\n\r\n` +
    `==== Playwright (app\\node_modules\\playwright-core) ====\r\n${playwrightNotice}\r\n${playwrightLicense}`.replace(/\r?\n/g, '\r\n'),
);

// ---- build the installer ----
step('building the installer with NSIS');
mkdirSync(OUT, { recursive: true });
const out = path.join(OUT, installerName);
const defines = {
  PRODUCT_NAME: config.name,
  PRODUCT_ID: config.id,
  VERSION: pkg.version,
  PUBLISHER: config.publisher,
  SITE_URL: config.siteUrl,
  STAGE_DIR: STAGE,
  OUT_FILE: out,
};
execFileSync(makensis, ['-V2', ...Object.entries(defines).map(([k, v]) => `-D${k}=${v}`), path.join(ROOT, 'installer', 'chainpilot.nsi')], {
  stdio: 'inherit',
});

const installer = readFileSync(out);
const latest = {
  version: pkg.version,
  file: installerName,
  size: statSync(out).size,
  sha256: sha256(installer),
  date: new Date().toISOString(),
  node: nodeVersion,
};
writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
console.log(`
Built ${path.relative(ROOT, out)} (${(latest.size / 1_048_576).toFixed(1)} MB)
  sha256 ${latest.sha256}
  Node.js ${nodeVersion}, playwright-core ${JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf8')).version}`);
