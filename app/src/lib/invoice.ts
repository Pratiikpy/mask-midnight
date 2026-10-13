// The invoice as the client knows it.
//
// On Midnight the ledger holds only a commitment. Everything that gives that
// commitment meaning — the merchant key, the amount, the salt, the title —
// lives here, on the holder's own machine, and is never transmitted to a
// server.
//
// A payer needs the same terms to reproduce the commitment, so paying requires
// receiving them out of band. That is the share link: the terms travel
// directly from merchant to payer, not via the chain and not via us.

import { fromHex, randomBytes, toHex } from './format.ts';

export const InvoiceKind = { STANDARD: 0, MULTIPAY: 1, DONATION: 2 } as const;
export const TokenKind = { NATIVE: 0, MUSDC: 1, MUSAD: 2 } as const;

export type InvoiceKindValue = (typeof InvoiceKind)[keyof typeof InvoiceKind];
export type TokenKindValue = (typeof TokenKind)[keyof typeof TokenKind];

export const KIND_LABEL: Record<number, string> = {
  0: 'Standard',
  1: 'Multi-pay',
  2: 'Donation',
};

export const TOKEN_LABEL: Record<number, string> = {
  0: 'tNIGHT',
  1: 'mUSDC',
  2: 'mUSAD',
};

/** One line of an itemised invoice. Travels in the payment link, never on chain. */
export interface LineItem {
  name: string;
  qty: string; // decimal, whole units
  unit: string; // decimal, whole units
}

/** The secret terms. Reproducing the commitment requires all of them. */
export interface InvoiceTerms {
  merchantKey: string; // hex
  salt: string; // hex
  amount: string; // decimal string, so bigint survives JSON
  kind: InvoiceKindValue;
  token: TokenKindValue;
  /**
   * Where an escrowed payment should send the coin: the merchant's shielded
   * coin public key.
   *
   * Deliberately not on chain. Publishing a merchant's payout address beside
   * their invoices would let anyone group every invoice that merchant ever
   * issued, which is most of what this product exists to prevent. It travels in
   * the payment link instead, from merchant to payer and nowhere else.
   *
   * Optional because an invoice can also be settled by proof alone, without
   * moving money, and older links do not carry it.
   */
  merchantAddr?: string; // hex
  /** Optional itemisation. Local to the link: the commitment covers only the total. */
  items?: LineItem[];
}

export interface InvoiceRecord extends InvoiceTerms {
  /** Commitment returned by the contract — the invoice's public identifier. */
  commitment?: string;
  /**
   * Authority to close or cancel this invoice. Local-only: it is not part of the
   * terms, so it is never in the payment link and a payer cannot obtain it.
   */
  ownerSecret?: string; // hex
  /** Local-only, never leaves the machine and never enters the commitment. */
  title: string;
  memo: string;
  createdAt: number;
  expiresAt: string; // decimal seconds since the epoch, "0" for never
  contractAddress?: string;
  status?: 'pending' | 'open' | 'settled' | 'cancelled';
}

const VAULT_KEY = 'mask.invoices.v1';
const IDENTITY_KEY = 'mask.identity.v1';

/**
 * The merchant's long-lived identity key.
 *
 * Generated locally on first use. Losing it means losing the ability to prove
 * ownership of every invoice created with it, which is why it is surfaced in
 * Settings for backup rather than hidden.
 */
export function merchantKey(): string {
  let key = localStorage.getItem(IDENTITY_KEY);
  if (!key) {
    key = toHex(randomBytes(32));
    localStorage.setItem(IDENTITY_KEY, key);
  }
  return key;
}

export function resetMerchantKey(next?: string): string {
  const key = next ?? toHex(randomBytes(32));
  localStorage.setItem(IDENTITY_KEY, key);
  return key;
}

export function loadInvoices(): InvoiceRecord[] {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as InvoiceRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveInvoice(record: InvoiceRecord): void {
  const all = loadInvoices();
  const i = all.findIndex(
    (r) => r.salt === record.salt && r.merchantKey === record.merchantKey,
  );
  if (i >= 0) all[i] = { ...all[i], ...record };
  else all.unshift(record);
  localStorage.setItem(VAULT_KEY, JSON.stringify(all));
}

export function forgetInvoice(salt: string): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(loadInvoices().filter((r) => r.salt !== salt)));
}

/**
 * Encode invoice terms for a share link.
 *
 * The terms go in the URL fragment, not the query string: a fragment is never
 * sent to a server, so even the page host never sees the amount. It is still a
 * secret in a link — anyone who has the link can reproduce the commitment —
 * which is exactly the property that makes it a payment request.
 */
export function encodeTerms(terms: InvoiceTerms, contractAddress?: string): string {
  // An explicit list, not a spread. Callers pass whole vault records, which also
  // hold the owner secret, the title and the memo; spreading one into the link
  // would hand the payer the authority to cancel the invoice and the merchant's
  // private notes. Only what a payer needs to settle goes in.
  const payload = {
    merchantKey: terms.merchantKey,
    salt: terms.salt,
    amount: terms.amount,
    kind: terms.kind,
    token: terms.token,
    merchantAddr: terms.merchantAddr,
    items: terms.items,
    contractAddress,
  };
  return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeTerms(encoded: string): (InvoiceTerms & { contractAddress?: string }) | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(b64)) as InvoiceTerms & { contractAddress?: string };
    if (!parsed.merchantKey || !parsed.salt || !parsed.amount) return null;
    // Reject anything malformed rather than letting it fail deep in a circuit.
    if (fromHex(parsed.merchantKey).length !== 32) return null;
    if (fromHex(parsed.salt).length !== 32) return null;
    BigInt(parsed.amount);
    if (parsed.items !== undefined) {
      const ok =
        Array.isArray(parsed.items) &&
        parsed.items.length <= 50 &&
        parsed.items.every(
          (i) =>
            typeof i?.name === 'string' &&
            i.name.length <= 120 &&
            /^\d+$/.test(i.qty) &&
            /^\d+$/.test(i.unit),
        );
      if (!ok) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function shareLink(terms: InvoiceTerms, contractAddress?: string): string {
  return `${window.location.origin}/pay#${encodeTerms(terms, contractAddress)}`;
}
