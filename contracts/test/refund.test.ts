// Refunds.
//
// A merchant returns a payment as a shielded coin in the same transaction. The
// cases that matter are the ones that lose money or privacy: refunding a payment
// that never happened, refunding twice, refunding the wrong amount or asset,
// and a payer refunding themselves with the payment link.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import {
  MaskPaySimulator,
  TEST_COLORS,
  bytes32,
  coin,
  type MaskPrivateState,
} from './mask-pay-simulator.js';

const AMOUNT = 867_530_912_345_678n;
const OWNER = bytes32(0xee);
const PAYER = bytes32(0x33);
const PAYER_ADDR = bytes32(0x77);
const MERCHANT_ADDR = bytes32(0x78);

const state = (over: Partial<MaskPrivateState> = {}): MaskPrivateState => ({
  merchantKey: bytes32(0x11),
  salt: bytes32(0xaa),
  amount: AMOUNT,
  payerKey: PAYER,
  paymentIndex: 0n,
  ownerSecret: OWNER,
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
  ...over,
});

/** An invoice that has been created and paid by PAYER in escrowed native coin. */
const paidInvoice = (token: unknown = TokenKind.NATIVE, color?: Uint8Array) => {
  const s = new MaskPaySimulator(state());
  s.createInvoice(InvoiceKind.STANDARD, token, 0n);
  s.settleShielded(InvoiceKind.STANDARD, token, coin(AMOUNT, color), MERCHANT_ADDR);
  return s;
};

describe('refund_payment', () => {
  it('the merchant refunds a real payment, once', () => {
    const s = paidInvoice();
    const tag = s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR);
    expect(tag).toHaveLength(32);
    expect(s.ledger().refunded.size()).toBe(1n);
    expect(s.ledger().refunded.member(tag)).toBe(true);
  });

  it('REFUSES a second refund of the same payment', () => {
    const s = paidInvoice();
    s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR);
    expect(() =>
      s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR),
    ).toThrow('payment already refunded');
    expect(s.ledger().refunded.size()).toBe(1n);
  });

  it('REFUSES a refund of a payment that never happened', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    expect(() =>
      s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR),
    ).toThrow('no such payment');
  });

  it('REFUSES a refund naming the wrong payer', () => {
    const s = paidInvoice();
    s.as({ payerKey: bytes32(0x99) });
    expect(() =>
      s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR),
    ).toThrow('no such payment');
  });

  it('REFUSES a payer who holds the payment link and no owner secret', () => {
    const s = paidInvoice();
    s.as({ ownerSecret: bytes32(0xef) });
    expect(() =>
      s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR),
    ).toThrow('not the invoice owner');
    expect(s.ledger().refunded.size()).toBe(0n);
  });

  it('REFUSES a coin worth less or more than the payment', () => {
    for (const wrong of [AMOUNT - 1n, AMOUNT + 1n]) {
      const s = paidInvoice();
      expect(() =>
        s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(wrong), PAYER_ADDR),
      ).toThrow('coin value does not match invoice');
      expect(s.ledger().refunded.size()).toBe(0n);
    }
  });

  it('REFUSES a coin of the wrong asset', () => {
    const s = paidInvoice(TokenKind.MUSDC, TEST_COLORS.musdc);
    expect(() =>
      s.refundPayment(InvoiceKind.STANDARD, TokenKind.MUSDC, coin(AMOUNT), PAYER_ADDR),
    ).toThrow("coin is not the invoice's asset");
  });

  it('refunds a reference-asset payment with the same asset', () => {
    const s = paidInvoice(TokenKind.MUSDC, TEST_COLORS.musdc);
    expect(() =>
      s.refundPayment(
        InvoiceKind.STANDARD,
        TokenKind.MUSDC,
        coin(AMOUNT, TEST_COLORS.musdc),
        PAYER_ADDR,
      ),
    ).not.toThrow();
  });

  it('refunds one contributor of a multipay invoice and leaves the others refundable', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 0n);
    for (const [key, idx] of [[bytes32(0x41), 0n], [bytes32(0x42), 0n]] as const) {
      s.as({ payerKey: key, paymentIndex: idx });
      s.settleShielded(InvoiceKind.MULTIPAY, TokenKind.NATIVE, coin(AMOUNT), MERCHANT_ADDR);
    }
    s.as({ payerKey: bytes32(0x41), paymentIndex: 0n });
    s.refundPayment(InvoiceKind.MULTIPAY, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR);
    s.as({ payerKey: bytes32(0x42), paymentIndex: 0n });
    s.refundPayment(InvoiceKind.MULTIPAY, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR);
    expect(s.ledger().refunded.size()).toBe(2n);
  });

  it('publishes neither the amount, the payer key, nor the payer address', () => {
    const s = paidInvoice();
    s.refundPayment(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(AMOUNT), PAYER_ADDR);
    const view = s.observerView();
    const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
    expect(view).not.toContain(AMOUNT.toString(10));
    expect(view).not.toContain(AMOUNT.toString(16).padStart(16, '0'));
    expect(view).not.toContain(hex(PAYER));
    expect(view).not.toContain(hex(OWNER));
    expect(view).not.toContain(hex(PAYER_ADDR));
    // Sighted: the refund tag it does publish is in the view.
    const [tag] = [...(s.ledger().refunded as unknown as Iterable<Uint8Array>)];
    expect(view).toContain(hex(tag!));
  });
});
