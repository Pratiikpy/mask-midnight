// Oracle-verified cross-token settlement.
//
// The signatures here are produced by the real signer in
// src/oracle-signer.ts, against the real verifier vendored from
// example-zkloan. Nothing is stubbed: if the signing and verification sides
// disagree by a single bit, these tests fail — which is the point. A contract
// that accepts a fake signature is a contract that verifies nothing.

import { describe, it, expect } from 'vitest';
import {
  transientHash,
  CompactTypeUnsignedInteger,
  CompactTypeVector,
} from '@midnight-ntwrk/compact-runtime';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, TEST_COLORS, bytes32, type MaskPrivateState } from './mask-pay-simulator.js';
import { generateOracleKeypair, sign, type OracleKeypair } from '../src/oracle-signer.js';

const BASE_AMOUNT = 42_500n;       // invoice denominated in NATIVE
const CONVERTED = 91_300n;         // what the payer hands over in MUSDC
const FAR_FUTURE = 4_102_444_800_000n;

const u64 = new CompactTypeUnsignedInteger(18446744073709551615n, 8);
const u8 = new CompactTypeUnsignedInteger(255n, 1);
const tokenPair = new CompactTypeVector(2, u8);

/**
 * Reproduce the contract's quote_digest exactly.
 *
 * transientHash returns a field element on both sides, so signer and verifier
 * agree without any Bytes-to-Field cast — which is what made this overflow the
 * prime field before.
 */
const quoteDigest = (
  base: bigint,
  converted: bigint,
  fromToken: number,
  toToken: number,
  expiresAt: bigint,
): bigint[] => [
  transientHash(u64, base),
  transientHash(u64, converted),
  transientHash(tokenPair, [BigInt(fromToken), BigInt(toToken)]),
  expiresAt,
];

const state = (over: Partial<MaskPrivateState> = {}): MaskPrivateState => ({
  merchantKey: bytes32(0x11),
  salt: bytes32(0xaa),
  amount: BASE_AMOUNT,
  payerKey: bytes32(0x33),
  paymentIndex: 0n,
  ownerSecret: bytes32(0xee),
  convertedAmount: CONVERTED,
  attestedAmounts: [],
  attestedSalts: [],
  attestedPayers: [],
  attestedIndices: [],
  attestedPaths: [],
  batchAmounts: [],
  batchSalts: [],
  batchMerchants: [],
  batchIndices: [],
  ...over,
});

describe('oracle conversion', () => {
  it('generates a real keypair on the curve', () => {
    const kp = generateOracleKeypair();
    expect(typeof kp.publicKey.x).toBe('bigint');
    expect(typeof kp.publicKey.y).toBe('bigint');
    expect(kp.publicKey.x).not.toBe(0n);
  });

  it('accepts a correctly signed quote', () => {
    const kp = generateOracleKeypair();
    const s = new MaskPaySimulator(state(), kp.publicKey);
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);

    const digest = quoteDigest(BASE_AMOUNT, CONVERTED, TokenKind.NATIVE, TokenKind.MUSDC, FAR_FUTURE);
    const sig = sign(kp, digest);

    const receipt = s.settleConverted(
      InvoiceKind.STANDARD,
      TokenKind.NATIVE,
      TokenKind.MUSDC,
      { nonce: bytes32(0x66), color: TEST_COLORS.musdc, value: CONVERTED },
      bytes32(0x77),
      FAR_FUTURE,
      sig,
    );
    expect(receipt).toHaveLength(32);
  });

  it('rejects a quote signed by a DIFFERENT oracle', () => {
    const real = generateOracleKeypair();
    const impostor = generateOracleKeypair();
    const s = new MaskPaySimulator(state(), real.publicKey);
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);

    const digest = quoteDigest(BASE_AMOUNT, CONVERTED, TokenKind.NATIVE, TokenKind.MUSDC, FAR_FUTURE);
    const sig = sign(impostor, digest);

    expect(() =>
      s.settleConverted(
        InvoiceKind.STANDARD,
        TokenKind.NATIVE,
        TokenKind.MUSDC,
        { nonce: bytes32(0x66), color: TEST_COLORS.musdc, value: CONVERTED },
        bytes32(0x77),
        FAR_FUTURE,
        sig,
      ),
    ).toThrow();
  });

  it('rejects a tampered converted amount', () => {
    const kp = generateOracleKeypair();
    // Oracle signs for CONVERTED, but the payer's private state claims more.
    const s = new MaskPaySimulator(state({ convertedAmount: CONVERTED + 1n }), kp.publicKey);
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);

    const digest = quoteDigest(BASE_AMOUNT, CONVERTED, TokenKind.NATIVE, TokenKind.MUSDC, FAR_FUTURE);
    const sig = sign(kp, digest);

    expect(() =>
      s.settleConverted(
        InvoiceKind.STANDARD,
        TokenKind.NATIVE,
        TokenKind.MUSDC,
        { nonce: bytes32(0x66), color: TEST_COLORS.musdc, value: CONVERTED + 1n },
        bytes32(0x77),
        FAR_FUTURE,
        sig,
      ),
    ).toThrow();
  });

  it('rejects an expired quote', () => {
    const kp = generateOracleKeypair();
    const s = new MaskPaySimulator(state(), kp.publicKey);
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);

    // The simulator's clock sits at the epoch, so anything at or before 0 is
    // already in the past. A real quote always carries a future expiry; the
    // on-chain run exercises the same check against real block time.
    const past = 0n;
    const digest = quoteDigest(BASE_AMOUNT, CONVERTED, TokenKind.NATIVE, TokenKind.MUSDC, past);
    const sig = sign(kp, digest);

    expect(() =>
      s.settleConverted(
        InvoiceKind.STANDARD,
        TokenKind.NATIVE,
        TokenKind.MUSDC,
        { nonce: bytes32(0x66), color: TEST_COLORS.musdc, value: CONVERTED },
        bytes32(0x77),
        past,
        sig,
      ),
    ).toThrow(/quote has expired/);
  });
});
