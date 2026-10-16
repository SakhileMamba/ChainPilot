// An in-memory stand-in for a Cloudflare KV namespace (the parts the license server uses).
export class MemoryKV {
  constructor() {
    this.data = new Map();
  }

  async get(key, type) {
    const entry = this.data.get(key);
    if (!entry || (entry.expires && entry.expires < Date.now())) return null;
    return type === 'json' ? JSON.parse(entry.value) : entry.value;
  }

  async put(key, value, { metadata, expirationTtl } = {}) {
    this.data.set(key, { value, metadata, expires: expirationTtl ? Date.now() + expirationTtl * 1000 : null });
  }

  async delete(key) {
    this.data.delete(key);
  }

  async list({ prefix = '' } = {}) {
    const keys = [...this.data].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata }));
    return { keys, list_complete: true };
  }
}
