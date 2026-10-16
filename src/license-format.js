// License keys and signed resources: the text formats only. Shared by the desktop
// app and seller tools (Node) and the license server (Cloudflare Worker), so no
// Node-only APIs here. Signing and verifying happen in the callers.
//
// A license key is   CP1.<payload>.<signature>
//   payload   = base64url of the JSON { v, id, m, plan, iat, exp, ref }
//   signature = Ed25519 over the text "CP1.<payload>", base64url
// Machine IDs are 16 Crockford base32 characters (no I, L, O, U), so they survive
// being read out over the phone: XXXX-XXXX-XXXX-XXXX.

export const LICENSE_PREFIX = 'CP1';
export const RESOURCE_PREFIX = 'CPR1';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MACHINE_ID = /^[0-9A-HJKMNP-TV-Z]{16}$/;

export const utf8 = (text) => new TextEncoder().encode(text);

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** 10 bytes -> XXXX-XXXX-XXXX-XXXX (5 bits per character). */
export function formatMachineId(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes.slice(0, 10)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g).join('-');
}

/** Accepts what people type or paste (spaces, lower case, O for 0, I/L for 1); null if it isn't a machine ID. */
export function normalizeMachineId(text) {
  const raw = String(text ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return MACHINE_ID.test(raw) ? raw.match(/.{4}/g).join('-') : null;
}

/** The text a license signature covers. */
export function licenseSigningInput(payload) {
  return `${LICENSE_PREFIX}.${toBase64Url(utf8(JSON.stringify(payload)))}`;
}

export function assembleKey(signingInput, signature) {
  return `${signingInput}.${toBase64Url(signature)}`;
}

/**
 * Split a pasted key into what was signed, the payload and the signature. Throws
 * an Error with a message fit to show the user. Whitespace anywhere is ignored,
 * because keys sent over WhatsApp or SMS often arrive wrapped across lines.
 */
export function parseKey(key) {
  const parts = String(key ?? '').replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    throw new Error(`That isn't a license key. Keys start with "${LICENSE_PREFIX}." - copy the whole key.`);
  }
  let payload;
  let signature;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
    signature = fromBase64Url(parts[2]);
  } catch {
    throw new Error('The license key is damaged - copy it again, the whole key.');
  }
  const valid =
    payload &&
    payload.v === 1 &&
    typeof payload.id === 'string' &&
    normalizeMachineId(payload.m) === payload.m &&
    typeof payload.plan === 'string' &&
    Number.isInteger(payload.iat) &&
    (payload.exp === null || Number.isInteger(payload.exp));
  if (!valid) throw new Error('The license key is damaged - copy it again, the whole key.');
  return { signingInput: `${parts[0]}.${parts[1]}`, payload, signature };
}

/** JSON with object keys sorted at every level, so a resource's signature doesn't depend on key order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The text a signed resource's signature covers (e.g. selectors.json's payload). */
export function resourceSigningInput(payload) {
  return `${RESOURCE_PREFIX}.${canonicalJson(payload)}`;
}
