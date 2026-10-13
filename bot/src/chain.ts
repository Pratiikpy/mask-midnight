// The bot's window onto the chain: read-only, public-only.
//
// Backed by the same SDK a third party would use, on purpose. If the bot needed
// anything the SDK cannot give it, that would be a sign it was reaching for a
// secret — and the compiler would not stop it, because TypeScript does not know
// what a secret is. Using the public client is the check.

import { Mask, type InvoiceStatus } from '@mask/node';
import type { ChainReader, InvoiceView } from './commands.ts';

const KIND_LABEL: Record<number, string> = { 0: 'standard', 1: 'multi-pay', 2: 'donation' };
const TOKEN_LABEL: Record<number, string> = { 0: 'tNIGHT', 1: 'mUSDC', 2: 'mUSAD' };

export interface LiveChainOptions {
  contractAddress: string;
  indexerUri: string;
  indexerWsUri: string;
}

export class LiveChain implements ChainReader {
  readonly #mask: Mask;

  constructor(opts: LiveChainOptions) {
    this.#mask = new Mask({
      contractAddress: opts.contractAddress,
      indexerUri: opts.indexerUri,
      indexerWsUri: opts.indexerWsUri,
      // The SDK wants a merchant key for the operations that build invoices.
      // This client never calls those, so it is given a key that owns nothing —
      // deliberately, rather than passing a real one that is never used.
      merchantKey: '0'.repeat(64),
    });
  }

  async getInvoice(commitment: string): Promise<InvoiceView> {
    const state = await this.#mask.getInvoice(commitment);
    return {
      status: state.status as InvoiceStatus as InvoiceView['status'],
      kind: KIND_LABEL[state.kind] ?? `kind ${state.kind}`,
      token: TOKEN_LABEL[state.token] ?? `token ${state.token}`,
      contributions: state.contributions,
      expiresAt: state.expiresAt,
    };
  }

  receiptExists(receipt: string): Promise<boolean> {
    return this.#mask.receiptExists(receipt);
  }

  attestationExists(digest: string): Promise<boolean> {
    return this.#mask.attestationExists(digest);
  }

  async totalCreated(): Promise<bigint> {
    return this.#mask.totalCreated();
  }
}
