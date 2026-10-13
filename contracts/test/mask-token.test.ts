// Mask reference tokens.
//
// mUSDC and mUSAD exist because Midnight has no stablecoin and an invoice has
// to be denominated in something. What matters is that they are genuinely
// distinct assets, that every minted coin is unique, and that minting one does
// not tell an observer which asset was minted — the last of these is the reason
// there is no per-asset counter, and a test is the only thing that keeps it
// that way.

import { describe, it, expect } from 'vitest';
import { MaskToken } from '../build/mask_token/contract/index.js';
import { MaskTokenSimulator, bytes32 } from './mask-token-simulator.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('colours', () => {
  it('gives mUSDC and mUSAD different colours', () => {
    // If these collided the two assets would be one asset, and an invoice
    // denominated in mUSDC could be paid in mUSAD.
    const sim = new MaskTokenSimulator();
    expect(hex(sim.tokenColor(MaskToken.MUSDC))).not.toBe(hex(sim.tokenColor(MaskToken.MUSAD)));
  });

  it('gives the same colour for the same asset every time', () => {
    const sim = new MaskTokenSimulator();
    expect(hex(sim.tokenColor(MaskToken.MUSDC))).toBe(hex(sim.tokenColor(MaskToken.MUSDC)));
  });

  it('ties the colour to the contract, so another deployment is another asset', () => {
    // A colour is derived from (domain separator, contract address). Two
    // deployments therefore issue different assets even with the same seed —
    // which is what stops anyone minting "Mask mUSDC" from their own contract.
    const a = new MaskTokenSimulator();
    const b = new MaskTokenSimulator();
    expect(hex(a.tokenColor(MaskToken.MUSDC))).not.toBe(hex(b.tokenColor(MaskToken.MUSDC)));
  });
});

describe('minting', () => {
  it('mints a coin of the requested value and colour', () => {
    const sim = new MaskTokenSimulator();
    const coin = sim.mint(MaskToken.MUSDC, 1_000n);
    expect(coin.value).toBe(1_000n);
    expect(hex(coin.color)).toBe(hex(sim.tokenColor(MaskToken.MUSDC)));
  });

  it('mints mUSAD with the mUSAD colour', () => {
    const sim = new MaskTokenSimulator();
    const coin = sim.mint(MaskToken.MUSAD, 42n);
    expect(hex(coin.color)).toBe(hex(sim.tokenColor(MaskToken.MUSAD)));
  });

  it('gives every coin a distinct nonce', () => {
    // A reused nonce links two coins to each other, which destroys the privacy
    // the shielded token exists to provide.
    const sim = new MaskTokenSimulator();
    const nonces = new Set<string>();
    for (let i = 0; i < 8; i++) nonces.add(hex(sim.mint(MaskToken.MUSDC, 100n).nonce));
    expect(nonces.size).toBe(8);
  });

  it('gives distinct nonces across the two assets too', () => {
    const sim = new MaskTokenSimulator();
    const a = sim.mint(MaskToken.MUSDC, 100n);
    const b = sim.mint(MaskToken.MUSAD, 100n);
    expect(hex(a.nonce)).not.toBe(hex(b.nonce));
  });

  it('derives nonces from the constructor seed, so two contracts differ', () => {
    const a = new MaskTokenSimulator(bytes32(0x01));
    const b = new MaskTokenSimulator(bytes32(0x02));
    expect(hex(a.mint(MaskToken.MUSDC, 1n).nonce)).not.toBe(hex(b.mint(MaskToken.MUSDC, 1n).nonce));
  });

  it('counts mints without recording which asset was minted', () => {
    // The deliberate omission. A per-asset counter would publish the asset of
    // every mint; only the aggregate exists, so an observer learns "someone
    // minted something" and nothing more.
    const sim = new MaskTokenSimulator();
    sim.mint(MaskToken.MUSDC, 500n);
    sim.mint(MaskToken.MUSAD, 700n);
    sim.mint(MaskToken.MUSDC, 900n);

    expect(sim.ledger().mint_counter).toBe(3n);
    expect(Object.keys(sim.ledger())).toEqual(['mint_counter', 'mint_seed']);
  });

  it('publishes no minted amount', () => {
    const sim = new MaskTokenSimulator();
    sim.mint(MaskToken.MUSDC, 123_456n);
    sim.mint(MaskToken.MUSAD, 987_654n);

    const published = JSON.stringify(sim.ledger(), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? hex(v) : v,
    );
    expect(published).not.toContain('123456');
    expect(published).not.toContain('987654');
  });

  it('mints zero without inventing value', () => {
    // Zero is not rejected — it is a coin worth nothing, which is harmless and
    // cheaper than an assert. What must not happen is a zero request producing
    // a non-zero coin.
    const sim = new MaskTokenSimulator();
    expect(sim.mint(MaskToken.MUSDC, 0n).value).toBe(0n);
  });

  it('mints the largest value the type allows', () => {
    const sim = new MaskTokenSimulator();
    const max = 18_446_744_073_709_551_615n;
    expect(sim.mint(MaskToken.MUSDC, max).value).toBe(max);
  });

  it('refuses a value that does not fit in 64 bits', () => {
    const sim = new MaskTokenSimulator();
    expect(() => sim.mint(MaskToken.MUSDC, 18_446_744_073_709_551_616n)).toThrow();
  });
});

describe('the mint seed', () => {
  it('is public, and that is deliberate', () => {
    // The seed is disclosed at construction. It has to be: nonces are derived
    // from it and the ledger must agree with the client on what they are. It is
    // not a secret — knowing it reveals nonces, not balances or holders.
    const seed = bytes32(0xab);
    const sim = new MaskTokenSimulator(seed);
    expect(hex(sim.ledger().mint_seed)).toBe(hex(seed));
  });
});
