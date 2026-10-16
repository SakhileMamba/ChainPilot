#!/usr/bin/env node
// The license server on this computer with a pretend MoMo, for trying the
// subscription flow without real money:
//
//   npm run dev:api                                      (http://127.0.0.1:8787)
//   CHAINPILOT_API_URL=http://127.0.0.1:8787 npm start   (the app, paying through it)
//
// A payment is approved 8 seconds after it's requested, as if the customer had
// entered their PIN. A phone number ending in 0 declines instead.
import { startDevApi } from './lib/dev-api.js';

const { url } = await startDevApi({ port: Number(process.env.PORT ?? 8787), log: console.log });
console.log(`License server (pretend MoMo) at ${url} - admin token "dev-admin"`);
