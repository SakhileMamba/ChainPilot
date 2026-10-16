// Licensing on the customer's computer: this PC's machine ID, checking a license
// key offline against the public key shipped in the app, and keeping the key.
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatMachineId, parseKey } from './license-format.js';
import { PUBLIC_KEY } from './public-key.js';

const DAY_MS = 86_400_000;
const CLOCK_SLACK_MS = 2 * DAY_MS; // how far the clock may go back before it looks tampered with

/** The public key that license signatures are checked against, or null if `npm run keys` was never run. */
export function loadPublicKey(spkiBase64 = PUBLIC_KEY) {
  if (!spkiBase64) return null;
  return createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
}

/** The operating system's own ID for this computer, or null if it can't be read. */
export function osMachineId({ platform = process.platform, exec = execFileSync, readFile = readFileSync } = {}) {
  const run = (cmd, args) => exec(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  try {
    if (platform === 'win32') {
      // Set when Windows is installed; the same for every user of the PC. /reg:64 reads
      // the 64-bit registry view, which is where it lives.
      const out = run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
      return /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? null;
    }
    if (platform === 'darwin') {
      return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))?.[1] ?? null;
    }
    for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const id = readFile(file, 'utf8').trim();
        if (id) return id;
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * This computer's machine ID as shown to customers (XXXX-XXXX-XXXX-XXXX). It is a
 * hash, so it reveals nothing about the PC. If the OS ID can't be read, a random
 * one is kept in the data folder instead.
 */
export function machineId(dataDir, osId = osMachineId()) {
  let source = osId;
  if (!source) {
    const file = path.join(dataDir, 'machine-fallback.txt');
    try {
      source = readFileSync(file, 'utf8').trim();
    } catch {}
    if (!source) {
      source = randomBytes(16).toString('hex');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(file, source);
    }
  }
  const digest = createHash('sha256').update(`chainpilot-machine-v1:${source.trim().toLowerCase()}`).digest();
  return formatMachineId(digest.subarray(0, 10));
}

/**
 * Check a license key. Never throws; returns
 *   { state: 'active' | 'expired' | 'other-machine' | 'revoked' | 'invalid', message, ... }
 * with the license's id, plan, issuedAt, expiresAt (ms, null = never) and daysLeft when it could be read.
 */
export function checkLicense(key, { publicKey, machine, now = Date.now(), revoked = [] }) {
  let parsed;
  try {
    parsed = parseKey(key);
  } catch (err) {
    return { state: 'invalid', message: err.message };
  }
  const { signingInput, payload, signature } = parsed;
  if (!publicKey || !verify(null, Buffer.from(signingInput), publicKey, Buffer.from(signature))) {
    return { state: 'invalid', message: "This license key wasn't issued by us, or it was changed." };
  }
  const info = {
    id: payload.id,
    plan: payload.plan,
    machine: payload.m,
    issuedAt: payload.iat * 1000,
    expiresAt: payload.exp === null ? null : payload.exp * 1000,
  };
  info.daysLeft = info.expiresAt === null ? null : Math.max(0, Math.ceil((info.expiresAt - now) / DAY_MS));
  if (payload.m !== machine) {
    return {
      ...info,
      state: 'other-machine',
      message: `This key is for another computer (${payload.m}). This one is ${machine}.`,
    };
  }
  if (revoked.includes(payload.id)) return { ...info, state: 'revoked', message: 'This license has been cancelled.' };
  if (info.expiresAt !== null && now >= info.expiresAt) {
    return { ...info, state: 'expired', message: 'Your subscription has ended. Renew to keep betting live.' };
  }
  return { ...info, state: 'active', message: 'Subscription active.' };
}

/**
 * The license kept on this computer (license.key in the data folder), plus a little
 * state (state.json) for noticing a clock that was turned back to stretch a
 * subscription. When the app has fetched anything over HTTPS, the server's time is
 * used instead of the PC's clock.
 */
export class LicenseStore {
  constructor(dataDir, { publicKey = loadPublicKey(), machine = machineId(dataDir), now = Date.now } = {}) {
    Object.assign(this, { dataDir, publicKey, machine, now });
    this.keyFile = path.join(dataDir, 'license.key');
    this.stateFile = path.join(dataDir, 'state.json');
    this.trusted = null; // { serverMs, localMs } from an HTTPS response's Date header
    this.state = { lastSeen: 0, revoked: [] };
    try {
      Object.assign(this.state, JSON.parse(readFileSync(this.stateFile, 'utf8')));
    } catch {}
  }

  read() {
    try {
      return readFileSync(this.keyFile, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  /** Check `key` against this computer and keep it if it's usable. Returns the check result. */
  save(key) {
    const result = this.check(String(key).replace(/\s+/g, ''));
    if (['active', 'expired', 'clock'].includes(result.state)) {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(this.keyFile, String(key).replace(/\s+/g, '') + '\n');
    }
    return result;
  }

  remove() {
    rmSync(this.keyFile, { force: true });
  }

  /** Server time seen on an HTTPS response (ms since 1970). */
  noteServerTime(serverMs) {
    if (Number.isFinite(serverMs)) this.trusted = { serverMs, localMs: this.now() };
  }

  setRevoked(ids) {
    this.state.revoked = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    this.writeState();
  }

  /** The best estimate of the real time, and whether the PC's clock looks turned back. */
  clock() {
    const local = this.now();
    if (this.trusted) {
      const real = this.trusted.serverMs + (local - this.trusted.localMs);
      if (Math.abs(real - this.state.lastSeen) > 60_000) {
        this.state.lastSeen = real; // the server is right even if lastSeen came from a clock set in the future
        this.writeState();
      }
      return { now: real, turnedBack: false };
    }
    if (local < this.state.lastSeen - CLOCK_SLACK_MS) return { now: local, turnedBack: true };
    if (local > this.state.lastSeen + 3_600_000) {
      this.state.lastSeen = local;
      this.writeState();
    }
    return { now: local, turnedBack: false };
  }

  check(key) {
    const { now, turnedBack } = this.clock();
    const result = checkLicense(key, { publicKey: this.publicKey, machine: this.machine, now, revoked: this.state.revoked });
    if (turnedBack && result.state === 'active') {
      return {
        ...result,
        state: 'clock',
        message: "Your computer's date looks wrong. Set the correct date, or connect to the internet, and try again.",
      };
    }
    return result;
  }

  /** The state of this computer's license: as check(), or { state: 'none' } when there's no key. */
  status() {
    const key = this.read();
    if (!key) return { state: 'none', message: 'No subscription yet. The simulator, dry run and practice mode are free.' };
    return this.check(key);
  }

  writeState() {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(this.stateFile, JSON.stringify(this.state));
    } catch {}
  }
}
