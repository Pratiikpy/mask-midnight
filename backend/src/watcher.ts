// Watches the chain and settles sessions.
//
// The backend learns that a payment happened the same way anyone else does — by
// reading public contract state. It is not told by the payer, and it does not
// take the merchant's word for it, because neither is trustworthy: a payer
// claiming success and a merchant claiming failure are exactly the dispute this
// is meant to remove.

import type { SessionStore, CheckoutSession } from './store.ts';
import { signPayload } from './store.ts';

export interface WatcherOptions {
  contractAddress: string;
  indexerUri: string;
  indexerWsUri: string;
  webhookSecret: string;
  /** How often to poll. Settlement takes ~30 s, so sub-second polling is waste. */
  intervalMs?: number;
  /** Injectable so tests do not need a chain. */
  readInvoiceStatus?: (commitment: string) => Promise<string>;
  /** Injectable so tests do not need an HTTP server. */
  deliver?: (url: string, body: string, signature: string) => Promise<void>;
}

export interface WebhookEvent {
  type: 'checkout.settled' | 'checkout.expired';
  sessionId: string;
  commitment?: string;
  clientReference?: string;
  /** Deliberately absent: any amount. The chain does not hold one. */
  occurredAt: string;
}

async function defaultDeliver(url: string, body: string, signature: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mask-Signature': signature },
    body,
  });
  if (!res.ok) throw new Error(`webhook ${url} returned ${res.status}`);
}

export class ChainWatcher {
  #store: SessionStore;
  #opts: Required<Pick<WatcherOptions, 'intervalMs'>> & WatcherOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #readStatus: (commitment: string) => Promise<string>;
  #deliver: (url: string, body: string, signature: string) => Promise<void>;

  /** Counters, so an operator can tell a quiet watcher from a broken one. */
  readonly stats = { polls: 0, settled: 0, expired: 0, webhookFailures: 0 };

  constructor(store: SessionStore, opts: WatcherOptions) {
    this.#store = store;
    this.#opts = { intervalMs: 5_000, ...opts };
    this.#deliver = opts.deliver ?? defaultDeliver;
    this.#readStatus =
      opts.readInvoiceStatus ??
      (async (commitment: string) => {
        const { Mask } = (await import('@mask/node')) as typeof import('@mask/node');
        const mask = new Mask({
          contractAddress: opts.contractAddress,
          indexerUri: opts.indexerUri,
          indexerWsUri: opts.indexerWsUri,
          merchantKey: '0'.repeat(64),
        });
        return (await mask.getInvoice(commitment)).status;
      });
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.#opts.intervalMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One pass. Exposed so tests can drive it deterministically. */
  async tick(): Promise<void> {
    this.stats.polls++;
    for (const session of this.#store.pending()) {
      try {
        const status = await this.#readStatus(session.commitment!);
        if (status === 'settled') {
          this.#store.update(session.id, { status: 'settled' });
          this.stats.settled++;
          await this.#fire(session, 'checkout.settled');
        }
      } catch {
        // A transient indexer failure must not kill the loop; the next pass
        // retries. Sessions expire on their own, so nothing hangs forever.
      }
    }
  }

  async #fire(session: CheckoutSession, type: WebhookEvent['type']): Promise<void> {
    if (!session.webhookUrl) return;

    const event: WebhookEvent = {
      type,
      sessionId: session.id,
      commitment: session.commitment,
      clientReference: session.clientReference,
      occurredAt: new Date().toISOString(),
    };
    const body = JSON.stringify(event);

    try {
      await this.#deliver(session.webhookUrl, body, signPayload(this.#opts.webhookSecret, body));
    } catch {
      this.stats.webhookFailures++;
    }
  }
}
