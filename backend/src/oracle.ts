// The conversion oracle.
//
// Signs a quote saying "at this moment, X of asset A is worth Y of asset B".
// The contract verifies that signature inside the circuit, so the rate is
// proven rather than trusted — but the oracle is still the party asserting what
// the rate *is*, and that trust is real. It is bounded in three ways:
//
//   1. The signing key is sealed into the contract at deployment and cannot be
//      changed afterwards, by anyone, including us.
//   2. Every quote carries an expiry, so a favourable rate cannot be hoarded.
//   3. The quote binds both amounts and both assets, so a signature for one
//      conversion cannot be replayed for another.
//
// What it does NOT do is see anyone's invoice. A quote is about a rate and an
// amount the payer already knows; the oracle never learns which invoice it is
// for, who is paying, or whether the payment happens.

import {
  CompactTypeUnsignedInteger,
  CompactTypeVector,
  transientHash,
} from '@midnight-ntwrk/compact-runtime';
import {
  generateOracleKeypair,
  sign,
  type OracleKeypair,
  type SchnorrSignature,
} from '../../contracts/src/oracle-signer.ts';

export const TokenKind = { NATIVE: 0, MUSDC: 1, MUSAD: 2 } as const;
export type TokenKindValue = (typeof TokenKind)[keyof typeof TokenKind];

const u64 = new CompactTypeUnsignedInteger(18446744073709551615n, 8);
const u8 = new CompactTypeUnsignedInteger(255n, 1);
const tokenPair = new CompactTypeVector(2, u8);

export interface Quote {
  baseAmount: bigint;
  convertedAmount: bigint;
  fromToken: TokenKindValue;
  toToken: TokenKindValue;
  expiresAt: bigint;
  signature: SchnorrSignature;
}

/**
 * Reproduce the contract's quote_digest exactly.
 *
 * transientHash returns a field element on both sides, so signer and verifier
 * agree without a Bytes-to-Field cast — which is what overflowed the prime
 * field in an earlier version.
 */
export function quoteDigest(
  baseAmount: bigint,
  convertedAmount: bigint,
  fromToken: number,
  toToken: number,
  expiresAt: bigint,
): bigint[] {
  return [
    transientHash(u64, baseAmount),
    transientHash(u64, convertedAmount),
    transientHash(tokenPair, [BigInt(fromToken), BigInt(toToken)]),
    expiresAt,
  ];
}

/** How long a quote stays valid. Short, because a rate goes stale. */
const DEFAULT_TTL_MS = 2 * 60 * 1000;

export interface RateSource {
  /** Units of `to` per unit of `from`, scaled by 1e6 to stay in integers. */
  rateMicros(from: TokenKindValue, to: TokenKindValue): Promise<bigint>;
}

/**
 * A fixed-rate source, for a devnet where the reference tokens have no market.
 *
 * A production deployment replaces this with a real feed. The interface is
 * deliberately one method so that swap is small.
 */
export class FixedRateSource implements RateSource {
  #rates: Map<string, bigint>;

  constructor(rates?: Map<string, bigint>) {
    this.#rates =
      rates ??
      new Map([
        // 1 tNIGHT = 2.15 mUSDC, and so on. Arbitrary but stable, so a demo
        // produces the same numbers twice.
        ['0-1', 2_150_000n],
        ['0-2', 2_140_000n],
        ['1-0', 465_116n],
        ['1-2', 995_000n],
        ['2-0', 467_289n],
        ['2-1', 1_005_025n],
      ]);
  }

  async rateMicros(from: TokenKindValue, to: TokenKindValue): Promise<bigint> {
    if (from === to) return 1_000_000n;
    const r = this.#rates.get(`${from}-${to}`);
    if (r === undefined) throw new Error(`No rate for ${from} -> ${to}.`);
    return r;
  }
}

export class Oracle {
  readonly #keypair: OracleKeypair;
  readonly #rates: RateSource;
  readonly #ttlMs: number;

  /** Quotes signed since start. Counts only — never the amounts. */
  readonly stats = { quotes: 0 };

  constructor(opts: { keypair?: OracleKeypair; rates?: RateSource; ttlMs?: number } = {}) {
    this.#keypair = opts.keypair ?? generateOracleKeypair();
    this.#rates = opts.rates ?? new FixedRateSource();
    this.#ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** The public key to seal into the contract at deployment. */
  publicKey(): { x: bigint; y: bigint } {
    return { x: this.#keypair.publicKey.x, y: this.#keypair.publicKey.y };
  }

  /**
   * Quote a conversion and sign it.
   *
   * `now` is injectable so tests are deterministic rather than racing a clock.
   */
  async quote(
    baseAmount: bigint,
    fromToken: TokenKindValue,
    toToken: TokenKindValue,
    now: number = Date.now(),
  ): Promise<Quote> {
    if (baseAmount <= 0n) throw new Error('baseAmount must be greater than zero.');

    const rate = await this.#rates.rateMicros(fromToken, toToken);
    const convertedAmount = (baseAmount * rate) / 1_000_000n;
    if (convertedAmount <= 0n) {
      throw new Error('That amount converts to zero at the current rate — too small to pay.');
    }

    // Seconds, not milliseconds: the contract compares this with the block's
    // secondsSinceEpoch, so a millisecond value would never expire.
    const expiresAt = BigInt(Math.floor((now + this.#ttlMs) / 1000));
    const signature = sign(
      this.#keypair,
      quoteDigest(baseAmount, convertedAmount, fromToken, toToken, expiresAt),
    );

    this.stats.quotes++;
    return { baseAmount, convertedAmount, fromToken, toToken, expiresAt, signature };
  }
}

/** Serialise a quote for transport. BigInts do not survive JSON on their own. */
export const serialiseQuote = (q: Quote): Record<string, unknown> => ({
  baseAmount: q.baseAmount.toString(),
  convertedAmount: q.convertedAmount.toString(),
  fromToken: q.fromToken,
  toToken: q.toToken,
  expiresAt: q.expiresAt.toString(),
  signature: {
    announcement: { x: q.signature.announcement.x.toString(), y: q.signature.announcement.y.toString() },
    response: q.signature.response.toString(),
  },
});
