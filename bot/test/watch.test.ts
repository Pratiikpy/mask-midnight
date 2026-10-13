// The notifier: does it fire once, at the right time, and say nothing extra?

import { describe, it, expect } from 'vitest';
import { MemoryWatchStore, SettlementNotifier } from '../src/watch.ts';
import type { ChainReader, InvoiceView } from '../src/commands.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const view = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  status: 'open',
  kind: 'standard',
  token: 'tNIGHT',
  contributions: 0,
  expiresAt: 0n,
  ...over,
});

function chainWith(map: Record<string, InvoiceView>): ChainReader {
  return {
    getInvoice: async (c) => map[c] ?? view({ status: 'unknown' }),
    receiptExists: async () => false,
    attestationExists: async () => false,
    totalCreated: async () => 0n,
  };
}

function collector() {
  const sent: { chatId: number; text: string }[] = [];
  return { sent, send: async (chatId: number, text: string) => void sent.push({ chatId, text }) };
}

describe('the watch store', () => {
  it('keeps chats apart', async () => {
    const s = new MemoryWatchStore();
    await s.add(1, A);
    await s.add(2, B);
    expect(await s.list(1)).toEqual([A]);
    expect(await s.list(2)).toEqual([B]);
  });

  it('treats a repeated watch as one', async () => {
    const s = new MemoryWatchStore();
    await s.add(1, A);
    await s.add(1, A);
    expect(await s.list(1)).toHaveLength(1);
  });

  it('caps how many one chat can watch', async () => {
    // Otherwise a single chat sets the poller's workload.
    const s = new MemoryWatchStore(2);
    await s.add(1, A);
    await s.add(1, B);
    await expect(s.add(1, 'c'.repeat(64))).rejects.toThrow(/already watching 2/i);
  });

  it('still accepts a duplicate at the cap', async () => {
    const s = new MemoryWatchStore(1);
    await s.add(1, A);
    await expect(s.add(1, A)).resolves.toBeUndefined();
  });

  it('reports whether a removal did anything', async () => {
    const s = new MemoryWatchStore();
    await s.add(1, A);
    expect(await s.remove(1, A)).toBe(true);
    expect(await s.remove(1, A)).toBe(false);
  });
});

describe('the notifier', () => {
  it('says nothing while an invoice is open', async () => {
    const store = new MemoryWatchStore();
    await store.add(1, A);
    const { sent, send } = collector();
    await new SettlementNotifier(store, chainWith({ [A]: view() }), { send }).tick();
    expect(sent).toHaveLength(0);
    expect(await store.list(1)).toEqual([A]);
  });

  it('fires once when it settles, then forgets it', async () => {
    const store = new MemoryWatchStore();
    await store.add(1, A);
    const { sent, send } = collector();
    const n = new SettlementNotifier(store, chainWith({ [A]: view({ status: 'settled', contributions: 1 }) }), { send });

    await n.tick();
    await n.tick();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/Settled/);
    expect(await store.list(1)).toEqual([]);
  });

  it('does not put an amount in the message', async () => {
    const store = new MemoryWatchStore();
    await store.add(1, A);
    const { sent, send } = collector();
    await new SettlementNotifier(
      store,
      chainWith({ [A]: { ...view({ status: 'settled' }), amount: 91_300n } as unknown as InvoiceView }),
      { send },
    ).tick();
    expect(sent[0]!.text).not.toMatch(/91300|91,300/);
    expect(sent[0]!.text).toMatch(/not on the chain/);
  });

  it('reports a cancellation differently from a settlement', async () => {
    const store = new MemoryWatchStore();
    await store.add(1, A);
    const { sent, send } = collector();
    await new SettlementNotifier(store, chainWith({ [A]: view({ status: 'cancelled' }) }), { send }).tick();
    expect(sent[0]!.text).toMatch(/Cancelled/);
    expect(sent[0]!.text).toMatch(/No payment was taken/);
  });

  it('gets the plural right', async () => {
    const store = new MemoryWatchStore();
    await store.add(1, A);
    const { sent, send } = collector();
    await new SettlementNotifier(store, chainWith({ [A]: view({ status: 'settled', contributions: 3 }) }), { send }).tick();
    expect(sent[0]!.text).toMatch(/3 contributions/);
  });

  it('keeps going when one send fails', async () => {
    // A user who blocked the bot must not stop everyone else's notifications.
    const store = new MemoryWatchStore();
    await store.add(1, A);
    await store.add(2, B);

    const good: number[] = [];
    const n = new SettlementNotifier(
      store,
      chainWith({ [A]: view({ status: 'settled' }), [B]: view({ status: 'settled' }) }),
      {
        send: async (chatId) => {
          if (chatId === 1) throw new Error('bot was blocked by the user');
          good.push(chatId);
        },
      },
    );

    await n.tick();
    expect(good).toEqual([2]);
    expect(n.stats.failures).toBe(1);
    expect(n.stats.notified).toBe(1);
  });

  it('ignores a commitment the chain does not know', async () => {
    const store = new MemoryWatchStore();
    await store.add(1, A);
    const { sent, send } = collector();
    await new SettlementNotifier(store, chainWith({}), { send }).tick();
    expect(sent).toHaveLength(0);
    expect(await store.list(1)).toEqual([A]);
  });

  it('survives a chain that throws', async () => {
    const store = new MemoryWatchStore();
    await store.add(1, A);
    const { sent, send } = collector();
    const n = new SettlementNotifier(
      store,
      { ...chainWith({}), getInvoice: async () => { throw new Error('indexer down'); } },
      { send },
    );
    await n.tick();
    expect(sent).toHaveLength(0);
    expect(n.stats.failures).toBe(1);
  });
});
