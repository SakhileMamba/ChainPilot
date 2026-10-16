#!/usr/bin/env node
// Renders desktop/ui/icon.svg into the icon files that need pixels, using Chrome:
//   installer/icon.ico          Windows icon for the installer, shortcuts and Apps list
//   site/favicon.ico            website favicon
//   site/assets/icon-180.png    phone home-screen icon
//   site/assets/og.png          link preview image (WhatsApp, Facebook...)
// Run after changing the icon or product name: npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './lib/sign.js';

const config = JSON.parse(readFileSync(path.join(ROOT, 'product.config.json'), 'utf8'));
const svg = readFileSync(path.join(ROOT, 'desktop', 'ui', 'icon.svg'), 'utf8');
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ channel: 'msedge', headless: true }));
const page = await browser.newPage();

/** RGBA pixels and PNG bytes of the icon at `size` px. */
async function rasterize(size) {
  const { rgba, png } = await page.evaluate(
    async ({ url, size }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      return { rgba: Array.from(ctx.getImageData(0, 0, size, size).data), png: canvas.toDataURL('image/png').split(',')[1] };
    },
    { url: svgUrl, size },
  );
  return { size, rgba: Uint8Array.from(rgba), png: Buffer.from(png, 'base64') };
}

/** An .ico with uncompressed 32-bit entries, which every Windows version and NSIS accept. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  const bodies = images.map(({ size, rgba }, i) => {
    const maskRow = Math.ceil(size / 32) * 4;
    const dib = Buffer.alloc(40 + size * size * 4 + maskRow * size);
    dib.writeUInt32LE(40, 0);
    dib.writeInt32LE(size, 4);
    dib.writeInt32LE(size * 2, 8); // colour rows + mask rows
    dib.writeUInt16LE(1, 12);
    dib.writeUInt16LE(32, 14);
    dib.writeUInt32LE(size * size * 4 + maskRow * size, 20);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const src = (y * size + x) * 4;
        const dst = 40 + ((size - 1 - y) * size + x) * 4; // bottom-up rows, BGRA
        dib[dst] = rgba[src + 2];
        dib[dst + 1] = rgba[src + 1];
        dib[dst + 2] = rgba[src];
        dib[dst + 3] = rgba[src + 3];
      }
    }
    const entry = 6 + 16 * i;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(dib.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += dib.length;
    return dib;
  });
  return Buffer.concat([header, ...bodies]);
}

const sizes = {};
for (const size of [16, 24, 32, 48, 64, 128, 180, 256]) sizes[size] = await rasterize(size);
writeFileSync(path.join(ROOT, 'installer', 'icon.ico'), ico([256, 128, 64, 48, 32, 24, 16].map((s) => sizes[s])));
writeFileSync(path.join(ROOT, 'site', 'favicon.ico'), ico([48, 32, 16].map((s) => sizes[s])));
writeFileSync(path.join(ROOT, 'site', 'assets', 'icon-180.png'), sizes[180].png);

// Link preview card, 1200 x 630.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><html><body style="margin:0">
<div style="width:1200px;height:630px;box-sizing:border-box;padding:80px 90px;display:flex;flex-direction:column;justify-content:center;gap:28px;
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#eef2f8;
  background:radial-gradient(800px 420px at 90% 0%,rgba(245,165,36,.28),transparent 70%),radial-gradient(700px 400px at 0% 100%,rgba(57,135,229,.22),transparent 70%),#0b1020">
  <div style="display:flex;align-items:center;gap:26px">
    <img src="${svgUrl}" width="120" height="120" style="border-radius:28px">
    <div style="font-size:84px;font-weight:800;letter-spacing:-2px">${config.name}</div>
  </div>
  <div style="font-size:46px;font-weight:700;line-height:1.15;max-width:960px">${config.tagline}</div>
  <div style="font-size:30px;color:#b4bfd3">Exact cash-outs · Hard limits · Free simulator · Pay with MTN MoMo</div>
</div></body></html>`);
await page.screenshot({ path: path.join(ROOT, 'site', 'assets', 'og.png') });
await browser.close();
console.log('Wrote installer/icon.ico, site/favicon.ico, site/assets/icon-180.png and site/assets/og.png');
