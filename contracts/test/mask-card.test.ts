// Mask Card, burner and gift credentials.
//
// The card is two-factor by construction: the commitment is over both the
// secret and the PIN, so holding one without the other authorises nothing.
// That property is what the theft tests below actually check.

import { describe, it, expect } from 'vitest';
import { CredentialKind } from '../build/mask_card/contract/index.js';
import { MaskCardSimulator, bytes32, type CardPrivateState } from './mask-card-simulator.js';

const SECRET = bytes32(0xc1);
const PIN = bytes32(0x1a);
const SALT = bytes32(0x5a);
const LIMIT = 100_000n;

const state = (over: Partial<CardPrivateState> = {}): CardPrivateState => ({
  secret: SECRET,
  pin: PIN,
  salt: SALT,
  authAmount: 25_000n,
  authIndex: 0n,
  ...over,
});

const sim = (over: Partial<CardPrivateState> = {}) => new MaskCardSimulator(state(over));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('credential creation', () => {
  it('creates a card and publishes only its commitment', () => {
    const s = sim();
    const c = s.create(CredentialKind.CARD, LIMIT);

    expect(c).toHaveLength(32);
    expect(s.isActive(c)).toBe(true);
    expect(s.ledger().credentials_created).toBe(1n);

    const published = JSON.stringify(s.ledger(), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ).toLowerCase();
    expect(published).not.toContain(hex(SECRET));
    expect(published).not.toContain(hex(PIN));
    expect(published).not.toContain(hex(SALT));
  });

  it('rejects creating the same credential twice', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    expect(() => s.create(CredentialKind.CARD, LIMIT)).toThrow(/already exists/);
  });

  it('cards, burners and gift cards are distinct credential types', () => {
    const card = sim().create(CredentialKind.CARD, LIMIT);
    const burner = sim().create(CredentialKind.BURNER, LIMIT);
    const gift = sim().create(CredentialKind.GIFT, LIMIT);

    expect(hex(card)).not.toBe(hex(burner));
    expect(hex(burner)).not.toBe(hex(gift));
    expect(hex(card)).not.toBe(hex(gift));
  });
});

describe('two-factor authorisation', () => {
  it('authorises a payment with no wallet connected', () => {
    const s = sim();
    const c = s.create(CredentialKind.CARD, LIMIT);
    const nullifier = s.authorise(CredentialKind.CARD);

    expect(nullifier).toHaveLength(32);
    expect(s.authUsed(nullifier)).toBe(true);
    expect(s.ledger().credentials.lookup(c).uses).toBe(1n);
  });

  it('REFUSES a stolen card without the PIN', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    expect(() => s.as({ pin: bytes32(0x99) }).authorise(CredentialKind.CARD)).toThrow(
      /unknown credential/,
    );
  });

  it('REFUSES a known PIN without the card secret', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    expect(() => s.as({ secret: bytes32(0x99) }).authorise(CredentialKind.CARD)).toThrow(
      /unknown credential/,
    );
  });

  it('REFUSES an amount over the spend limit', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    expect(() => s.as({ authAmount: LIMIT + 1n }).authorise(CredentialKind.CARD)).toThrow(
      /exceeds card spend limit/,
    );
  });

  it('allows an amount exactly at the limit', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    expect(() => s.as({ authAmount: LIMIT }).authorise(CredentialKind.CARD)).not.toThrow();
  });

  it('REFUSES replaying the same authorisation', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    s.authorise(CredentialKind.CARD);
    expect(() => s.authorise(CredentialKind.CARD)).toThrow(/already used/);
  });

  it('allows a further authorisation under a new index', () => {
    const s = sim();
    const c = s.create(CredentialKind.CARD, LIMIT);
    s.as({ authIndex: 0n }).authorise(CredentialKind.CARD);
    s.as({ authIndex: 1n }).authorise(CredentialKind.CARD);
    expect(s.ledger().credentials.lookup(c).uses).toBe(2n);
  });

  it('publishes a use count but never the amounts', () => {
    const s = sim();
    const c = s.create(CredentialKind.CARD, LIMIT);
    s.as({ authAmount: 33_333n, authIndex: 0n }).authorise(CredentialKind.CARD);
    s.as({ authAmount: 44_444n, authIndex: 1n }).authorise(CredentialKind.CARD);

    expect(s.ledger().credentials.lookup(c).uses).toBe(2n);
    const published = JSON.stringify(s.ledger(), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(published).not.toContain('33333');
    expect(published).not.toContain('44444');
  });
});

describe('deactivation', () => {
  it('freezes a lost card', () => {
    const s = sim();
    const c = s.create(CredentialKind.CARD, LIMIT);
    s.deactivate(CredentialKind.CARD);
    expect(s.isActive(c)).toBe(false);
  });

  it('REFUSES authorisation on a frozen card', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    s.deactivate(CredentialKind.CARD);
    expect(() => s.authorise(CredentialKind.CARD)).toThrow(/not active/);
  });

  it('REFUSES freezing by someone without both factors', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    expect(() => s.as({ pin: bytes32(0x99) }).deactivate(CredentialKind.CARD)).toThrow(
      /unknown credential/,
    );
  });

  it('REFUSES freezing twice', () => {
    const s = sim();
    s.create(CredentialKind.CARD, LIMIT);
    s.deactivate(CredentialKind.CARD);
    expect(() => s.deactivate(CredentialKind.CARD)).toThrow(/already inactive/);
  });
});

describe('public checks', () => {
  it('an unknown credential is not active', () => {
    expect(sim().isActive(bytes32(0xee))).toBe(false);
  });

  it('an unissued authorisation is not used', () => {
    expect(sim().authUsed(bytes32(0xee))).toBe(false);
  });
});
