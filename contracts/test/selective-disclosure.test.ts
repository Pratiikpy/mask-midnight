// Selective disclosure — the capability that justifies Midnight for Mask.
//
// A merchant proves a statement about their revenue that a third party can
// verify against the chain, without the revenue, the individual amounts, or
// which payments were counted ever becoming visible.
//
// Tested adversarially, because an attestation nobody can forge is the whole
// point. The forgery test here is not decorative: an earlier version of the
// contract failed it. Merkle paths were checked against the tree but never
// bound to the claimed payment, and the amounts were free witnesses — so any
// revenue could be attested to. Receipts are now derived from the amounts, and
// each path is bound to the receipt it proves.

import { describe, it, expect } from 'vitest';
import { InvoiceKind, TokenKind } from '../build/mask_pay/contract/index.js';
import { MaskPaySimulator, bytes32, type MaskPrivateState } from './mask-pay-simulator.js';

const MERCHANT = bytes32(0x11);
const SALT = bytes32(0xaa);
// Six bytes wide so that searching for it in hash-heavy output is decisive.
const AMOUNT = 867_530_912_345_678n;
const PAYERS = [bytes32(0x31), bytes32(0x32), bytes32(0x33), bytes32(0x34)];
const TOTAL = AMOUNT * 4n;

const state = (over: Partial<MaskPrivateState> = {}): MaskPrivateState => ({
  merchantKey: MERCHANT,
  salt: SALT,
  amount: AMOUNT,
  payerKey: PAYERS[0]!,
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


/** One multipay invoice settled by four payers — four real on-chain receipts. */
function merchantWithFourPayments(): { sim: MaskPaySimulator; receipts: Uint8Array[] } {
  const sim = new MaskPaySimulator(state());
  sim.createInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 0n);
  const receipts = PAYERS.map((p) =>
    sim.as({ payerKey: p }).settleInvoice(InvoiceKind.MULTIPAY, TokenKind.NATIVE),
  );
  return { sim, receipts };
}

/** Load the merchant's private state with truthful evidence. */
function withTruth(sim: MaskPaySimulator, receipts: Uint8Array[]): MaskPaySimulator {
  return sim.as({
    merchantKey: MERCHANT,
    attestedAmounts: [AMOUNT, AMOUNT, AMOUNT, AMOUNT],
    attestedSalts: [SALT, SALT, SALT, SALT],
    attestedPayers: PAYERS,
    attestedIndices: [0n, 0n, 0n, 0n],
    attestedPaths: receipts.map((r) => sim.pathFor(r)),
  });
}

describe('revenue attestation', () => {
  it('four settlements produce four receipts on the Merkle tree', () => {
    const { sim, receipts } = merchantWithFourPayments();
    expect(receipts).toHaveLength(4);
    expect(sim.ledger().receipts.size()).toBe(4n);
    for (const r of receipts) expect(() => sim.pathFor(r)).not.toThrow();
  });

  it('proves revenue is at least the true total', () => {
    const { sim, receipts } = merchantWithFourPayments();
    const digest = withTruth(sim, receipts).attestRevenueAtLeast(
      InvoiceKind.MULTIPAY,
      TokenKind.NATIVE,
      TOTAL,
    );
    expect(digest).toHaveLength(32);
    expect(sim.attestationExists(digest)).toBe(true);
  });

  it('proves a threshold below the true total', () => {
    const { sim, receipts } = merchantWithFourPayments();
    const digest = withTruth(sim, receipts).attestRevenueAtLeast(
      InvoiceKind.MULTIPAY,
      TokenKind.NATIVE,
      50_000n,
    );
    expect(sim.attestationExists(digest)).toBe(true);
  });

  it('REFUSES to prove a threshold above the true total', () => {
    const { sim, receipts } = merchantWithFourPayments();
    expect(() =>
      withTruth(sim, receipts).attestRevenueAtLeast(
        InvoiceKind.MULTIPAY,
        TokenKind.NATIVE,
        TOTAL + 1n,
      ),
    ).toThrow(/revenue below threshold/);
  });

  it('REFUSES an inflated amount backed by a real payment', () => {
    // The forgery that broke the first design: keep the real payments and
    // real paths, but claim each was worth far more. Deriving the receipt from
    // the amount means the derived receipt no longer matches the path's leaf.
    const { sim, receipts } = merchantWithFourPayments();
    expect(() =>
      sim
        .as({
          merchantKey: MERCHANT,
          attestedAmounts: [9_000_000n, 9_000_000n, 9_000_000n, 9_000_000n],
          attestedSalts: [SALT, SALT, SALT, SALT],
          attestedPayers: PAYERS,
          attestedIndices: [0n, 0n, 0n, 0n],
          attestedPaths: receipts.map((r) => sim.pathFor(r)),
        })
        .attestRevenueAtLeast(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 36_000_000n),
    ).toThrow(/merkle path does not match/);
  });

  it('REFUSES payments that were never made', () => {
    // Entirely invented payers, with paths borrowed from real payments.
    const { sim, receipts } = merchantWithFourPayments();
    expect(() =>
      sim
        .as({
          merchantKey: MERCHANT,
          attestedAmounts: [AMOUNT, AMOUNT, AMOUNT, AMOUNT],
          attestedSalts: [SALT, SALT, SALT, SALT],
          attestedPayers: [bytes32(0xd1), bytes32(0xd2), bytes32(0xd3), bytes32(0xd4)],
          attestedIndices: [0n, 0n, 0n, 0n],
          attestedPaths: receipts.map((r) => sim.pathFor(r)),
        })
        .attestRevenueAtLeast(InvoiceKind.MULTIPAY, TokenKind.NATIVE, TOTAL),
    ).toThrow(/merkle path does not match/);
  });

  it('REFUSES counting one payment four times', () => {
    const { sim, receipts } = merchantWithFourPayments();
    const onePath = sim.pathFor(receipts[0]!);
    expect(() =>
      sim
        .as({
          merchantKey: MERCHANT,
          attestedAmounts: [AMOUNT, AMOUNT, AMOUNT, AMOUNT],
          attestedSalts: [SALT, SALT, SALT, SALT],
          attestedPayers: [PAYERS[0]!, PAYERS[0]!, PAYERS[0]!, PAYERS[0]!],
          attestedIndices: [0n, 0n, 0n, 0n],
          attestedPaths: [onePath, onePath, onePath, onePath],
        })
        .attestRevenueAtLeast(InvoiceKind.MULTIPAY, TokenKind.NATIVE, TOTAL),
    ).toThrow(/must be distinct/);
  });

  it('REFUSES an attestation by someone who is not the merchant', () => {
    const { sim, receipts } = merchantWithFourPayments();
    expect(() =>
      sim
        .as({
          merchantKey: bytes32(0x99),
          attestedAmounts: [AMOUNT, AMOUNT, AMOUNT, AMOUNT],
          attestedSalts: [SALT, SALT, SALT, SALT],
          attestedPayers: PAYERS,
          attestedIndices: [0n, 0n, 0n, 0n],
          attestedPaths: receipts.map((r) => sim.pathFor(r)),
        })
        .attestRevenueAtLeast(InvoiceKind.MULTIPAY, TokenKind.NATIVE, TOTAL),
    ).toThrow(/merkle path does not match/);
  });

  it('REFUSES to publish the same attestation twice', () => {
    const { sim, receipts } = merchantWithFourPayments();
    withTruth(sim, receipts).attestRevenueAtLeast(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 80_000n);
    expect(() =>
      withTruth(sim, receipts).attestRevenueAtLeast(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 80_000n),
    ).toThrow(/already published/);
  });

  it('publishes the threshold but NOT the actual revenue', () => {
    const { sim, receipts } = merchantWithFourPayments();
    withTruth(sim, receipts).attestRevenueAtLeast(InvoiceKind.MULTIPAY, TokenKind.NATIVE, 60_000n);

    // The observer's view: every call's public transcript and every ledger
    // collection. It must contain the attestation (so the search can see) and
    // neither the total nor any single amount.
    const view = sim.observerView();
    const digest = sim.ledgerAttestationDigests()[0]!;
    expect(view).toContain(Buffer.from(digest).toString('hex'));
    for (const n of [TOTAL, AMOUNT]) {
      expect(view).not.toContain(n.toString(10));
      expect(view).not.toContain(n.toString(16).padStart(16, '0'));
    }
  });

  it('an attestation that was never made does not verify', () => {
    const { sim } = merchantWithFourPayments();
    expect(sim.attestationExists(bytes32(0xff))).toBe(false);
  });
});
