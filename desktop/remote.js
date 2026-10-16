// Files the app downloads from the product website (GitHub Pages):
//   downloads/latest.json   the newest version, for "update available"
//   revoked.json            cancelled license IDs
//   selectors.json          signed fixes for when the game's page changes (see tools/sign-selectors.js)
// The Date header of these HTTPS responses also gives the licence check a trustworthy clock.
import { verify } from 'node:crypto';
import { fromBase64Url, resourceSigningInput } from '../src/license-format.js';
import { SEL } from '../src/game.js';

/** GET a JSON file. Resolves { body, serverTime } (serverTime in ms, or null); throws on failure. */
export async function fetchJson(url, { timeoutMs = 10_000, fetch = globalThis.fetch } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const date = Date.parse(res.headers.get('date') ?? '');
  return { body: await res.json(), serverTime: Number.isFinite(date) ? date : null };
}

/** True if version a (x.y.z) is newer than b. */
export function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/**
 * Check a downloaded selectors.json ({ payload, sig }) and, if it is genuine and meant
 * for this version, apply its overrides to SEL. Returns a short description of what happened.
 */
export function applySelectors(doc, { publicKey, appVersion, target = SEL }) {
  const { payload, sig } = doc ?? {};
  if (!payload || typeof sig !== 'string') return 'selectors.json has no signature - ignored';
  let genuine = false;
  try {
    genuine = Boolean(publicKey) && verify(null, Buffer.from(resourceSigningInput(payload)), publicKey, Buffer.from(fromBase64Url(sig)));
  } catch {}
  if (!genuine || payload.kind !== 'selectors') return 'selectors.json signature is not valid - ignored';
  if (payload.minAppVersion && isNewer(payload.minAppVersion, appVersion)) return `selectors.json needs version ${payload.minAppVersion} - ignored`;
  const overrides = Object.entries(payload.selectors ?? {}).filter(
    ([name, value]) => name in target && typeof value === 'string' && value.length > 0 && value.length < 300,
  );
  for (const [name, value] of overrides) target[name] = value;
  return overrides.length ? `using ${overrides.length} updated game selector(s) (version ${payload.version})` : null;
}
