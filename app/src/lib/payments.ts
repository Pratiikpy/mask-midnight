// What this device has paid.
//
// The payer's side of the vault. A payment leaves a receipt on the ledger and
// nothing else a person could look up later, so the receipt, the refund code and
// the terms of what was paid are kept here, on the payer's own machine, and
// nowhere else.

import type { TokenKindValue } from './invoice.ts';

export interface PaymentRecord {
  /** The receipt digest the contract published. */
  receipt: string;
  amount: string; // decimal
  token: TokenKindValue;
  /** Short form of the merchant key, for recognising who was paid. */
  merchant: string;
  paidAt: number;
  /** Only present if a wallet key was available when paying. */
  refundCode?: string;
  /** The invoice's own title is the merchant's, so only line item names are kept. */
  items?: string[];
}

const KEY = 'mask.payments.v1';

export function loadPayments(): PaymentRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PaymentRecord[]) : [];
  } catch {
    return [];
  }
}

export function savePayment(record: PaymentRecord): void {
  const all = loadPayments().filter((p) => p.receipt !== record.receipt);
  all.unshift(record);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 500)));
  } catch {
    /* storage can be full or blocked; the receipt is still on screen */
  }
}

export function forgetPayment(receipt: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadPayments().filter((p) => p.receipt !== receipt)));
  } catch {
    /* nothing to forget if storage is unavailable */
  }
}
