// The license server (server/worker.js) running locally with in-memory storage and a
// pretend MoMo: payments are approved `approveAfterMs` after they're requested, as if
// the customer had entered their PIN; a phone number ending in 0 declines instead.
// Licenses are signed with keys/license-private.pem, so the app accepts them.
import { createServer } from 'node:http';
import worker from '../../server/worker.js';
import { MemoryKV } from './memory-kv.js';
import { loadPrivateKey } from './sign.js';

/** Resolves { url, close() } once listening. */
export function startDevApi({ port = 0, approveAfterMs = 8000, log = () => {} } = {}) {
  const payments = new Map();
  const fakeMoMo = async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/collection/token/') return Response.json({ access_token: 'dev-token', expires_in: 3600 });
    if (pathname === '/collection/v1_0/requesttopay') {
      const body = JSON.parse(init.body);
      payments.set(init.headers['X-Reference-Id'], { body, at: Date.now() });
      log(`MoMo: asked ${body.payer.partyId} to approve ${body.amount} ${body.currency} (${body.payerMessage})`);
      return new Response(null, { status: 202 });
    }
    const payment = payments.get(/requesttopay\/(.+)$/.exec(pathname)?.[1]);
    if (!payment) return Response.json({ code: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    const decided = Date.now() - payment.at > approveAfterMs;
    const status = !decided ? 'PENDING' : payment.body.payer.partyId.endsWith('0') ? 'FAILED' : 'SUCCESSFUL';
    return Response.json({ ...payment.body, status, ...(status === 'FAILED' && { reason: 'APPROVAL_REJECTED' }), financialTransactionId: '000000001' });
  };
  const env = {
    DB: new MemoryKV(),
    MOMO_BASE_URL: 'https://momo.invalid',
    MOMO_SUBSCRIPTION_KEY: 'dev',
    MOMO_API_USER: 'dev',
    MOMO_API_KEY: 'dev',
    MOMO_TARGET_ENV: 'mtnswaziland',
    MOMO_CURRENCY: 'SZL',
    LICENSE_PRIVATE_KEY: loadPrivateKey().export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    ADMIN_TOKEN: 'dev-admin',
    MOMO_FETCH: fakeMoMo,
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }),
    );
  });
}
