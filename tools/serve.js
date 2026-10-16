#!/usr/bin/env node
// Preview the built website: node tools/serve.js [dir=dist/site] [port=8080]
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve `dir` on 127.0.0.1. Resolves { url, close() }. */
export function serve(dir, port = 0) {
  const root = path.resolve(dir);
  const server = createServer(async (req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) file = root;
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
      // Byte ranges, like GitHub Pages: browsers need them to seek in the video.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start > end || start >= body.length) {
          res.writeHead(416, { 'content-range': `bytes */${body.length}` });
          return res.end();
        }
        res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
        return res.end(body.subarray(start, end + 1));
      }
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(path.join(root, '404.html')).catch(() => 'Not found'));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) }),
    );
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve(process.argv[2] ?? 'dist/site', Number(process.argv[3] ?? 8080));
  console.log(`Serving at ${url}`);
}
