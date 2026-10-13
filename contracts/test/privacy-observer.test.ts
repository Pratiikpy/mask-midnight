// What a chain observer can and cannot read.
//
// Every check here searches `observerView()`: the public transcript of each
// call plus the ledger's collections, dumped entry by entry. The search is
// proven sighted before anything is claimed absent. A privacy test that cannot
// find a value it is supposed to find proves nothing, and an earlier version of
// this suite searched a string that was always empty.
//
// The private values are six bytes wide on purpose. A realistic amount such as
// 42,500 encodes to two bytes, which occur by chance many times in a kilobyte of
// hash hex, so a small value cannot be decided either way. A large canary can.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, bytes32, coin, type MaskPrivateState } from './mask-pay-simulator.js';

const SECRET_AMOUNT = 867_530_912_345_678n; // private, must never be found
const PUBLIC_EXPIRY = 1_900_000_000_999n; // public by design, must be found

const state = (): MaskPrivateState => ({
  merchantKey: bytes32(0x11),
  salt: bytes32(0xaa),
  amount: SECRET_AMOUNT,
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

/** Every encoding a number could take in serialised ledger data. */
const encodings = (v: bigint): string[] => {
  let hex = v.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const le = (hex.match(/../g) ?? []).reverse().join('');
  const out = [v.toString(10), hex, le];
  for (const w of [8, 16, 32]) {
    out.push(hex.padStart(w * 2, '0'));
    out.push(le.padEnd(w * 2, '0'));
  }
  return out;
};

const found = (haystack: string, v: bigint) => encodings(v).filter((e) => haystack.includes(e));
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('the search can see', () => {
  it('finds a value that is public by design', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, PUBLIC_EXPIRY);
    expect(found(s.observerView(), PUBLIC_EXPIRY).length).toBeGreaterThan(0);
  });

  it('finds the commitment, which the contract publishes', () => {
    const s = new MaskPaySimulator(state());
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    expect(s.observerView()).toContain(hexOf(c));
  });

  it('would find the secret amount if it were published', () => {
    // A control: the same search over a string that really does contain it.
    const planted = `${new MaskPaySimulator(state()).observerView()} ${SECRET_AMOUNT.toString(10)}`;
    expect(found(planted, SECRET_AMOUNT).length).toBeGreaterThan(0);
  });
});

describe('what stays private', () => {
  const secretsAbsent = (view: string, label: string) => {
    expect(found(view, SECRET_AMOUNT), `${label}: amount found`).toEqual([]);
    expect(view, `${label}: salt found`).not.toContain(hexOf(bytes32(0xaa)));
    expect(view, `${label}: merchant key found`).not.toContain(hexOf(bytes32(0x11)));
    expect(view, `${label}: owner secret found`).not.toContain(hexOf(bytes32(0xee)));
  };

  it('create_invoice', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, PUBLIC_EXPIRY);
    secretsAbsent(s.observerView(), 'create');
  });

  it('settle_invoice', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, PUBLIC_EXPIRY);
    s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);
    const view = s.observerView();
    secretsAbsent(view, 'settle');
    expect(view).not.toContain(hexOf(bytes32(0x33))); // payer key
  });

  it('settle_invoice_shielded moves a coin worth the secret amount without publishing it', () => {
    const s = new MaskPaySimulator(state());
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, PUBLIC_EXPIRY);
    s.settleShielded(InvoiceKind.STANDARD, TokenKind.NATIVE, coin(SECRET_AMOUNT), bytes32(0x77));
    secretsAbsent(s.observerView(), 'escrow');
  });

  it('close_invoice and cancel_invoice', () => {
    const m = new MaskPaySimulator(state());
    m.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 0n);
    m.settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    m.closeInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    secretsAbsent(m.observerView(), 'close');

    const c = new MaskPaySimulator(state());
    c.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    c.cancelInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);
    secretsAbsent(c.observerView(), 'cancel');
  });
});

describe('what an observer CAN link', () => {
  // Measured, and reported as a limitation rather than argued away: one
  // settlement is one transaction, so the invoice commitment it touches and the
  // receipt it publishes sit in the same public transcript.
  it('a settlement transcript carries both the invoice commitment and the receipt', () => {
    const s = new MaskPaySimulator(state());
    const commitment = hexOf(s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n));
    const receipt = hexOf(s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE));
    const settleTranscript = s.transcripts[s.transcripts.length - 1]!;
    expect(settleTranscript).toContain(commitment);
    expect(settleTranscript).toContain(receipt);
  });
});
