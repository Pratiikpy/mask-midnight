// Oracle tests.
//
// The signature is checked against the real Compact verifier by the contract
// suite (oracle-conversion.test.ts). What is tested here is everything around
// it: correct conversion arithmetic, expiry, refusal of nonsense, and the fact
// that a quote carries no identifying information.

import { describe, it, expect } from 'vitest';
import { FixedRateSource, Oracle, TokenKind, quoteDigest, serialiseQuote } from './oracle.ts';

const NOW = 1_700_000_000_000;

describe('rates', () => {
  it('returns 1:1 for the same asset', async () => {
    expect(await new FixedRateSource().rateMicros(TokenKind.NATIVE, TokenKind.NATIVE)).toBe(
      1_000_000n,
    );
  });

  it('refuses a pair it has no rate for', async () => {
    const empty = new FixedRateSource(new Map());
    await expect(empty.rateMicros(TokenKind.NATIVE, TokenKind.MUSDC)).rejects.toThrow(/No rate/);
  });
});

describe('quoting', () => {
  it('converts at the configured rate', async () => {
    const oracle = new Oracle();
    const q = await oracle.quote(1_000_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    // 1_000_000 * 2.15
    expect(q.convertedAmount).toBe(2_150_000n);
    expect(q.baseAmount).toBe(1_000_000n);
  });

  it('sets an expiry in the future', async () => {
    const oracle = new Oracle({ ttlMs: 60_000 });
    const q = await oracle.quote(1_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    expect(q.expiresAt).toBe(BigInt(Math.floor((NOW + 60_000) / 1000)));
  });

  it('refuses a zero or negative amount', async () => {
    const oracle = new Oracle();
    await expect(oracle.quote(0n, TokenKind.NATIVE, TokenKind.MUSDC, NOW)).rejects.toThrow(
      /greater than zero/,
    );
    await expect(oracle.quote(-5n, TokenKind.NATIVE, TokenKind.MUSDC, NOW)).rejects.toThrow(
      /greater than zero/,
    );
  });

  it('refuses an amount that converts to zero', async () => {
    // Silently quoting zero would let someone "pay" an invoice with nothing.
    const oracle = new Oracle({
      rates: new FixedRateSource(new Map([['0-1', 1n]])),
    });
    await expect(oracle.quote(1n, TokenKind.NATIVE, TokenKind.MUSDC, NOW)).rejects.toThrow(
      /converts to zero/,
    );
  });

  it('produces a signature over the quote', async () => {
    const oracle = new Oracle();
    const q = await oracle.quote(1_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    expect(typeof q.signature.response).toBe('bigint');
    expect(typeof q.signature.announcement.x).toBe('bigint');
    expect(q.signature.response).not.toBe(0n);
  });

  it('signs differently each time, even for identical terms', async () => {
    // A deterministic nonce would leak the signing key across two signatures.
    const oracle = new Oracle();
    const a = await oracle.quote(1_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    const b = await oracle.quote(1_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    expect(a.signature.response).not.toBe(b.signature.response);
  });

  it('counts quotes without recording amounts', async () => {
    const oracle = new Oracle();
    await oracle.quote(1_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    await oracle.quote(9_999n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    expect(oracle.stats.quotes).toBe(2);
    expect(JSON.stringify(oracle.stats)).not.toContain('9999');
  });
});

describe('the digest', () => {
  it('is four field elements', () => {
    const d = quoteDigest(1_000n, 2_150n, 0, 1, BigInt(NOW));
    expect(d).toHaveLength(4);
    for (const f of d) expect(typeof f).toBe('bigint');
  });

  it('changes with every input', () => {
    const base = quoteDigest(1_000n, 2_150n, 0, 1, BigInt(NOW));
    const variants = [
      quoteDigest(1_001n, 2_150n, 0, 1, BigInt(NOW)),
      quoteDigest(1_000n, 2_151n, 0, 1, BigInt(NOW)),
      quoteDigest(1_000n, 2_150n, 0, 2, BigInt(NOW)),
      quoteDigest(1_000n, 2_150n, 1, 1, BigInt(NOW)),
      quoteDigest(1_000n, 2_150n, 0, 1, BigInt(NOW + 1)),
    ];
    for (const v of variants) {
      expect(JSON.stringify(v.map(String))).not.toBe(JSON.stringify(base.map(String)));
    }
  });

  it('is stable for identical inputs', () => {
    const a = quoteDigest(1_000n, 2_150n, 0, 1, BigInt(NOW));
    const b = quoteDigest(1_000n, 2_150n, 0, 1, BigInt(NOW));
    expect(a.map(String)).toEqual(b.map(String));
  });
});

describe('serialisation', () => {
  it('survives a JSON round trip', async () => {
    const oracle = new Oracle();
    const q = await oracle.quote(1_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    const wire = JSON.parse(JSON.stringify(serialiseQuote(q))) as Record<string, string>;

    expect(BigInt(wire.baseAmount!)).toBe(q.baseAmount);
    expect(BigInt(wire.convertedAmount!)).toBe(q.convertedAmount);
    expect(BigInt(wire.expiresAt!)).toBe(q.expiresAt);
  });

  it('carries no invoice, merchant or payer', async () => {
    // A quote is about a rate. It must not become a tracking identifier.
    const oracle = new Oracle();
    const q = await oracle.quote(1_000n, TokenKind.NATIVE, TokenKind.MUSDC, NOW);
    const keys = Object.keys(serialiseQuote(q)).sort();
    expect(keys).toEqual(
      ['baseAmount', 'convertedAmount', 'expiresAt', 'fromToken', 'signature', 'toToken'].sort(),
    );
  });
});
