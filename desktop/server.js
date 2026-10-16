// The control panel's local web server: the UI files, a small JSON API and a live
// event stream. It listens on 127.0.0.1 only, every API call must carry the random
// token from the window's address, and the Host header must be this server's own -
// so no other web page (DNS rebinding included) can drive the bot.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');

// Browser modules shared with the website, served under /shared/ with their relative paths intact.
const SHARED = new Set([
  'strategy.js',
  'compounding.js',
  'plan.js',
  'web/format.js',
  'web/charts.js',
  'web/explainer.js',
  'web/theme.css',
  'web/explainer.css',
]);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const ROUTES = {
  'GET /api/ping': () => ({ ok: true }),
  'GET /api/state': (app) => app.state({ logs: true }),
  'POST /api/settings': (app, body) => app.saveSettings(body),
  'POST /api/accept': (app) => app.accept(),
  'POST /api/game/open': (app) => app.openGame(),
  'POST /api/session/start': (app, body) => app.start(body),
  'POST /api/session/stop': (app) => app.stop(),
  'POST /api/session/retry': (app) => app.retry(),
  'POST /api/license/activate': (app, body) => app.activate(body?.key),
  'POST /api/license/restore': (app) => app.restore(),
  'POST /api/license/remove': (app) => app.removeLicense(),
  'POST /api/subscribe': (app, body) => app.subscribe(body),
  'POST /api/subscribe/clear': (app) => app.clearOrder(),
  'POST /api/open': (app, body) => app.open(body?.target),
  'POST /api/refresh': (app) => app.refreshRemote(),
  'POST /api/quit': (app) => app.quit(),
};

/**
 * Start serving `app` (a DesktopApp, or anything with the same methods and
 * 'state'/'log' events). Resolves { port, token, url, clients, close() };
 * `clients` emits 'count' when control panel windows connect or disconnect.
 */
export async function startServer({ app, port = 0, token = randomBytes(24).toString('base64url') }) {
  const expected = Buffer.from(token);
  const clients = new Set();
  const events = new EventEmitter();
  let actualPort;

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  let pending = null;
  const onState = () => {
    // At most ten updates a second, always ending with the latest state.
    pending ??= setTimeout(() => {
      pending = null;
      const state = app.state();
      for (const res of clients) send(res, 'state', state);
    }, 100);
  };
  const onLog = (line) => {
    for (const res of clients) send(res, 'log', line);
  };
  app.on('state', onState);
  app.on('log', onLog);
  const keepAlive = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 20_000);
  keepAlive.unref();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.headers.host !== `127.0.0.1:${actualPort}` && req.headers.host !== `localhost:${actualPort}`) {
        return reply(res, 421, { error: 'Wrong host' });
      }
      if (!url.pathname.startsWith('/api/')) return serveFile(url.pathname, res);

      const given = Buffer.from(String(req.headers['x-token'] ?? url.searchParams.get('token') ?? ''));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return reply(res, 401, { error: 'This window lost its connection. Close it and open the app again.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        clients.add(res);
        events.emit('count', clients.size);
        send(res, 'state', app.state());
        req.on('close', () => {
          clients.delete(res);
          events.emit('count', clients.size);
        });
        return;
      }
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return reply(res, 404, { error: 'Not found' });
      let body;
      if (req.method === 'POST') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return reply(res, 415, { error: 'Send JSON' });
        body = await readJson(req);
      }
      try {
        const result = await route(app, body);
        reply(res, 200, { ok: true, result: result ?? null });
      } catch (err) {
        reply(res, 400, { ok: false, error: err.message, fields: err.fields, needsLicense: err.needsLicense });
      }
    } catch (err) {
      reply(res, 500, { error: err.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  actualPort = server.address().port;

  return {
    port: actualPort,
    token,
    url: `http://127.0.0.1:${actualPort}/#token=${token}`,
    clients: events,
    close: () =>
      new Promise((resolve) => {
        clearInterval(keepAlive);
        app.off('state', onState);
        app.off('log', onLog);
        for (const res of clients) res.end();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON');
  }
}

async function serveFile(pathname, res) {
  let file;
  if (pathname === '/' || pathname === '/index.html') file = path.join(HERE, 'ui', 'index.html');
  else if (pathname.startsWith('/ui/')) {
    file = path.join(HERE, 'ui', path.normalize(pathname.slice(4)));
    if (!file.startsWith(path.join(HERE, 'ui') + path.sep)) file = null;
  } else if (pathname.startsWith('/shared/') && SHARED.has(pathname.slice(8))) {
    file = path.join(SRC, pathname.slice(8));
  }
  const type = file && TYPES[path.extname(file)];
  if (!type) return reply(res, 404, { error: 'Not found' });
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': type, ...SECURITY_HEADERS });
    res.end(content);
  } catch {
    reply(res, 404, { error: 'Not found' });
  }
}
