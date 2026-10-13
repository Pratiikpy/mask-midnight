// Expiry, and the unit it is measured in.
//
// `expires_at` is compared with the block's `secondsSinceEpoch`. Seconds, not
// milliseconds: an expiry written as `Date.now() + hours * 3_600_000` is a date
// roughly 54,000 years away and the invoice never expires. These tests pin the
// unit down from both sides — a value in seconds expires on time, the same
// instant written in milliseconds does not — so a client that gets the unit
// wrong fails here rather than in production.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, bytes32, type MaskPrivateState } from './mask-pay-simulator.js';

const NOW = 1_800_000_000n; // seconds since the epoch, October 2027
const HOUR = 3_600n;

const base = (over: Partial<MaskPrivateState> = {}): MaskPrivateState => ({
  merchantKey: bytes32(0x11),
  salt: bytes32(0xaa),
  amount: 42_500n,
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
  ...over,
});

const at = (t: bigint) => new MaskPaySimulator(base()).atBlockTime(t);

describe('invoice expiry', () => {
  it('settles before the expiry', () => {
    const s = at(NOW);
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NOW + HOUR);
    s.atBlockTime(NOW + HOUR - 1n);
    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).not.toThrow();
  });

  it('refuses settlement once the expiry has passed', () => {
    const s = at(NOW);
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, NOW + HOUR);
    s.atBlockTime(NOW + HOUR + 1n);
    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).toThrow(
      'invoice has expired',
    );
  });

  it('an expiry of zero never expires', () => {
    const s = at(NOW);
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
    s.atBlockTime(NOW * 40n);
    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).not.toThrow();
  });

  it('a one-hour expiry written in milliseconds does NOT expire (why clients must use seconds)', () => {
    const s = at(NOW);
    const asMilliseconds = NOW * 1_000n + HOUR * 1_000n;
    s.createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, asMilliseconds);
    s.atBlockTime(NOW + 30n * 24n * HOUR); // a month later
    expect(() => s.settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE)).not.toThrow();
  });

  it('refuses a multipay contribution after expiry too', () => {
    const s = at(NOW);
    s.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, NOW + HOUR);
    s.atBlockTime(NOW + 10n);
    s.as({ payerKey: bytes32(0x44), paymentIndex: 0n });
    expect(() => s.settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE)).not.toThrow();
    s.atBlockTime(NOW + 2n * HOUR);
    s.as({ payerKey: bytes32(0x55), paymentIndex: 0n });
    expect(() => s.settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE)).toThrow(
      'invoice has expired',
    );
  });
});
