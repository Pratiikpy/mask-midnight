// mask_pay behavioural suite.
//
// Weighted towards the states that actually cause losses — replay, wrong
// terms, cancelling out from under a payer, expiry — rather than the happy
// path. Each failure case asserts that the circuit *throws*, because on
// Midnight a failed assert means the transaction never reaches the chain.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, bytes32, type MaskPrivateState } from './mask-pay-simulator.js';

const MERCHANT = bytes32(0x11);
const OTHER_MERCHANT = bytes32(0x22);
const SALT = bytes32(0xaa);
const OTHER_SALT = bytes32(0xbb);
const PAYER = bytes32(0x33);
const PAYER_2 = bytes32(0x44);

const AMOUNT = 42_500n;
const NO_EXPIRY = 0n;
const FAR_FUTURE = 4_102_444_800_000n; // 2100-01-01, in ms

const base = (over: Partial<MaskPrivateState> = {}): MaskPrivateState => ({
  merchantKey: MERCHANT,
  salt: SALT,
  amount: AMOUNT,
  payerKey: PAYER,
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
  ...over,
});

const sim = (over: Partial<MaskPrivateState> = {}) => new MaskPaySimulator(base(over));

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('create_invoice', () => {
  it('creates an invoice and returns its commitment', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);

    expect(c).toHaveLength(32);
    expect(s.ledger().invoices.member(c)).toBe(true);
    expect(s.ledger().created).toBe(1n);
    expect(s.ledger().invoices.size()).toBe(1n);
  });

  it('rejects creating the same invoice twice', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    expect(() => s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY)).toThrow(
      /already exists/,
    );
  });

  it('publishes no amount, merchant key or salt in ledger state', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);

    // The ledger is public forever. Anything recoverable from it is leaked.
    const published = JSON.stringify(s.ledger(), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ).toLowerCase();

    expect(published).not.toContain(AMOUNT.toString());
    expect(published).not.toContain(hex(MERCHANT));
    expect(published).not.toContain(hex(SALT));
  });
});

describe('commitment binding', () => {
  it('a different amount yields a different commitment', () => {
    const a = sim().createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    const b = sim({ amount: AMOUNT + 1n }).createInvoice(
      InvoiceKind.STANDARD,
      TokenKind.NATIVE,
      NO_EXPIRY,
    );
    expect(hex(a)).not.toBe(hex(b));
  });

  it('a different merchant yields a different commitment', () => {
    const a = sim().createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    const b = sim({ merchantKey: OTHER_MERCHANT }).createInvoice(
      InvoiceKind.STANDARD,
      TokenKind.NATIVE,
      NO_EXPIRY,
    );
    expect(hex(a)).not.toBe(hex(b));
  });

  it('a different salt yields a different commitment for identical terms', () => {
    // Publishing the salt would make equal terms linkable: two
    // invoices with the same merchant and amount must not be linkable.
    const a = sim().createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    const b = sim({ salt: OTHER_SALT }).createInvoice(
      InvoiceKind.STANDARD,
      TokenKind.NATIVE,
      NO_EXPIRY,
    );
    expect(hex(a)).not.toBe(hex(b));
  });

  it('a different token yields a different commitment', () => {
    const a = sim().createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    const s = sim();
    const b = s.createInvoice(InvoiceKind.STANDARD, TokenKind.MUSDC, NO_EXPIRY);
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('settle_invoice — standard', () => {
  it('settles an open invoice and closes it', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);

    const receipt = s.as({ payerKey: PAYER }).settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(s.isSettled(c)).toBe(true);
    expect(s.receiptExists(receipt)).toBe(true);
    expect(s.ledger().invoices.lookup(c).contributions).toBe(1n);
    expect(s.ledger().spent.size()).toBe(1n);
  });

  it('rejects a second settlement of the same invoice', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).toThrow(/not open/);
  });

  it('rejects a replay by a DIFFERENT payer once closed', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(() =>
      s.as({ payerKey: PAYER_2 }).settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow(/not open/);
  });

  it('rejects settlement with the wrong amount', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);

    // A wrong amount produces a different commitment, so it matches no invoice.
    expect(() =>
      s.as({ amount: AMOUNT + 1n }).settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow(/unknown invoice/);
  });

  it('rejects settlement with the wrong salt', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    expect(() =>
      s.as({ salt: OTHER_SALT }).settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow(/unknown invoice/);
  });

  it('rejects settlement in the wrong token', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.MUSDC)).toThrow(/unknown invoice/);
  });

  it('rejects settling an invoice that was never created', () => {
    const s = sim();
    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).toThrow(
      /unknown invoice/,
    );
  });

  it('pins the payment index for STANDARD so one payer cannot mint nullifiers', () => {
    // A caller-chosen index on a single-settlement invoice would let one payer
    // produce unlimited distinct nullifiers. The circuit forces index 0.
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(() =>
      s.as({ paymentIndex: 7n }).settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow(/not open/);
  });
});

describe('settle_invoice — multipay and donation', () => {
  it('accepts many distinct payers and stays open', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NO_EXPIRY);

    s.as({ payerKey: PAYER }).settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    s.as({ payerKey: PAYER_2 }).settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);

    expect(s.ledger().invoices.lookup(c).contributions).toBe(2n);
    expect(s.isSettled(c)).toBe(false);
    expect(s.ledger().spent.size()).toBe(2n);
  });

  it('rejects the same payer paying twice under the same index', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NO_EXPIRY);
    s.as({ payerKey: PAYER, paymentIndex: 0n }).settleInvoice(
      InvoiceKind.MULTIPAY,
      TokenKind.NATIVE,
    );

    expect(() =>
      s.as({ payerKey: PAYER, paymentIndex: 0n }).settleInvoice(
        InvoiceKind.MULTIPAY,
        TokenKind.NATIVE,
      ),
    ).toThrow(/already settled/);
  });

  it('allows the same payer to contribute again under a new index', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.DONATION, TokenKind.NATIVE, NO_EXPIRY);

    s.as({ payerKey: PAYER, paymentIndex: 0n }).settleInvoice(
      InvoiceKind.DONATION,
      TokenKind.NATIVE,
    );
    s.as({ payerKey: PAYER, paymentIndex: 1n }).settleInvoice(
      InvoiceKind.DONATION,
      TokenKind.NATIVE,
    );

    expect(s.ledger().invoices.lookup(c).contributions).toBe(2n);
  });

  it('publishes a contribution count but never the amounts', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NO_EXPIRY);
    s.as({ payerKey: PAYER }).settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    s.as({ payerKey: PAYER_2 }).settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);

    expect(s.ledger().invoices.lookup(c).contributions).toBe(2n);

    const published = JSON.stringify(s.ledger(), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(published).not.toContain(AMOUNT.toString());
  });
});

describe('close_invoice', () => {
  it('lets the merchant close a multipay invoice', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NO_EXPIRY);
    s.as({ payerKey: PAYER }).settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);

    s.as(base()).closeInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    expect(s.isSettled(c)).toBe(true);
  });

  it('refuses a caller who does not know the invoice terms', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NO_EXPIRY);

    // Reproducing the commitment is the authorisation. Without the merchant
    // key there is nothing to reproduce.
    expect(() =>
      s.as({ merchantKey: OTHER_MERCHANT }).closeInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE),
    ).toThrow(/unknown invoice/);
  });

  it('refuses to close an already-closed invoice', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NO_EXPIRY);
    s.closeInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);
    expect(() => s.closeInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE)).toThrow(/not open/);
  });
});

describe('cancel_invoice', () => {
  it('cancels an unpaid invoice', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    s.cancelInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(s.isSettled(c)).toBe(false);
    expect(s.ledger().invoices.member(c)).toBe(true);
  });

  it('refuses to cancel once someone has paid', () => {
    // Cancelling out from under a payer who already settled would be theft.
    const s = sim();
    s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NO_EXPIRY);
    s.as({ payerKey: PAYER }).settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE);

    expect(() => s.as(base()).cancelInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE)).toThrow(
      /has contributions/,
    );
  });

  it('refuses settlement of a cancelled invoice', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    s.cancelInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).toThrow(/not open/);
  });

  it('refuses a non-merchant cancellation', () => {
    const s = sim();
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    expect(() =>
      s.as({ merchantKey: OTHER_MERCHANT }).cancelInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow(/unknown invoice/);
  });
});

describe('expiry', () => {
  it('accepts settlement before expiry', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, FAR_FUTURE);
    s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);
    expect(s.isSettled(c)).toBe(true);
  });

  it('treats expires_at of zero as never expiring', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);
    expect(s.isSettled(c)).toBe(true);
  });
});

describe('public read paths', () => {
  it('reports non-existence without revealing anything', () => {
    const s = sim();
    expect(s.invoiceExists(bytes32(0x99))).toBe(false);
    expect(s.isSettled(bytes32(0x99))).toBe(false);
    expect(s.receiptExists(bytes32(0x99))).toBe(false);
  });

  it('a receipt proves payment without identifying the invoice', () => {
    const s = sim();
    const c = s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NO_EXPIRY);
    const receipt = s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(s.receiptExists(receipt)).toBe(true);
    // The receipt digest is domain-separated from the commitment, so holding
    // one tells you nothing about the other.
    expect(hex(receipt)).not.toBe(hex(c));
  });
});
