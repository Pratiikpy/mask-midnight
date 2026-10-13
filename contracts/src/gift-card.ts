// Gift card key derivation.
//
// A card is a 32-byte secret. That secret seeds a zswap keypair, and the coin
// is sent to the resulting public key — so holding the secret is holding the
// money, with no contract in the middle and nothing on chain to watch.
//
// This lives beside the contracts because the app, the devkit and the SDK all
// need to agree on exactly how a secret becomes a key. If they disagree, cards
// are issued to keys nobody can open, and the value is gone.

import { webcrypto } from 'node:crypto';
import { ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/ledger';

export interface GiftCard {
  /** The card. Whoever holds this can spend it. */
  secret: string;
  /** Where the coin is sent. Derived from the secret. */
  coinPublicKey: string;
  /** Registered on chain so a recipient can check the card is genuine. */
  commitment?: string;
}

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const fromHex = (h: string): Uint8Array => {
  const clean = h.startsWith('0x') ? h.slice(2) : h;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) {
    throw new Error('not a hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Rebuild the spending keys for a card. The holder does this to redeem. */
export function keysForCard(secret: string): ZswapSecretKeys {
  const seed = fromHex(secret);
  if (seed.length !== 32) throw new Error('card secret must be 32 bytes');
  return ZswapSecretKeys.fromSeed(seed);
}

/** The public key a card's coin is sent to. */
export function coinPublicKeyForCard(secret: string): string {
  const key = keysForCard(secret).coinPublicKey;
  return typeof key === 'string' ? key : toHex(key as unknown as Uint8Array);
}

/** Mint a new card secret and derive where its coin should go. */
export function createGiftCard(): GiftCard {
  const secret = toHex(webcrypto.getRandomValues(new Uint8Array(32)));
  return { secret, coinPublicKey: coinPublicKeyForCard(secret) };
}

/**
 * Encode a card for handing over — a link, a QR code, a printed slip.
 *
 * The secret is the whole value, so this string is cash. It goes in a URL
 * fragment for the same reason invoice terms do: browsers never transmit a
 * fragment to a server.
 */
export function encodeCard(card: GiftCard, contractAddress?: string): string {
  const payload = { s: card.secret, c: card.commitment, a: contractAddress };
  return Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeCard(
  encoded: string,
): { secret: string; commitment?: string; contractAddress?: string } | null {
  try {
    const fragment = encoded.includes('#') ? encoded.slice(encoded.indexOf('#') + 1) : encoded;
    const b64 = fragment.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
      s?: string;
      c?: string;
      a?: string;
    };
    if (typeof parsed.s !== 'string' || !/^[0-9a-fA-F]{64}$/.test(parsed.s)) return null;
    return { secret: parsed.s, commitment: parsed.c, contractAddress: parsed.a };
  } catch {
    return null;
  }
}
