// Gift cards — private bearer notes.
//
// Two things need proving. First, that the card secret really controls the
// money: the same secret must always derive the same spending key, and a
// different secret must never derive it. Second, that the registry proves
// authenticity without leaking anything.
//
// This replaces an earlier custody design. That one held the coin in contract
// state, which put the pot's value on chain and made every redemption readable
// as a delta — 500 to 750 to 875, redeem 137, 738. The leak was the custody
// itself, so custody went.

import { describe, it, expect } from 'vitest';
import {
  createGiftCard,
  coinPublicKeyForCard,
  keysForCard,
  encodeCard,
  decodeCard,
} from '../src/gift-card.js';
import { MaskGiftSimulator, bytes32, type GiftPrivateState } from './mask-gift-simulator.js';

const SECRET = bytes32(0xc1);
const MERCHANT = bytes32(0x11);

const state = (over: Partial<GiftPrivateState> = {}): GiftPrivateState => ({
  secret: SECRET,
  merchantKey: MERCHANT,
  ...over,
});

const sim = (over: Partial<GiftPrivateState> = {}) => new MaskGiftSimulator(state(over));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const published = (s: MaskGiftSimulator) =>
  JSON.stringify(s.ledger(), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

describe('the card controls the money', () => {
  it('derives a spending key from the card secret', () => {
    const card = createGiftCard();
    expect(card.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(card.coinPublicKey.length).toBeGreaterThan(0);
  });

  it('the same secret always derives the same key', () => {
    // If this ever drifted, previously issued cards would stop opening.
    const card = createGiftCard();
    expect(coinPublicKeyForCard(card.secret)).toBe(card.coinPublicKey);
    expect(coinPublicKeyForCard(card.secret)).toBe(coinPublicKeyForCard(card.secret));
  });

  it('a different secret never derives the same key', () => {
    const keys = new Set(Array.from({ length: 25 }, () => createGiftCard().coinPublicKey));
    expect(keys.size).toBe(25);
  });

  it('the holder can rebuild the spending keys from the secret alone', () => {
    const card = createGiftCard();
    const keys = keysForCard(card.secret);
    expect(keys).toBeDefined();
    expect(keys.coinPublicKey).toBeDefined();
  });

  it('rejects a malformed secret rather than deriving a key nobody owns', () => {
    // Silently accepting junk would send a coin to an unopenable key and burn
    // the money.
    for (const bad of ['', 'abc', 'zz'.repeat(32), 'ab'.repeat(31)]) {
      expect(() => keysForCard(bad)).toThrow();
    }
  });
});

describe('handing a card over', () => {
  it('round-trips through an encoded card', () => {
    const card = createGiftCard();
    card.commitment = 'ab'.repeat(32);
    const decoded = decodeCard(encodeCard(card, 'cd'.repeat(32)));

    expect(decoded).not.toBeNull();
    expect(decoded!.secret).toBe(card.secret);
    expect(decoded!.commitment).toBe(card.commitment);
    expect(decoded!.contractAddress).toBe('cd'.repeat(32));
  });

  it('accepts a full link as well as a bare payload', () => {
    const card = createGiftCard();
    const encoded = encodeCard(card);
    expect(decodeCard(`https://mask.example/gift#${encoded}`)?.secret).toBe(card.secret);
  });

  it('returns null for junk rather than throwing', () => {
    for (const bad of ['', 'not-base64!!', 'aGVsbG8=', '#']) {
      expect(decodeCard(bad)).toBeNull();
    }
  });

  it('rejects a card whose secret is the wrong length', () => {
    const forged = Buffer.from(JSON.stringify({ s: 'short' })).toString('base64url');
    expect(decodeCard(forged)).toBeNull();
  });
});

describe('the registry', () => {
  it('registers a card and confirms it is genuine', () => {
    const s = sim();
    const c = s.issue();
    expect(c).toHaveLength(32);
    expect(s.cardIssued(c)).toBe(true);
    expect(s.ledger().issued).toBe(1n);
  });

  it('REFUSES issuing the same card twice', () => {
    const s = sim();
    s.issue();
    expect(() => s.issue()).toThrow(/already issued/);
  });

  it('a card from a different merchant has a different commitment', () => {
    const a = sim().issue();
    const b = sim({ merchantKey: bytes32(0x99) }).issue();
    expect(hex(a)).not.toBe(hex(b));
  });

  it('an unregistered card does not verify', () => {
    expect(sim().cardIssued(bytes32(0xee))).toBe(false);
  });

  it('lets the merchant void a card', () => {
    const s = sim();
    const c = s.issue();
    s.voidCard();
    expect(s.cardVoided(c)).toBe(true);
  });

  it('REFUSES voiding by anyone but the issuing merchant', () => {
    const s = sim();
    s.issue();
    expect(() => s.as({ merchantKey: bytes32(0x99) }).voidCard()).toThrow(/unknown card/);
  });

  it('REFUSES voiding twice', () => {
    const s = sim();
    s.issue();
    s.voidCard();
    expect(() => s.voidCard()).toThrow(/already void/);
  });

  it('REFUSES voiding a card that was never issued', () => {
    expect(() => sim().voidCard()).toThrow(/unknown card/);
  });
});

describe('privacy', () => {
  it('publishes no card secret and no merchant key', () => {
    const s = sim();
    s.issue();
    const out = published(s);
    expect(out).not.toContain(hex(SECRET));
    expect(out).not.toContain(hex(MERCHANT));
  });

  it('publishes NO value at all — there is no vault to watch', () => {
    // The whole reason custody was dropped. The ledger has no coin, no total
    // and no delta, so there is nothing an observer can measure.
    const s = sim();
    s.issue();
    s.as({ secret: bytes32(0xc2) }).issue();

    const l = s.ledger() as unknown as Record<string, unknown>;
    expect(Object.keys(l).sort()).toEqual(['cards', 'issued', 'voided']);
    expect(published(s)).not.toMatch(/"value"/);
  });

  it('two cards are indistinguishable in the registry', () => {
    const s = sim();
    const a = s.issue();
    const b = s.as({ secret: bytes32(0xc2) }).issue();

    // Both are 32-byte commitments with nothing to tell them apart.
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(hex(a)).not.toBe(hex(b));
    expect(s.ledger().cards.size()).toBe(2n);
  });
});
