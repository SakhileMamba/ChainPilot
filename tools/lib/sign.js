// Signing with the seller's private key (Node). The license server does the same
// with Web Crypto; both produce keys that src/license.js accepts.
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleKey, licenseSigningInput, resourceSigningInput, toBase64Url } from '../../src/license-format.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PRIVATE_KEY_FILE = path.join(ROOT, 'keys', 'license-private.pem');

export function loadPrivateKey(file = PRIVATE_KEY_FILE) {
  let pem;
  try {
    pem = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`No private key at ${path.relative(process.cwd(), file)}. Run "npm run keys" first.`);
  }
  return createPrivateKey(pem);
}

export const newLicenseId = () => `L${randomBytes(6).toString('hex').toUpperCase()}`;

/** A license key for `payload` ({ v, id, m, plan, iat, exp, ref? }). */
export function signLicense(payload, privateKey) {
  const input = licenseSigningInput(payload);
  return assembleKey(input, sign(null, Buffer.from(input), privateKey));
}

/** { payload, sig } for a resource the app downloads, such as selectors.json. */
export function signResource(payload, privateKey) {
  return { payload, sig: toBase64Url(sign(null, Buffer.from(resourceSigningInput(payload)), privateKey)) };
}
