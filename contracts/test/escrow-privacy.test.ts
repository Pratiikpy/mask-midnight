// The escrow path: does moving real value leak the amount?
//
// settle_invoice_shielded is the only circuit where the compiler forced
// disclose() on the amount, because sendShielded requires it. That makes this
// the one place the product's core claim could break, so it is tested directly
// rather than assumed to behave like the non-escrow path.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, NATIVE_COLOR, TEST_COLORS, bytes32, coin, type MaskPrivateState } from './mask-pay-simulator.js';

const AMOUNT = 42_500n;
const MERCHANT_ADDR = bytes32(0x77);

const state = (): MaskPrivateState => ({
  merchantKey: bytes32(0x11),
  salt: bytes32(0xaa),
  amount: AMOUNT,
  payerKey: bytes32(0x33),
  paymentIndex: 0n,
  ownerSecret: bytes32(0xee),
  convertedAmount: 0n,
  attestedAmounts: [],
  attestedSalts: [],
  attestedPayers: [],
  attestedIndices: [],
  attestedPaths: [],
  batchAmounts: [],
  batchSalts: [],
  batchMerchants: [],
  batchIndices: [],
});


describe('escrowed settlement', () => {
  it('rejects a coin worth less than the invoice', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);

    expect(() =>
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT - 1n), MERCHANT_ADDR),
    ).toThrow(/does not match/);
  });

  it('rejects a coin worth more than the invoice', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);

    expect(() =>
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT + 1n), MERCHANT_ADDR),
    ).toThrow(/does not match/);
  });

  it('accepts an exact coin and settles', () => {
    const s = new MaskPaySimulator(state());
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    s.settleShielded(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), MERCHANT_ADDR);
    expect(s.isSettled(c)).toBe(true);
  });
});

describe('the asset, not just the amount', () => {
  // Found by reading the circuit rather than by a failing test: settlement
  // checked `coin.value` and never `coin.color`. A coin worth 100 of anything
  // settled a 100-unit invoice, so a mUSDC invoice could be paid in tNIGHT and
  // a conversion could be paid in an asset the quote never priced.
  //
  // The colours of the two reference assets are now sealed into the contract at
  // deployment, and settlement checks the coin against the invoice's asset.

  const openInvoice = (token: unknown) => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, token, 0n);
    return s;
  };

  it('REFUSES a native coin for a mUSDC invoice', () => {
    const s = openInvoice(TokenKind.MUSDC);
    expect(() =>
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.MUSDC, coin(AMOUNT, NATIVE_COLOR), MERCHANT_ADDR),
    ).toThrow(/not the invoice's asset/);
  });

  it('REFUSES a mUSAD coin for a mUSDC invoice', () => {
    const s = openInvoice(TokenKind.MUSDC);
    expect(() =>
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.MUSDC, coin(AMOUNT, TEST_COLORS.musad), MERCHANT_ADDR),
    ).toThrow(/not the invoice's asset/);
  });

  it('REFUSES a mUSDC coin for a native invoice', () => {
    const s = openInvoice(TokenKind.NATIVE);
    expect(() =>
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT, TEST_COLORS.musdc), MERCHANT_ADDR),
    ).toThrow(/not the invoice's asset/);
  });

  it('REFUSES an arbitrary unknown asset', () => {
    const s = openInvoice(TokenKind.NATIVE);
    expect(() =>
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT, bytes32(0x99)), MERCHANT_ADDR),
    ).toThrow(/not the invoice's asset/);
  });

  it('accepts the right asset for a mUSDC invoice', () => {
    const s = openInvoice(TokenKind.MUSDC);
    const receipt = s.settleShielded(
      InvoiceKind.STANDARD,
      TokenKind.MUSDC,
      coin(AMOUNT, TEST_COLORS.musdc),
      MERCHANT_ADDR,
    );
    expect(receipt).toHaveLength(32);
  });

  it('still accepts a native coin for a native invoice', () => {
    const s = openInvoice(TokenKind.NATIVE);
    expect(
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), MERCHANT_ADDR),
    ).toHaveLength(32);
  });

  it('rejects the wrong asset even when the value is exactly right', () => {
    // The point of the test: value alone was never payment.
    const s = openInvoice(TokenKind.MUSDC);
    const wrong = coin(AMOUNT, NATIVE_COLOR);
    expect(wrong.value).toBe(AMOUNT);
    expect(() =>
      s.settleShielded(InvoiceKind.STANDARD, TokenKind.MUSDC, wrong, MERCHANT_ADDR),
    ).toThrow(/asset/);
  });
});
