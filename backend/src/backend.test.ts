// Backend tests.
//
// The privacy assertions are the important ones: a session must never be able
// to carry an amount, because the point of this server is that it cannot leak
// what it does not hold.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore, signPayload, generateWebhookSecret } from './store.ts';
import { ChainWatcher } from './watcher.ts';

const PAYMENT_URL = 'https://pay.example.com/pay#eyJhbW91bnQiOiI0MjUwMCJ9';
const COMMITMENT = 'd20633e88c1a940f24ab010ad14867f336a0252b50bac92883098733407e90c0';

describe('session store', () => {
  let store: SessionStore;
  beforeEach(() => {
    store = new SessionStore();
  });

  it('creates a pending session with an id', () => {
    const s = store.create({ paymentUrl: PAYMENT_URL });
    expect(s.id).toMatch(/^cs_[0-9a-f]{32}$/);
    expect(s.status).toBe('pending');
  });

  it('never stores an amount, merchant key or salt', () => {
    const s = store.create({
      paymentUrl: PAYMENT_URL,
      commitment: COMMITMENT,
      clientReference: 'order-1234',
    });
    // An exact key list rather than a loose check: this fails the moment
    // anyone adds an `amount` field, which is the regression worth catching.
    expect(Object.keys(s).sort()).toEqual(
      [
        'cancelUrl',
        'clientReference',
        'commitment',
        'createdAt',
        'expiresAt',
        'id',
        'paymentUrl',
        'status',
        'successUrl',
        'webhookUrl',
      ].sort(),
    );
    expect(JSON.stringify(s)).not.toContain('42500');
  });

  it('returns undefined for an unknown id', () => {
    expect(store.get('cs_nope')).toBeUndefined();
  });

  it('expires a session past its ttl', () => {
    const s = store.create({ paymentUrl: PAYMENT_URL, ttlMs: -1 });
    expect(store.get(s.id)?.status).toBe('expired');
  });

  it('lists only pending sessions that have a commitment', () => {
    store.create({ paymentUrl: PAYMENT_URL }); // no commitment yet
    const withCommitment = store.create({ paymentUrl: PAYMENT_URL, commitment: COMMITMENT });
    store.create({ paymentUrl: PAYMENT_URL, commitment: COMMITMENT, ttlMs: -1 }); // expired

    const pending = store.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(withCommitment.id);
  });

  it('attaches a commitment after creation', () => {
    const s = store.create({ paymentUrl: PAYMENT_URL });
    expect(store.pending()).toHaveLength(0);
    store.update(s.id, { commitment: COMMITMENT });
    expect(store.pending()).toHaveLength(1);
  });
});

describe('webhook signing', () => {
  it('produces a stable sha256 signature', () => {
    const sig = signPayload('secret', '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signPayload('secret', '{"a":1}')).toBe(sig);
  });

  it('changes with the body', () => {
    expect(signPayload('s', '{"a":1}')).not.toBe(signPayload('s', '{"a":2}'));
  });

  it('changes with the secret', () => {
    expect(signPayload('s1', '{}')).not.toBe(signPayload('s2', '{}'));
  });

  it('generates distinct secrets', () => {
    expect(new Set(Array.from({ length: 20 }, generateWebhookSecret)).size).toBe(20);
  });
});

describe('chain watcher', () => {
  let store: SessionStore;
  beforeEach(() => {
    store = new SessionStore();
  });

  const makeWatcher = (
    status: string,
    deliver = vi.fn(async () => {}),
  ): { watcher: ChainWatcher; deliver: typeof deliver } => {
    const watcher = new ChainWatcher(store, {
      contractAddress: 'a'.repeat(64),
      indexerUri: 'http://localhost:8088/api/v4/graphql',
      indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
      webhookSecret: 'test-secret',
      readInvoiceStatus: async () => status,
      deliver,
    });
    return { watcher, deliver };
  };

  it('settles a session when the chain says settled', async () => {
    const s = store.create({ paymentUrl: PAYMENT_URL, commitment: COMMITMENT });
    const { watcher } = makeWatcher('settled');
    await watcher.tick();
    expect(store.get(s.id)?.status).toBe('settled');
    expect(watcher.stats.settled).toBe(1);
  });

  it('leaves a session pending while the chain says open', async () => {
    const s = store.create({ paymentUrl: PAYMENT_URL, commitment: COMMITMENT });
    const { watcher } = makeWatcher('open');
    await watcher.tick();
    expect(store.get(s.id)?.status).toBe('pending');
  });

  it('fires a webhook on settlement, signed', async () => {
    store.create({
      paymentUrl: PAYMENT_URL,
      commitment: COMMITMENT,
      webhookUrl: 'https://merchant.example.com/hook',
      clientReference: 'order-1234',
    });
    const { watcher, deliver } = makeWatcher('settled');
    await watcher.tick();

    expect(deliver).toHaveBeenCalledOnce();
    const [url, body, signature] = deliver.mock.calls[0]!;
    expect(url).toBe('https://merchant.example.com/hook');
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);

    const event = JSON.parse(body as string);
    expect(event.type).toBe('checkout.settled');
    expect(event.clientReference).toBe('order-1234');
  });

  it('the webhook payload carries NO amount', async () => {
    store.create({
      paymentUrl: PAYMENT_URL,
      commitment: COMMITMENT,
      webhookUrl: 'https://merchant.example.com/hook',
    });
    const { watcher, deliver } = makeWatcher('settled');
    await watcher.tick();

    const body = deliver.mock.calls[0]![1] as string;
    expect(body).not.toContain('42500');
    expect(JSON.parse(body)).not.toHaveProperty('amount');
  });

  it('settles only once, so a merchant is not double-notified', async () => {
    store.create({
      paymentUrl: PAYMENT_URL,
      commitment: COMMITMENT,
      webhookUrl: 'https://merchant.example.com/hook',
    });
    const { watcher, deliver } = makeWatcher('settled');
    await watcher.tick();
    await watcher.tick();
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('survives an indexer failure and retries next pass', async () => {
    const s = store.create({ paymentUrl: PAYMENT_URL, commitment: COMMITMENT });
    let calls = 0;
    const watcher = new ChainWatcher(store, {
      contractAddress: 'a'.repeat(64),
      indexerUri: 'x',
      indexerWsUri: 'x',
      webhookSecret: 's',
      readInvoiceStatus: async () => {
        calls++;
        if (calls === 1) throw new Error('indexer down');
        return 'settled';
      },
    });

    await expect(watcher.tick()).resolves.toBeUndefined();
    expect(store.get(s.id)?.status).toBe('pending');

    await watcher.tick();
    expect(store.get(s.id)?.status).toBe('settled');
  });

  it('survives a webhook delivery failure', async () => {
    store.create({
      paymentUrl: PAYMENT_URL,
      commitment: COMMITMENT,
      webhookUrl: 'https://merchant.example.com/hook',
    });
    const failing = vi.fn(async () => {
      throw new Error('merchant returned 500');
    });
    const { watcher } = makeWatcher('settled', failing);

    await expect(watcher.tick()).resolves.toBeUndefined();
    // The settlement is real regardless of whether the merchant's endpoint was
    // reachable — the chain is the source of truth, not the webhook.
    expect(watcher.stats.settled).toBe(1);
    expect(watcher.stats.webhookFailures).toBe(1);
  });

  it('does not poll sessions without a commitment', async () => {
    store.create({ paymentUrl: PAYMENT_URL });
    const read = vi.fn(async () => 'settled');
    const watcher = new ChainWatcher(store, {
      contractAddress: 'a'.repeat(64),
      indexerUri: 'x',
      indexerWsUri: 'x',
      webhookSecret: 's',
      readInvoiceStatus: read,
    });
    await watcher.tick();
    expect(read).not.toHaveBeenCalled();
  });
});
