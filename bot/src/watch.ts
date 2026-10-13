// Telling someone their invoice settled, without learning what it was worth.
//
// A watch is (chat, commitment). When the commitment's status stops being open,
// the chat gets one message and the watch is dropped. The notifier reads the
// same public state anyone can read — it is not told by the payer, and it does
// not ask the merchant.
//
// The store is deliberately in-memory. Watches are cheap to recreate and a
// durable list of "which chat cares about which invoice" is a correlation
// database: it links a Telegram account to a specific commitment, which is
// precisely the connection the chain refuses to make. Losing it on restart is
// a feature, and the /watching command makes the loss visible.

import type { ChainReader } from './commands.ts';

export interface WatchStore {
  add(chatId: number, commitment: string): Promise<void>;
  remove(chatId: number, commitment: string): Promise<boolean>;
  list(chatId: number): Promise<string[]>;
  all(): Promise<{ chatId: number; commitment: string }[]>;
}

export class MemoryWatchStore implements WatchStore {
  /** chatId -> commitments. A Set, so watching twice is watching once. */
  readonly #byChat = new Map<number, Set<string>>();

  /** Refused beyond this many per chat, so one chat cannot drive the poller. */
  readonly #limit: number;

  constructor(limitPerChat = 25) {
    this.#limit = limitPerChat;
  }

  async add(chatId: number, commitment: string): Promise<void> {
    const set = this.#byChat.get(chatId) ?? new Set<string>();
    if (set.size >= this.#limit && !set.has(commitment)) {
      throw new Error(`This chat is already watching ${this.#limit} invoices.`);
    }
    set.add(commitment);
    this.#byChat.set(chatId, set);
  }

  async remove(chatId: number, commitment: string): Promise<boolean> {
    const set = this.#byChat.get(chatId);
    if (!set) return false;
    const had = set.delete(commitment);
    if (set.size === 0) this.#byChat.delete(chatId);
    return had;
  }

  async list(chatId: number): Promise<string[]> {
    return [...(this.#byChat.get(chatId) ?? [])];
  }

  async all(): Promise<{ chatId: number; commitment: string }[]> {
    const out: { chatId: number; commitment: string }[] = [];
    for (const [chatId, set] of this.#byChat) {
      for (const commitment of set) out.push({ chatId, commitment });
    }
    return out;
  }
}

export interface NotifierOptions {
  /** Settlement takes ~30 s. Polling faster than that is pure waste. */
  intervalMs?: number;
  send: (chatId: number, text: string) => Promise<void>;
}

export class SettlementNotifier {
  readonly #store: WatchStore;
  readonly #chain: ChainReader;
  readonly #send: (chatId: number, text: string) => Promise<void>;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;

  readonly stats = { polls: 0, notified: 0, failures: 0 };

  constructor(store: WatchStore, chain: ChainReader, opts: NotifierOptions) {
    this.#store = store;
    this.#chain = chain;
    this.#send = opts.send;
    this.#intervalMs = opts.intervalMs ?? 15_000;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One pass. Separated from the timer so tests drive it directly. */
  async tick(): Promise<void> {
    this.stats.polls++;
    const watches = await this.#store.all();

    for (const { chatId, commitment } of watches) {
      try {
        const view = await this.#chain.getInvoice(commitment);
        if (view.status === 'open' || view.status === 'unknown') continue;

        // Dropped before sending, not after: a send that throws would
        // otherwise re-notify on every tick forever.
        await this.#store.remove(chatId, commitment);

        const text =
          view.status === 'settled'
            ? [
                `Settled: ${commitment.slice(0, 16)}…`,
                '',
                `${view.contributions} contribution${view.contributions === 1 ? '' : 's'}.`,
                '',
                'The amount is not in this message because it is not on the chain.',
              ].join('\n')
            : `Cancelled: ${commitment.slice(0, 16)}…\n\nThe merchant withdrew it. No payment was taken.`;

        await this.#send(chatId, text);
        this.stats.notified++;
      } catch {
        // A chain hiccup or a blocked bot must not stop the other watches.
        this.stats.failures++;
      }
    }
  }
}
