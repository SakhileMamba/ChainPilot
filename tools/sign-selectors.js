#!/usr/bin/env node
// Sign site/selectors.json after editing it. Installed apps download that file from
// the website at start-up and, if the signature checks out, use its selectors in
// place of the ones in src/game.js. So when the game's page changes, a fix reaches
// every customer with a website update instead of a new installer.
//
//   1. edit "selectors" in site/selectors.json (only the names in SEL in src/game.js count)
//   2. npm run sign-selectors      (bumps "version" and signs)
//   3. commit and push - the website workflow publishes it
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SEL } from '../src/game.js';
import { ROOT, loadPrivateKey, signResource } from './lib/sign.js';

const file = path.join(ROOT, 'site', 'selectors.json');
const current = JSON.parse(readFileSync(file, 'utf8'));
const payload = current.payload ?? current;

const unknown = Object.keys(payload.selectors ?? {}).filter((name) => !(name in SEL));
if (unknown.length) {
  console.error(`Unknown selector name(s): ${unknown.join(', ')}. Known: ${Object.keys(SEL).join(', ')}`);
  process.exit(1);
}
const next = {
  kind: 'selectors',
  version: (payload.version ?? 0) + 1,
  minAppVersion: payload.minAppVersion ?? '1.0.0',
  selectors: payload.selectors ?? {},
};
writeFileSync(file, JSON.stringify(signResource(next, loadPrivateKey()), null, 2) + '\n');
console.log(`Signed ${path.relative(ROOT, file)} as version ${next.version} (${Object.keys(next.selectors).length} override(s)).`);
