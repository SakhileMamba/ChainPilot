// Minimal MTN MoMo Collections client: "Request to Pay" and its status.
// Works against the sandbox (https://sandbox.momodeveloper.mtn.com, currency EUR)
// and production (https://proxy.momoapi.mtn.com, or https://momoapi.momo.africa after
// MTN's platform migration). X-Target-Environment is sent on every call, including
// the token call, which the new platform requires.

export class MoMoError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status; // HTTP status from MoMo, if any
    this.code = code; // MoMo's error code, e.g. PAYER_NOT_FOUND
  }
}

export class MoMo {
  constructor({ baseUrl, subscriptionKey, apiUser, apiKey, targetEnvironment, fetch = globalThis.fetch }) {
    if (!baseUrl || !subscriptionKey || !apiUser || !apiKey || !targetEnvironment) {
      throw new MoMoError('MoMo is not configured (base URL, subscription key, API user, API key, target environment)');
    }
    Object.assign(this, { baseUrl: baseUrl.replace(/\/+$/, ''), subscriptionKey, apiUser, apiKey, targetEnvironment });
    // Called through a closure: Workers reject fetch() invoked as a method of another object.
    this.send = (url, init) => fetch(url, init);
    this.token = null; // { value, expires }
  }

  headers(extra = {}) {
    return {
      'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      'X-Target-Environment': this.targetEnvironment,
      'User-Agent': 'ChainPilot-License/1.0',
      ...extra,
    };
  }

  async call(path, init) {
    let res;
    try {
      res = await this.send(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new MoMoError(`MoMo did not answer (${err.message})`);
    }
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const code = body?.code ?? body?.error ?? null;
      throw new MoMoError(`MoMo ${res.status}: ${body?.message || text.slice(0, 200) || res.statusText}`, { status: res.status, code });
    }
    return { status: res.status, body };
  }

  async accessToken() {
    if (this.token && Date.now() < this.token.expires) return this.token.value;
    const basic = btoa(`${this.apiUser}:${this.apiKey}`); // plain, not URL-encoded: the new gateway rejects that
    const { body } = await this.call('/collection/token/', {
      method: 'POST',
      headers: this.headers({ Authorization: `Basic ${basic}` }),
    });
    if (!body?.access_token) throw new MoMoError('MoMo returned no access token');
    this.token = { value: body.access_token, expires: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000 };
    return this.token.value;
  }

  /** Ask `msisdn` to approve a payment on their phone. `referenceId` (a UUID v4) identifies it from now on. */
  async requestToPay({ referenceId, amount, currency, externalId, msisdn, payerMessage, payeeNote }) {
    const token = await this.accessToken();
    await this.call('/collection/v1_0/requesttopay', {
      method: 'POST',
      headers: this.headers({
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        amount: String(amount),
        currency,
        externalId,
        payer: { partyIdType: 'MSISDN', partyId: msisdn },
        payerMessage,
        payeeNote,
      }),
    });
  }

  /** { status: 'PENDING' | 'SUCCESSFUL' | 'FAILED', reason, amount, currency, financialTransactionId, ... } */
  async requestToPayStatus(referenceId) {
    const token = await this.accessToken();
    const { body } = await this.call(`/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`, {
      method: 'GET',
      headers: this.headers({ Authorization: `Bearer ${token}` }),
    });
    return body ?? {};
  }
}

/** A message for the payer, from MoMo's failure reason (a code string or { code, message }). */
export function describeFailure(reason) {
  const code = String(reason?.code ?? reason ?? '').toUpperCase();
  const messages = {
    APPROVAL_REJECTED: 'The payment was declined on the phone.',
    EXPIRED: 'The payment request expired before it was approved. Try again and approve it within a few minutes.',
    NOT_ENOUGH_FUNDS: "There wasn't enough money in the MoMo wallet.",
    PAYER_LIMIT_REACHED: "The MoMo wallet's limit was reached.",
    PAYER_NOT_FOUND: "That number isn't registered for MoMo.",
    PAYEE_NOT_ALLOWED_TO_RECEIVE: "The merchant account can't receive payments right now. Please contact support.",
    INTERNAL_PROCESSING_ERROR: 'MoMo had a problem processing the payment. Please try again.',
    SERVICE_UNAVAILABLE: 'MoMo is unavailable right now. Please try again later.',
    COULD_NOT_PERFORM_TRANSACTION: 'MoMo could not complete the payment. Please try again.',
  };
  return messages[code] ?? `The payment did not go through${code ? ` (${code})` : ''}.`;
}
