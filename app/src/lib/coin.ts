// Building the coin an escrowed payment moves.
//
// Escrow means the payer hands the contract a real shielded coin, which the
// contract forwards to the merchant in the same transaction. The circuit needs
// that coin as a value — nonce, colour, amount — before it can prove anything.
//
// The nonce is invented here rather than taken from an existing UTXO, because
// the Lace connector exposes balances but no coin list: there is no existing
// nonce a browser DApp could name. The wallet fills the gap while balancing —
// `balanceUnsealedTransaction` adds "necessary inputs and outputs to remove
// imbalances", so it funds the coin the page describes.
//
// That is not an assumption. devkit/src/fresh-coin-probe.ts settles an invoice
// on chain with a freshly invented nonce, and it is accepted. The whole feature
// rests on that result, which is why the probe exists.

import { CompactTypeBytes, CompactTypeVector, persistentCommit } from '@midnight-ntwrk/compact-runtime';
import { TokenKind, type TokenKindValue } from './invoice.ts';
import { fromHex, randomBytes } from './format.ts';

const PAIR = new CompactTypeVector(2, new CompactTypeBytes(32));

function pad32(text: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(text));
  return out;
}

const DERIVE_TOKEN = pad32('midnight:derive_token');
const MUSDC_DOMAIN = pad32('mask:token:musdc:v1');
const MUSAD_DOMAIN = pad32('mask:token:musad:v1');

/** The address of the deployed mask_token, if one is configured. */
const TOKEN_CONTRACT = import.meta.env.VITE_TOKEN_CONTRACT_ADDRESS as string | undefined;

/**
 * The colour a coin must carry to settle an invoice in `token`.
 *
 * Native is the ledger's own asset and its colour is all zeros. The reference
 * assets are derived from the issuing contract's address, exactly as
 * mask_token's `token_color` does — a derivation checked against the compiled
 * contract in contracts/test/token-color.test.ts.
 *
 * Returns null when the asset cannot be resolved, which is honest: without a
 * mask_token address the page does not know what a mUSDC coin looks like, and
 * guessing would produce a payment the contract rejects half a minute later.
 */
export function colorFor(token: TokenKindValue): Uint8Array | null {
  if (token === TokenKind.NATIVE) return new Uint8Array(32);
  if (!TOKEN_CONTRACT) return null;
  const domain = token === TokenKind.MUSDC ? MUSDC_DOMAIN : MUSAD_DOMAIN;
  return persistentCommit(PAIR as never, [domain, fromHex(TOKEN_CONTRACT)] as never, DERIVE_TOKEN) as Uint8Array;
}

export interface ShieldedCoin {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

/** A coin of exactly the invoice's amount, for the wallet to fund. */
export function coinForPayment(token: TokenKindValue, amount: bigint): ShieldedCoin | null {
  const color = colorFor(token);
  if (!color) return null;
  return { nonce: randomBytes(32), color, value: amount };
}

/** Whether escrow is possible for this asset at all. */
export const escrowSupported = (token: TokenKindValue): boolean => colorFor(token) !== null;
