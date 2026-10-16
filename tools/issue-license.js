#!/usr/bin/env node
// Issue a license key by hand: for a payment received outside the automatic MoMo
// checkout, a replacement, or your own computers.
//
//   npm run license -- --machine 7F3K-9QXA-2M8D-H4PZ --plan month --note "MoMo ref 123456789"
//   npm run license -- --machine 7F3K-9QXA-2M8D-H4PZ --days 10
//   npm run license -- --self --lifetime --install      (this computer, saved into its app data)
//
// Every key issued is also appended to keys/issued.csv.
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { dataDir } from '../desktop/paths.js';
import { LicenseStore, machineId } from '../src/license.js';
import { normalizeMachineId } from '../src/license-format.js';
import { PRODUCT } from '../src/product.js';
import { ROOT, loadPrivateKey, newLicenseId, signLicense } from './lib/sign.js';

const USAGE = `Usage: npm run license -- (--machine <id> | --self) (--plan <${PRODUCT.plans.map((p) => p.id).join('|')}> | --days <n> | --lifetime)
                            [--from <YYYY-MM-DD>] [--note <text>] [--install]`;

const { values } = parseArgs({
  options: {
    machine: { type: 'string' },
    self: { type: 'boolean' },
    plan: { type: 'string' },
    days: { type: 'string' },
    lifetime: { type: 'boolean' },
    from: { type: 'string' },
    note: { type: 'string', default: '' },
    install: { type: 'boolean' },
  },
});
const fail = (message) => {
  console.error(`Error: ${message}\n${USAGE}`);
  process.exit(2);
};

const machine = values.self ? machineId(dataDir()) : normalizeMachineId(values.machine);
if (!machine) fail(values.machine ? `"${values.machine}" is not a machine ID (XXXX-XXXX-XXXX-XXXX)` : 'say which computer: --machine or --self');

let planId = values.plan;
let days = null;
if (values.lifetime) planId ??= 'lifetime';
else if (values.days) {
  days = Number(values.days);
  if (!Number.isInteger(days) || days < 1) fail('--days must be a whole number of at least 1');
  planId ??= `${days}d`;
} else {
  const plan = PRODUCT.plans.find((p) => p.id === planId);
  if (!plan) fail(planId ? `no plan "${planId}" in product.config.json` : 'say how long: --plan, --days or --lifetime');
  days = plan.days;
}

const start = values.from ? Date.parse(`${values.from}T00:00:00Z`) : Date.now();
if (!Number.isFinite(start)) fail('--from must be a date like 2026-11-01');
const iat = Math.floor(Date.now() / 1000);
const exp = days === null ? null : Math.floor(start / 1000) + days * 86_400;
const payload = { v: 1, id: newLicenseId(), m: machine, plan: planId, iat, exp };
const key = signLicense(payload, loadPrivateKey());

const log = path.join(ROOT, 'keys', 'issued.csv');
if (!existsSync(log)) appendFileSync(log, 'issued,license_id,machine,plan,expires,note\n');
const csvField = (s) => `"${String(s).replace(/"/g, '""')}"`;
appendFileSync(
  log,
  [new Date().toISOString(), payload.id, machine, planId, exp ? new Date(exp * 1000).toISOString() : 'never', csvField(values.note)].join(',') + '\n',
);

console.log(`License ${payload.id} for ${machine}, plan ${planId}, ${exp ? `valid until ${new Date(exp * 1000).toUTCString()}` : 'never expires'}:

${key}
`);
if (values.install) {
  if (!values.self) fail('--install only works with --self');
  const result = new LicenseStore(dataDir()).save(key);
  console.log(`Installed on this computer: ${result.message}`);
}
