// Checkout session store.
//
// Note what a session does NOT contain: no amount, no merchant key, no salt.
// Those live in the payment link, which reaches the payer's browser directly.
// The session holds only what a merchant's server legitimately needs to route a
// customer back and know when to fulfil an order.
//
// That is not a limitation working around Midnight — it is the point. A backend
// that cannot see an amount cannot leak one, cannot be subpoenaed for one, and
// does not have to be trusted with one.

import { randomUUID, createHmac, randomBytes } from 'node:crypto';

export type SessionStatus = 'pending' | 'settled' | 'expired';

export interface CheckoutSession {
  id: string;
  /** Set once the merchant's client has published the commitment on chain. */
  commitment?: string;
  /** The payment link, opaque to us — its fragment never reaches this server. */
  paymentUrl: string;
  status: SessionStatus;
  /** Merchant's own order reference. Their data, echoed back on the webhook. */
  clientReference?: string;
  successUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  createdAt: number;
  expiresAt: number;
  /** Receipt digest observed on chain, once settled. */
  receipt?: string;
}

export interface CreateSessionInput {
  paymentUrl: string;
  commitment?: string;
  clientReference?: string;
  successUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * In-memory by design for this build.
 *
 * Sessions are short-lived routing state, not a ledger — the chain is the
 * ledger. Swapping this for Postgres is a matter of implementing the same four
 * methods; nothing else in the server knows where sessions live.
 */
export class SessionStore {
  #sessions = new Map<string, CheckoutSession>();

  create(input: CreateSessionInput): CheckoutSession {
    const now = Date.now();
    const session: CheckoutSession = {
      id: `cs_${randomUUID().replace(/-/g, '')}`,
      commitment: input.commitment,
      paymentUrl: input.paymentUrl,
      status: 'pending',
      clientReference: input.clientReference,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      webhookUrl: input.webhookUrl,
      createdAt: now,
      expiresAt: now + (input.ttlMs ?? DEFAULT_TTL_MS),
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(id: string): CheckoutSession | undefined {
    const s = this.#sessions.get(id);
    if (!s) return undefined;
    if (s.status === 'pending' && Date.now() > s.expiresAt) {
      s.status = 'expired';
    }
    return s;
  }

  update(id: string, patch: Partial<CheckoutSession>): CheckoutSession | undefined {
    const s = this.#sessions.get(id);
    if (!s) return undefined;
    Object.assign(s, patch);
    return s;
  }

  /** Sessions still waiting on a settlement, for the chain watcher. */
  pending(): CheckoutSession[] {
    const now = Date.now();
    return [...this.#sessions.values()].filter((s) => {
      if (s.status !== 'pending') return false;
      if (now > s.expiresAt) {
        s.status = 'expired';
        return false;
      }
      return Boolean(s.commitment);
    });
  }

  size(): number {
    return this.#sessions.size;
  }

  clear(): void {
    this.#sessions.clear();
  }
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}
