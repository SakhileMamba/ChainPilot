// Client for the license server (server/worker.js).
export class SubscriptionApi {
  constructor(apiUrl, { fetch = globalThis.fetch } = {}) {
    this.base = apiUrl ? apiUrl.replace(/\/+$/, '') : null;
    this.send = (url, init) => fetch(url, init);
  }

  get configured() {
    return Boolean(this.base);
  }

  async request(path, { method = 'GET', body } = {}) {
    if (!this.base) throw new Error('Online payments are not set up yet. Use the manual payment option.');
    let res;
    try {
      res = await this.send(`${this.base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new Error("Couldn't reach the subscription service. Check your internet connection and try again.");
    }
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) throw Object.assign(new Error(data?.error ?? `The subscription service answered ${res.status}.`), { status: res.status });
    return data;
  }

  plans() {
    return this.request('/v1/plans');
  }

  createOrder({ plan, phone, machineId }) {
    return this.request('/v1/orders', { method: 'POST', body: { plan, phone, machineId } });
  }

  order(id) {
    return this.request(`/v1/orders/${encodeURIComponent(id)}`);
  }

  licenses(machineId) {
    return this.request(`/v1/licenses/${encodeURIComponent(machineId)}`);
  }
}
