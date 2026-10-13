// The colour of a Mask reference token, computed without a transaction.
//
// A shielded token's colour is derived from (domain separator, issuing contract
// address), so mask_pay has to be told mUSDC's and mUSAD's colours when it is
// deployed — that is what binds "this invoice is in mUSDC" to a coin that
// actually is mUSDC.
//
// The obvious way to obtain them is to call mask_token's `token_color` circuit,
// but that is an on-chain call costing a proof and half a minute each. The
// derivation is deterministic, so it is reproduced here instead. It matches the
// compiled contract exactly:
//
//   tokenType(domain, address) = persistentCommit<Vector<2, Bytes<32>>>(
//     [domain, address.bytes], pad(32, "midnight:derive_token"))
//
// (see build/mask_token/contract/index.js, `_tokenType_0`).

import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentCommit,
} from '@midnight-ntwrk/compact-runtime';

const PAIR = new CompactTypeVector(2, new CompactTypeBytes(32));

/** Right-pad an ASCII string into 32 bytes, the way Compact's `pad` does. */
export function pad32(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 32) throw new Error(`"${text}" does not fit in 32 bytes`);
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

const DERIVE_TOKEN = pad32('midnight:derive_token');

/** The two domain separators mask_token uses. Must match mask_token.compact. */
export const MUSDC_DOMAIN = pad32('mask:token:musdc:v1');
export const MUSAD_DOMAIN = pad32('mask:token:musad:v1');

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (clean.length !== 64) throw new Error(`expected a 32-byte hex string, got ${clean.length / 2}`);
  return Uint8Array.from(clean.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** Colour of `domain` as issued by the contract at `address`. */
export function tokenColor(domain: Uint8Array, address: Uint8Array): Uint8Array {
  return persistentCommit(PAIR as never, [domain, address] as never, DERIVE_TOKEN) as Uint8Array;
}

export interface MaskTokenColors {
  musdc: Uint8Array;
  musad: Uint8Array;
}

/** Both Mask reference-token colours for a deployed mask_token contract. */
export function maskTokenColors(tokenContractAddress: string): MaskTokenColors {
  const addr = hexToBytes(tokenContractAddress);
  return {
    musdc: tokenColor(MUSDC_DOMAIN, addr),
    musad: tokenColor(MUSAD_DOMAIN, addr),
  };
}

/**
 * Placeholder colours, for a mask_pay deployed without a mask_token beside it.
 *
 * Not zeros: an all-zero colour is the native token's, which would silently
 * make a mUSDC invoice settleable in tNIGHT — exactly the bug the colour check
 * was added to close. These are unreachable values instead, so an invoice
 * denominated in a reference token simply cannot be settled until real colours
 * are sealed in.
 */
export const UNBOUND_COLORS: MaskTokenColors = {
  musdc: pad32('mask:token:unbound:musdc'),
  musad: pad32('mask:token:unbound:musad'),
};
