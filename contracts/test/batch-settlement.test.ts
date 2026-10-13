// Batch settlement — four invoices under one proof.
//
// The property worth testing hardest is atomicity. A payroll run that pays
// three of four people is worse than one that pays nobody, because the
// operator now has to work out which. Every failure case below must leave the
// ledger exactly as it was.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, bytes32, type MaskPrivateState } from './mask-pay-simulator.js';

const MERCHANTS = [bytes32(0xa1), bytes32(0xa2), bytes32(0xa3), bytes32(0xa4)];
const SALTS = [bytes32(0xb1), bytes32(0xb2), bytes32(0xb3), bytes32(0xb4)];
const AMOUNTS = [1_000n, 2_000n, 3_000n, 4_000n];
const PAYER = bytes32(0x33);

const base = (over: Partial<MaskPrivateState> = {}): MaskPrivateState => ({
  merchantKey: MERCHANTS[0]!,
  salt: SALTS[0]!,
  amount: AMOUNTS[0]!,
  payerKey: PAYER,
  paymentIndex: 0n,
  ownerSecret: bytes32(0xee),
  convertedAmount: 0n,
  attestedAmounts: [],
  attestedSalts: [],
  attestedPayers: [],
  attestedIndices: [],
  attestedPaths: [],
  batchAmounts: AMOUNTS,
  batchSalts: SALTS,
  batchMerchants: MERCHANTS,
  batchIndices: [0n, 0n, 0n, 0n],
  ...over,
});

/** Four invoices from four different merchants, all open. */
function fourOpenInvoices(over: Partial<MaskPrivateState> = {}): MaskPaySimulator {
  const sim = new MaskPaySimulator(base(over));
  for (let i = 0; i < 4; i++) {
    sim
      .as({ merchantKey: MERCHANTS[i]!, salt: SALTS[i]!, amount: AMOUNTS[i]! })
      .createInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE, 0n);
  }
  return sim.as(base(over));
}

describe('batch settlement', () => {
  it('settles four invoices under one call', () => {
    const sim = fourOpenInvoices();
    const receipts = sim.settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(receipts).toHaveLength(4);
    expect(sim.ledger().spent.size()).toBe(4n);
    expect(sim.ledger().receipts.size()).toBe(4n);
    for (const r of receipts) expect(sim.receiptExists(r)).toBe(true);
  });

  it('produces four distinct receipts', () => {
    const sim = fourOpenInvoices();
    const receipts = sim.settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE);
    const hex = receipts.map((r) => Buffer.from(r).toString('hex'));
    expect(new Set(hex).size).toBe(4);
  });

  it('REFUSES a batch containing an unknown invoice', () => {
    const sim = fourOpenInvoices();
    expect(() =>
      sim
        .as({ batchSalts: [SALTS[0]!, SALTS[1]!, SALTS[2]!, bytes32(0xff)] })
        .settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow(/unknown invoice in batch/);
  });

  it('REFUSES a batch with a wrong amount', () => {
    const sim = fourOpenInvoices();
    expect(() =>
      sim
        .as({ batchAmounts: [AMOUNTS[0]!, AMOUNTS[1]!, AMOUNTS[2]!, 9_999n] })
        .settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow(/unknown invoice in batch/);
  });

  it('REFUSES the same invoice listed four times', () => {
    const sim = fourOpenInvoices();
    expect(() =>
      sim
        .as({
          batchAmounts: [AMOUNTS[0]!, AMOUNTS[0]!, AMOUNTS[0]!, AMOUNTS[0]!],
          batchSalts: [SALTS[0]!, SALTS[0]!, SALTS[0]!, SALTS[0]!],
          batchMerchants: [MERCHANTS[0]!, MERCHANTS[0]!, MERCHANTS[0]!, MERCHANTS[0]!],
        })
        .settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow();
  });

  it('REFUSES a batch containing an already-settled invoice', () => {
    const sim = fourOpenInvoices();
    // Settle the first one on its own.
    sim
      .as({ merchantKey: MERCHANTS[0]!, salt: SALTS[0]!, amount: AMOUNTS[0]! })
      .settleInvoice(InvoiceKind.STANDARD, TokenKind.NATIVE);

    expect(() => sim.as(base()).settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE)).toThrow(
      /not open/,
    );
  });

  it('is ATOMIC — a failing batch settles nothing', () => {
    // The property that makes batching safe. A bad fourth entry must not leave
    // the first three paid.
    const sim = fourOpenInvoices();
    const before = sim.ledger().spent.size();

    expect(() =>
      sim
        .as({ batchSalts: [SALTS[0]!, SALTS[1]!, SALTS[2]!, bytes32(0xff)] })
        .settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE),
    ).toThrow();

    expect(sim.ledger().spent.size()).toBe(before);
    expect(sim.ledger().receipts.size()).toBe(0n);
  });

  it('a settled batch cannot be replayed', () => {
    const sim = fourOpenInvoices();
    sim.settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE);
    expect(() => sim.settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE)).toThrow(/not open/);
  });

  it('publishes no amounts', () => {
    const sim = fourOpenInvoices();
    sim.settleBatch(InvoiceKind.STANDARD, TokenKind.NATIVE);

    const published = JSON.stringify(sim.ledger(), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (const a of AMOUNTS) {
      expect(published, `amount ${a} leaked`).not.toContain(a.toString());
    }
  });
});
