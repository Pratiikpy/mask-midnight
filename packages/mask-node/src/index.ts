// Mask on Midnight — server-side SDK.
//
// The shape of this SDK follows from where secrets are allowed to be. On
// Midnight the amount, the merchant key and the salt are the things that must
// never reach a server that is not the merchant's own. So this library:
//
//   * generates invoice terms and payment links locally,
//   * verifies payments by reading PUBLIC chain state,
//   * verifies webhook signatures,
//
// and deliberately does not sign, prove, or move funds. Proving happens on the
// payer's machine because a server that proves is a server that has seen the
// amount.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

export const InvoiceKind = { STANDARD: 0, MULTIPAY: 1, DONATION: 2 } as const;
export const TokenKind = { NATIVE: 0, MUSDC: 1, MUSAD: 2 } as const;

export type InvoiceKindValue = (typeof InvoiceKind)[keyof typeof InvoiceKind];
export type TokenKindValue = (typeof TokenKind)[keyof typeof TokenKind];

export interface MaskConfig {
  /** Address of the deployed mask_pay contract. */
  contractAddress: string;
  /** Indexer HTTP endpoint. */
  indexerUri: string;
  /** Indexer WebSocket endpoint. */
  indexerWsUri: string;
  /**
   * The merchant's 64-character hex identity key.
   *
   * Every invoice binds to it, and it is what proves an invoice is yours. Keep
   * it out of source control and out of logs — it is the one secret this
   * library holds.
   */
  merchantKey: string;
  /** Base URL used when building payment links. */
  appUrl?: string;
  /** Shared secret for webhook signature verification. */
  webhookSecret?: string;
}

export interface InvoiceTerms {
  merchantKey: string;
  salt: string;
  amount: string;
  kind: InvoiceKindValue;
  token: TokenKindValue;
}

export interface CreatedInvoice {
  terms: InvoiceTerms;
  /**
   * Send this to the payer. The terms travel in the URL fragment, which
   * browsers never transmit to a server — so the amount does not pass through
   * your infrastructure or anyone else's.
   */
  paymentLink: string;
  /**
   * Local reference only. The on-chain commitment is produced when the payer's
   * or merchant's wallet proves `create_invoice`; it is not derivable here,
   * because deriving it would require the hash the circuit computes.
   */
  reference: string;
}

export type InvoiceStatus = 'open' | 'settled' | 'cancelled' | 'unknown';

export interface InvoiceState {
  status: InvoiceStatus;
  kind: InvoiceKindValue;
  token: TokenKindValue;
  /** Absolute expiry in ms. Zero means never. */
  expiresAt: bigint;
  /** How many settlements landed. A count, never amounts. */
  contributions: number;
}

export class MaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaskError';
  }
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const fromHex = (h: string): Uint8Array => {
  const clean = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const encodeTerms = (terms: InvoiceTerms, contractAddress: string): string =>
  Buffer.from(JSON.stringify({ ...terms, contractAddress }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function decodeTerms(encoded: string): (InvoiceTerms & { contractAddress?: string }) | null {
  try {
    const fragment = encoded.includes('#') ? encoded.slice(encoded.indexOf('#') + 1) : encoded;
    const b64 = fragment.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as InvoiceTerms & {
      contractAddress?: string;
    };
    if (!HEX64.test(parsed.merchantKey) || !HEX64.test(parsed.salt)) return null;
    BigInt(parsed.amount);
    return parsed;
  } catch {
    return null;
  }
}

/** Generate a merchant identity key. Store it somewhere durable and private. */
export function generateMerchantKey(): string {
  return toHex(randomBytes(32));
}

export interface CreateInvoiceParams {
  amount: bigint | number | string;
  kind?: InvoiceKindValue;
  token?: TokenKindValue;
}

export class Mask {
  readonly #config: MaskConfig;
  #provider: ReturnType<typeof indexerPublicDataProvider> | null = null;

  constructor(config: MaskConfig) {
    if (!HEX64.test(config.merchantKey)) {
      throw new MaskError('merchantKey must be 64 hex characters. Use generateMerchantKey().');
    }
    if (!config.contractAddress) throw new MaskError('contractAddress is required.');
    this.#config = config;
  }

  /**
   * Create invoice terms and a payment link.
   *
   * Nothing is written to the chain here — publishing the commitment requires a
   * proof, which requires a wallet. The link is valid immediately; the payer
   * simply cannot settle until the commitment lands.
   */
  createInvoice(params: CreateInvoiceParams): CreatedInvoice {
    const amount = BigInt(params.amount);
    if (amount <= 0n) throw new MaskError('amount must be greater than zero.');

    const salt = toHex(randomBytes(32));
    const terms: InvoiceTerms = {
      merchantKey: this.#config.merchantKey,
      salt,
      amount: amount.toString(),
      kind: params.kind ?? InvoiceKind.STANDARD,
      token: params.token ?? TokenKind.NATIVE,
    };

    const base = this.#config.appUrl?.replace(/\/$/, '') ?? '';
    return {
      terms,
      paymentLink: `${base}/pay#${encodeTerms(terms, this.#config.contractAddress)}`,
      reference: salt,
    };
  }

  #dataProvider() {
    this.#provider ??= indexerPublicDataProvider(
      this.#config.indexerUri,
      this.#config.indexerWsUri,
    );
    return this.#provider;
  }

  async #ledger(): Promise<{
    invoices: { member(k: Uint8Array): boolean; lookup(k: Uint8Array): unknown };
    receipts: { member(k: Uint8Array): boolean };
    attestations: { member(k: Uint8Array): boolean };
    created: bigint;
  }> {
    const state = await this.#dataProvider().queryContractState(this.#config.contractAddress);
    if (!state) {
      throw new MaskError(
        `No contract state at ${this.#config.contractAddress}. Wrong address, or wrong network.`,
      );
    }
    // Imported lazily so the compiled contract is only required by code paths
    // that actually read chain state.
    const mod = (await import('./ledger.js')) as {
      readLedger(data: unknown): never;
    };
    return mod.readLedger(state.data) as never;
  }

  /** Has this payment receipt been published on chain? */
  async receiptExists(receipt: string): Promise<boolean> {
    if (!HEX64.test(receipt)) throw new MaskError('receipt must be 64 hex characters.');
    const ledger = await this.#ledger();
    return ledger.receipts.member(fromHex(receipt));
  }

  /**
   * How many invoices this contract has ever created.
   *
   * The one aggregate the ledger publishes, and the only number about the
   * business as a whole that anyone — including us — can read. Not their value,
   * not how many settled, not who issued them.
   */
  async totalCreated(): Promise<bigint> {
    const ledger = await this.#ledger();
    return ledger.created;
  }

  /** Has this revenue attestation been published on chain? */
  async attestationExists(digest: string): Promise<boolean> {
    if (!HEX64.test(digest)) throw new MaskError('digest must be 64 hex characters.');
    const ledger = await this.#ledger();
    return ledger.attestations.member(fromHex(digest));
  }

  /**
   * Read an invoice's public state.
   *
   * Returns status, type, asset, expiry and a contribution count — never an
   * amount, because the chain does not hold one.
   */
  async getInvoice(commitment: string): Promise<InvoiceState> {
    if (!HEX64.test(commitment)) throw new MaskError('commitment must be 64 hex characters.');
    const ledger = await this.#ledger();
    const key = fromHex(commitment);

    if (!ledger.invoices.member(key)) {
      return {
        status: 'unknown',
        kind: InvoiceKind.STANDARD,
        token: TokenKind.NATIVE,
        expiresAt: 0n,
        contributions: 0,
      };
    }

    const raw = ledger.invoices.lookup(key) as {
      status: number;
      kind: number;
      token: number;
      expires_at: bigint;
      contributions: bigint;
    };

    const statuses: InvoiceStatus[] = ['open', 'settled', 'cancelled'];
    return {
      status: statuses[raw.status] ?? 'unknown',
      kind: raw.kind as InvoiceKindValue,
      token: raw.token as TokenKindValue,
      expiresAt: raw.expires_at,
      contributions: Number(raw.contributions),
    };
  }

  /** True once the invoice is fully settled. */
  async isSettled(commitment: string): Promise<boolean> {
    return (await this.getInvoice(commitment)).status === 'settled';
  }

  /**
   * Verify a webhook signature.
   *
   * Compared in constant time — a plain `===` on an HMAC leaks the correct
   * prefix through timing and makes forgery tractable.
   */
  verifyWebhook(rawBody: string, signature: string): boolean {
    const secret = this.#config.webhookSecret;
    if (!secret) throw new MaskError('webhookSecret is not configured.');

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
    } catch {
      return false;
    }
    if (received.length !== expected.length) return false;
    return timingSafeEqual(expected, received);
  }

  /** Sign a payload the same way, for testing an integration end to end. */
  signWebhook(rawBody: string): string {
    const secret = this.#config.webhookSecret;
    if (!secret) throw new MaskError('webhookSecret is not configured.');
    return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  }
}

export default Mask;
