import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LicenseStore, checkLicense, machineId } from '../src/license.js';
import { canonicalJson, formatMachineId, normalizeMachineId, parseKey } from '../src/license-format.js';
import { signLicense } from '../tools/lib/sign.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16);
const MACHINE = '7F3K-9QXA-2M8D-H4PZ';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = (extra = {}) =>
  signLicense({ v: 1, id: 'LTEST', m: MACHINE, plan: 'month', iat: NOW / 1000, exp: (NOW + 30 * DAY) / 1000, ...extra }, privateKey);
const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'chainpilot-license-'));

test('machine IDs are 16 unambiguous characters, and typed variants normalize', () => {
  const id = formatMachineId(new Uint8Array(10).fill(255));
  assert.equal(id, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  assert.equal(formatMachineId(new Uint8Array(10)), '0000-0000-0000-0000');
  assert.equal(normalizeMachineId(' 7f3k 9qxa-2m8d h4pz '), MACHINE);
  assert.equal(normalizeMachineId('AOBO-COD0-EOF0-GOHO'), 'A0B0-C0D0-E0F0-G0H0'); // letter O read as zero
  assert.equal(normalizeMachineId('ILOO-0000-0000-0000'), '1100-0000-0000-0000');
  assert.equal(normalizeMachineId('too-short'), null);
  assert.equal(normalizeMachineId('UUUU-0000-0000-0000'), null); // U is not in the alphabet
});

test('the machine ID is stable for an OS ID and falls back to a stored random one', () => {
  const dir = tempDir();
  try {
    assert.equal(machineId(dir, 'ABC'), machineId(dir, 'abc'));
    assert.notEqual(machineId(dir, 'abc'), machineId(dir, 'abd'));
    const fallback = machineId(dir, null);
    assert.equal(normalizeMachineId(fallback), fallback);
    assert.equal(machineId(dir, null), fallback); // kept in the data folder
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a genuine key for this machine is active until it expires', () => {
  const result = checkLicense(key(), { publicKey, machine: MACHINE, now: NOW + DAY });
  assert.equal(result.state, 'active');
  assert.equal(result.daysLeft, 29);
  assert.equal(result.expiresAt, NOW + 30 * DAY);
  assert.equal(checkLicense(key(), { publicKey, machine: MACHINE, now: NOW + 30 * DAY }).state, 'expired');
  assert.equal(checkLicense(key({ exp: null }), { publicKey, machine: MACHINE, now: NOW + 9999 * DAY }).state, 'active');
});

test('keys survive being wrapped across lines, and damaged or forged keys are rejected', () => {
  const k = key();
  const wrapped = k.match(/.{1,40}/g).join('\n  ');
  assert.equal(checkLicense(wrapped, { publicKey, machine: MACHINE, now: NOW }).state, 'active');

  const [prefix, payload, sig] = k.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...parseKey(k).payload, exp: null })).toString('base64url');
  assert.equal(checkLicense(`${prefix}.${forgedPayload}.${sig}`, { publicKey, machine: MACHINE, now: NOW }).state, 'invalid');
  assert.equal(checkLicense(`${prefix}.${payload}.${sig.slice(0, -4)}AAAA`, { publicKey, machine: MACHINE, now: NOW }).state, 'invalid');
  assert.equal(checkLicense('hello', { publicKey, machine: MACHINE, now: NOW }).state, 'invalid');
  const other = generateKeyPairSync('ed25519').privateKey;
  const foreign = signLicense({ v: 1, id: 'X', m: MACHINE, plan: 'month', iat: 1, exp: null }, other);
  assert.equal(checkLicense(foreign, { publicKey, machine: MACHINE, now: NOW }).state, 'invalid');
});

test('keys for another computer, or cancelled ones, are not active', () => {
  assert.equal(checkLicense(key(), { publicKey, machine: 'AAAA-BBBB-CCCC-DDDD', now: NOW }).state, 'other-machine');
  assert.equal(checkLicense(key(), { publicKey, machine: MACHINE, now: NOW, revoked: ['LTEST'] }).state, 'revoked');
});

test('the store keeps usable keys only, and notices a clock turned back', () => {
  const dir = tempDir();
  let now = NOW;
  try {
    const store = new LicenseStore(dir, { publicKey, machine: MACHINE, now: () => now });
    assert.equal(store.status().state, 'none');
    assert.equal(store.save(key({ m: 'AAAA-BBBB-CCCC-DDDD' })).state, 'other-machine');
    assert.equal(store.read(), null);
    assert.equal(store.save(key()).state, 'active');
    assert.equal(new LicenseStore(dir, { publicKey, machine: MACHINE, now: () => now }).status().state, 'active');

    now = NOW + 10 * DAY; // used for a while...
    assert.equal(store.status().state, 'active');
    now = NOW + 20 * DAY;
    assert.equal(store.status().state, 'active');
    now = NOW - 20 * DAY; // ...then the clock goes back
    assert.equal(store.status().state, 'clock');
    store.noteServerTime(NOW + 20 * DAY); // an HTTPS response says what time it really is
    assert.equal(store.status().state, 'active');
    store.noteServerTime(NOW + 40 * DAY);
    assert.equal(store.status().state, 'expired');

    store.setRevoked(['LTEST']);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).revoked, ['LTEST']);
    store.remove();
    assert.equal(store.status().state, 'none');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('canonical JSON ignores key order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'z' } }), '{"a":{"c":"z","d":[1,{"x":1,"y":2}]},"b":1}');
});
