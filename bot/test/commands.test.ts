// The bot's whole surface, without a token or a chain.
//
// Two things are tested harder than the rest. First, that no reply ever carries
// an amount — the bot cannot learn one, but a future edit could add a field
// that looks harmless, and this is the test that would stop it. Second, that
// junk input gets a useful sentence instead of a crash or silence.

import { describe, it, expect } from 'vitest';
import { COMMANDS, handle, type BotContext, type ChainReader, type InvoiceView } from '../src/commands.ts';

const COMMITMENT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const RECEIPT = 'c'.repeat(64);

const openInvoice: InvoiceView = {
  status: 'open',
  kind: 'standard',
  token: 'tNIGHT',
  contributions: 0,
  expiresAt: 0n,
};

function fakeChain(over: Partial<ChainReader> = {}): ChainReader {
  return {
    getInvoice: async () => openInvoice,
    receiptExists: async () => true,
    attestationExists: async () => true,
    totalCreated: async () => 7n,
    ...over,
  };
}

function ctx(over: Partial<BotContext> = {}): BotContext {
  const watched = new Map<number, string[]>();
  return {
    chain: fakeChain(),
    appUrl: 'https://mask.example',
    watched: async (id) => watched.get(id) ?? [],
    watch: async (id, c) => {
      watched.set(id, [...(watched.get(id) ?? []), c]);
    },
    unwatch: async (id, c) => {
      const list = watched.get(id) ?? [];
      const next = list.filter((x) => x !== c);
      watched.set(id, next);
      return next.length !== list.length;
    },
    ...over,
  };
}

describe('help', () => {
  it('says what it cannot do, not only what it can', () => {
    // The honest half. A bot that lists features and omits the refusals reads
    // as though the missing ones are coming.
    return handle('/start', 1, ctx()).then((r) => {
      expect(r.text).toMatch(/does not do/i);
      expect(r.text).toMatch(/create invoices/i);
    });
  });

  it('answers /help the same way', async () => {
    const a = await handle('/start', 1, ctx());
    const b = await handle('/help', 1, ctx());
    expect(b.text).toBe(a.text);
  });

  it('handles the @botname suffix groups add', async () => {
    const r = await handle('/start@maskbot', 1, ctx());
    expect(r.text).toMatch(/Mask on Midnight/);
  });

  it('registers every command it answers', async () => {
    // A command in the menu that the router does not know is a dead end for
    // whoever taps it.
    for (const c of COMMANDS) {
      const r = await handle(`/${c.command}`, 1, ctx());
      expect(r.text, `/${c.command}`).not.toMatch(/I do not know/);
    }
  });
});

describe('invoice lookup', () => {
  it('reports status without an amount', async () => {
    const r = await handle(`/invoice ${COMMITMENT}`, 1, ctx());
    expect(r.text).toMatch(/OPEN/);
    expect(r.text).toMatch(/does not hold one/);
  });

  it('says plainly when nothing is there', async () => {
    const c = ctx({ chain: fakeChain({ getInvoice: async () => ({ ...openInvoice, status: 'unknown' }) }) });
    const r = await handle(`/invoice ${COMMITMENT}`, 1, c);
    expect(r.text).toMatch(/No invoice with that commitment/);
  });

  it('shows an expiry when there is one', async () => {
    const c = ctx({
      chain: fakeChain({
        getInvoice: async () => ({ ...openInvoice, expiresAt: 1_759_296_000n }),
      }),
    });
    const r = await handle(`/invoice ${COMMITMENT}`, 1, c);
    expect(r.text).toMatch(/expires       2025-/);
  });

  it('says "never" when there is not', async () => {
    const r = await handle(`/invoice ${COMMITMENT}`, 1, ctx());
    expect(r.text).toMatch(/expires       never/);
  });

  it('treats a bare commitment as a lookup', async () => {
    const r = await handle(COMMITMENT, 1, ctx());
    expect(r.text).toMatch(/OPEN/);
  });

  it('refuses something that is not a commitment', async () => {
    const r = await handle('/invoice not-a-hash', 1, ctx());
    expect(r.text).toMatch(/64 hex characters/);
  });

  it('asks for the argument when there is none', async () => {
    const r = await handle('/invoice', 1, ctx());
    expect(r.text).toMatch(/Usage/);
  });

  it('accepts uppercase hex', async () => {
    const r = await handle(`/invoice ${COMMITMENT.toUpperCase()}`, 1, ctx());
    expect(r.text).toMatch(/OPEN/);
  });
});

describe('receipts and attestations', () => {
  it('confirms a receipt and says what it does not reveal', async () => {
    const r = await handle(`/receipt ${RECEIPT}`, 1, ctx());
    expect(r.text).toMatch(/On the ledger/);
    expect(r.text).toMatch(/not derivable/);
  });

  it('reports an absent receipt', async () => {
    const c = ctx({ chain: fakeChain({ receiptExists: async () => false }) });
    const r = await handle(`/receipt ${RECEIPT}`, 1, c);
    expect(r.text).toMatch(/Not on the ledger/);
  });

  it('confirms an attestation without claiming to know the revenue', async () => {
    const r = await handle(`/attestation ${RECEIPT}`, 1, ctx());
    expect(r.text).toMatch(/Published/);
    expect(r.text).toMatch(/actual revenue is not/);
  });

  it('accepts /attest as a synonym', async () => {
    const r = await handle(`/attest ${RECEIPT}`, 1, ctx());
    expect(r.text).toMatch(/Published/);
  });
});

describe('watching', () => {
  it('starts a watch on an open invoice', async () => {
    const c = ctx();
    const r = await handle(`/watch ${COMMITMENT}`, 1, c);
    expect(r.text).toMatch(/Watching/);
    expect(await c.watched(1)).toEqual([COMMITMENT]);
  });

  it('refuses to watch something already settled', async () => {
    const c = ctx({ chain: fakeChain({ getInvoice: async () => ({ ...openInvoice, status: 'settled' }) }) });
    const r = await handle(`/watch ${COMMITMENT}`, 1, c);
    expect(r.text).toMatch(/already settled/);
    expect(await c.watched(1)).toEqual([]);
  });

  it('explains that a new invoice takes time to appear', async () => {
    const c = ctx({ chain: fakeChain({ getInvoice: async () => ({ ...openInvoice, status: 'unknown' }) }) });
    const r = await handle(`/watch ${COMMITMENT}`, 1, c);
    expect(r.text).toMatch(/25 seconds/);
  });

  it('does not watch the same thing twice', async () => {
    const c = ctx();
    await handle(`/watch ${COMMITMENT}`, 1, c);
    const again = await handle(`/watch ${COMMITMENT}`, 1, c);
    expect(again.text).toMatch(/Already watching/);
    expect(await c.watched(1)).toHaveLength(1);
  });

  it('keeps chats separate', async () => {
    // One chat's watch list must never leak into another's, which is the
    // smallest version of the correlation this whole design avoids.
    const c = ctx();
    await handle(`/watch ${COMMITMENT}`, 1, c);
    await handle(`/watch ${OTHER}`, 2, c);
    expect(await c.watched(1)).toEqual([COMMITMENT]);
    expect(await c.watched(2)).toEqual([OTHER]);
  });

  it('stops watching', async () => {
    const c = ctx();
    await handle(`/watch ${COMMITMENT}`, 1, c);
    const r = await handle(`/unwatch ${COMMITMENT}`, 1, c);
    expect(r.text).toMatch(/Stopped watching/);
    expect(await c.watched(1)).toEqual([]);
  });

  it('says so when there was nothing to stop', async () => {
    const r = await handle(`/unwatch ${COMMITMENT}`, 1, ctx());
    expect(r.text).toMatch(/was not watching/);
  });

  it('lists nothing without pretending otherwise', async () => {
    const r = await handle('/watching', 1, ctx());
    expect(r.text).toMatch(/Not watching anything/);
  });

  it('lists what it is watching', async () => {
    const c = ctx();
    await handle(`/watch ${COMMITMENT}`, 1, c);
    const r = await handle('/watching', 1, c);
    expect(r.text).toMatch(/Watching 1:/);
  });
});

describe('links', () => {
  it('sends creation to the browser and says why', async () => {
    const r = await handle('/create', 1, ctx());
    expect(r.text).toMatch(/never leave your machine/);
    expect(r.buttons?.[0]?.url).toBe('https://mask.example/create');
  });

  it('warns that a pasted payment link has been seen by Telegram', async () => {
    // True, easy to forget, and the kind of thing a privacy product should say
    // out loud rather than leave the user to work out.
    const r = await handle('/pay https://mask.example/pay#abc', 1, ctx());
    expect(r.text).toMatch(/seen by Telegram/);
    expect(r.buttons?.[0]?.url).toBe('https://mask.example/pay#abc');
  });

  it('builds a link from a bare fragment', async () => {
    const r = await handle('/pay abc123', 1, ctx());
    expect(r.buttons?.[0]?.url).toBe('https://mask.example/pay#abc123');
  });

  it('offers the pay page with no argument', async () => {
    const r = await handle('/pay', 1, ctx());
    expect(r.buttons?.[0]?.url).toBe('https://mask.example/pay');
  });
});

describe('stats', () => {
  it('reports the count and names what it is not', async () => {
    const r = await handle('/stats', 1, ctx());
    expect(r.text).toMatch(/7 invoices created/);
    expect(r.text).toMatch(/Not their value/);
  });
});

describe('unknown input', () => {
  it('does not pretend to know an unknown command', async () => {
    const r = await handle('/nonsense', 1, ctx());
    expect(r.text).toMatch(/I do not know/);
  });

  it('points plain text at something useful', async () => {
    const r = await handle('hello', 1, ctx());
    expect(r.text).toMatch(/\/start/);
  });

  it('survives an empty message', async () => {
    const r = await handle('   ', 1, ctx());
    expect(r.text).toBeTruthy();
  });
});

describe('nothing ever carries an amount', () => {
  // The invariant that matters. If the bot ever learns an amount it should not
  // be able to say it, and the only way to keep that true over time is to check
  // every reply the router can produce.
  const inputs = [
    '/start',
    '/privacy',
    '/stats',
    '/create',
    '/pay',
    `/invoice ${COMMITMENT}`,
    `/receipt ${RECEIPT}`,
    `/attestation ${RECEIPT}`,
    `/watch ${COMMITMENT}`,
    '/watching',
    COMMITMENT,
    'hello',
  ];

  it('never repeats a secret it was handed', async () => {
    // Checks for the VALUES, not the words. /privacy says "salt" on purpose —
    // naming what the bot cannot see is the message. Repeating an actual salt
    // would be the leak.
    const SECRET_SALT = 'f'.repeat(64);
    const chain = fakeChain({
      // A chain reader that tries to hand the bot things it should not carry.
      getInvoice: async () =>
        ({
          ...openInvoice,
          amount: 42_500n,
          salt: SECRET_SALT,
          merchantKey: 'deadbeefcafe',
        }) as unknown as InvoiceView,
    });

    for (const input of inputs) {
      const r = await handle(input, 1, ctx({ chain }));
      const text = `${r.text} ${(r.buttons ?? []).map((b) => b.url).join(' ')}`;
      expect(text, input).not.toMatch(/42500|42,500/);
      expect(text, input).not.toContain(SECRET_SALT);
      expect(text, input).not.toContain('deadbeefcafe');
    }
  });

  it('says the absence out loud on a lookup', async () => {
    // Not showing an amount is not the same as explaining that there is none.
    const r = await handle(`/invoice ${COMMITMENT}`, 1, ctx());
    expect(r.text).toMatch(/No amount is shown/);
  });
});
