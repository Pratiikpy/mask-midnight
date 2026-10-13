// Does the client-side colour derivation match the contract's?
//
// mask_pay is told mUSDC's and mUSAD's colours at deployment, and the deploy
// script computes them in TypeScript rather than paying for an on-chain call to
// `token_color`. If that reproduction is wrong by a byte, every invoice
// denominated in a reference token becomes unsettleable — and the failure would
// only appear on chain, thirty seconds into a payment.
//
// So the derivation is checked against the compiled contract itself.

import { describe, it, expect } from 'vitest';
import { MaskToken } from '../build/mask_token/contract/index.js';
import { MaskTokenSimulator } from './mask-token-simulator.js';
import {
  MUSAD_DOMAIN,
  MUSDC_DOMAIN,
  UNBOUND_COLORS,
  hexToBytes,
  maskTokenColors,
  pad32,
  tokenColor,
} from '../src/token-color.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** The address the simulator's contract believes it lives at, as bytes. */
function simulatorAddress(sim: MaskTokenSimulator): Uint8Array {
  // QueryContext.address is a hex string, not a struct — the ContractAddress
  // wrapper only exists on the Compact side.
  const ctx = sim.circuitContext.currentQueryContext as unknown as { address: string };
  return hexToBytes(ctx.address);
}

describe('the TypeScript derivation', () => {
  it('reproduces mask_token.token_color for mUSDC', () => {
    const sim = new MaskTokenSimulator();
    const fromContract = sim.tokenColor(MaskToken.MUSDC);
    const fromTs = tokenColor(MUSDC_DOMAIN, simulatorAddress(sim));
    expect(hex(fromTs)).toBe(hex(fromContract));
  });

  it('reproduces mask_token.token_color for mUSAD', () => {
    const sim = new MaskTokenSimulator();
    const fromContract = sim.tokenColor(MaskToken.MUSAD);
    const fromTs = tokenColor(MUSAD_DOMAIN, simulatorAddress(sim));
    expect(hex(fromTs)).toBe(hex(fromContract));
  });

  it('agrees with the colour a minted coin actually carries', () => {
    // The strongest form of the check: not the accessor circuit, but the colour
    // stamped onto a real coin by mintShieldedToken.
    const sim = new MaskTokenSimulator();
    const coin = sim.mint(MaskToken.MUSDC, 1_000n);
    expect(hex(tokenColor(MUSDC_DOMAIN, simulatorAddress(sim)))).toBe(hex(coin.color));
  });

  it('gives different colours for different issuing contracts', () => {
    const a = maskTokenColors('11'.repeat(32));
    const b = maskTokenColors('22'.repeat(32));
    expect(hex(a.musdc)).not.toBe(hex(b.musdc));
    expect(hex(a.musdc)).not.toBe(hex(a.musad));
  });

  it('refuses an address that is not 32 bytes', () => {
    expect(() => maskTokenColors('abcd')).toThrow(/32-byte/);
  });
});

describe('the domain separators', () => {
  it('match the strings in mask_token.compact', () => {
    expect(hex(MUSDC_DOMAIN)).toBe(hex(pad32('mask:token:musdc:v1')));
    expect(hex(MUSAD_DOMAIN)).toBe(hex(pad32('mask:token:musad:v1')));
  });

  it('pads to 32 bytes on the right, as Compact does', () => {
    const p = pad32('abc');
    expect(p).toHaveLength(32);
    expect(p[0]).toBe(0x61);
    expect(p[3]).toBe(0);
  });

  it('refuses a string longer than 32 bytes', () => {
    expect(() => pad32('x'.repeat(33))).toThrow(/does not fit/);
  });
});

describe('the unbound placeholder colours', () => {
  it('are not the native token', () => {
    // Zero is the native colour. If the placeholder were zeros, a mUSDC invoice
    // on a mask_pay deployed without a mask_token would be settleable in
    // tNIGHT — the precise bug the colour check exists to prevent.
    const zeros = new Uint8Array(32);
    expect(hex(UNBOUND_COLORS.musdc)).not.toBe(hex(zeros));
    expect(hex(UNBOUND_COLORS.musad)).not.toBe(hex(zeros));
  });

  it('are distinct from each other and from any real colour', () => {
    const real = maskTokenColors('33'.repeat(32));
    expect(hex(UNBOUND_COLORS.musdc)).not.toBe(hex(UNBOUND_COLORS.musad));
    expect(hex(UNBOUND_COLORS.musdc)).not.toBe(hex(real.musdc));
  });
});
