// Who may close or cancel an invoice.
//
// To settle, a payer must reproduce the invoice commitment, so the payment link
// necessarily carries the merchant key, the amount and the salt. Authorising
// close and cancel by the same reproduction would let anyone holding the link
// cancel or close the invoice. That was the behaviour until the ownership
// secret was introduced; these tests pin the fix.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, bytes32, type MaskPrivateState } from './mask-pay-simulator.js';

const OWNER = bytes32(0xee);
const NOT_OWNER = bytes32(0xef);

const base = (over: Partial<MaskPrivateState> = {}): MaskPrivateState => ({
  merchantKey: bytes32(0x11),
  salt: bytes32(0xaa),
  amount: 42_500n,
  payerKey: bytes32(0x33),
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

// A payer's view of the world: every term in the payment link, none of the
// merchant's private secrets.
const asLinkHolder = (s: MaskPaySimulator) => s.as({ payerKey: bytes32(0x99), ownerSecret: NOT_OWNER });

describe('authority over an invoice', () => {
  it('the merchant can cancel their own unpaid invoice', () => {
    const s = new MaskPaySimulator(base());
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    s.cancelInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);
    expect(s.ledger().invoices.lookup(c).status).toBe(2); // CANCELLED
  });

  it('a payer who holds the full payment link cannot cancel the invoice', () => {
    const s = new MaskPaySimulator(base());
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    asLinkHolder(s);
    expect(() => s.cancelInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).toThrow(
      'not the invoice owner',
    );
    expect(s.ledger().invoices.lookup(c).status).toBe(0); // still OPEN
  });

  it('a payer who holds the full payment link cannot close a multipay invoice', () => {
    const s = new MaskPaySimulator(base());
    const c = s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 0n);
    asLinkHolder(s);
    expect(() => s.closeInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE)).toThrow(
      'not the invoice owner',
    );
    expect(s.ledger().invoices.lookup(c).status).toBe(0);
  });

  it('the merchant can close their multipay invoice after others have paid', () => {
    const s = new MaskPaySimulator(base());
    const c = s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 0n);
    asLinkHolder(s);
    s.settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    s.as({ ownerSecret: OWNER });
    s.closeInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    expect(s.ledger().invoices.lookup(c).status).toBe(1); // SETTLED
  });

  it('the public record carries a tag for the owner secret, never the secret itself', () => {
    const s = new MaskPaySimulator(base());
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    const tag = s.ledger().invoices.lookup(c).owner;
    expect(tag).toHaveLength(32);
    expect(Buffer.from(tag).equals(Buffer.from(OWNER))).toBe(false);
  });

  it('two invoices with different owner secrets have unlinkable tags', () => {
    const a = new MaskPaySimulator(base());
    const b = new MaskPaySimulator(base({ ownerSecret: bytes32(0xe1), salt: bytes32(0xab) }));
    const ca = a.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    const cb = b.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    expect(Buffer.from(a.ledger().invoices.lookup(ca).owner).equals(
      Buffer.from(b.ledger().invoices.lookup(cb).owner),
    )).toBe(false);
  });
});
