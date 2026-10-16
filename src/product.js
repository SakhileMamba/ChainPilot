// Product settings (product.config.json) and the app version (package.json).
import { readFileSync } from 'node:fs';

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

export const PRODUCT = readJson('product.config.json');
export const VERSION = readJson('package.json').version;

/** True while a URL in the config still holds its template value. */
export const isPlaceholder = (url) => !url || /YOUR-|example\.com/i.test(url);

/** An absolute URL on the product website, or null if the site address isn't set yet. */
export function siteLink(page = '') {
  return isPlaceholder(PRODUCT.siteUrl) ? null : new URL(page, PRODUCT.siteUrl).href;
}
