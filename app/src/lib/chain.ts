// Reading public contract state.
//
// Wrapped in a timeout for a reason found the hard way: when the indexer is
// unreachable, the provider's Apollo client retries indefinitely and the
// promise never settles. The UI then sits on a spinner forever with no error,
// which is the worst of both — the user cannot tell a slow chain from a dead
// one, and nothing tells them to check their node.

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { CONTRACT_ADDRESS, NETWORK_ID, PUBLIC_INDEXER } from './config.ts';
import * as MaskPay from '../../../contracts/build/mask_pay/contract/index.js';
import { demoChain, isDemoActive } from './demo.ts';

export interface MaskLedger {
  invoices: {
    member(k: Uint8Array): boolean;
    lookup(k: Uint8Array): {
      status: number;
      kind: number;
      token: number;
      expires_at: bigint;
      contributions: bigint;
    };
    size(): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, { status: number }]>;
  };
  receipts: {
    member(k: Uint8Array): boolean;
    size(): bigint;
    [Symbol.iterator](): Iterator<Uint8Array>;
  };
  attestations: { member(k: Uint8Array): boolean; size(): bigint };
  refunded: { member(k: Uint8Array): boolean; size(): bigint };
  created: bigint;
}

export class ChainUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ChainUnavailableError';
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new ChainUnavailableError(
              `${what} did not respond within ${Math.round(ms / 1000)}s. Is the devnet running?`,
            ),
          ),
        ms,
      ),
    ),
  ]);
}

/**
 * Read the contract's public ledger.
 *
 * Throws a ChainUnavailableError the caller can render, rather than hanging.
 */
export async function readLedger(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MaskLedger> {
  // Demo mode reads the in-browser ledger the circuits just wrote to.
  if (isDemoActive()) return demoChain.ledger();

  if (!CONTRACT_ADDRESS) {
    throw new ChainUnavailableError(
      'No contract address configured. Deploy mask_pay, then restart the app.',
    );
  }

  if (!PUBLIC_INDEXER) {
    throw new ChainUnavailableError(
      `There is no public indexer for ${NETWORK_ID}. Connect a wallet to read the chain.`,
    );
  }
  const provider = indexerPublicDataProvider(PUBLIC_INDEXER.indexerUri, PUBLIC_INDEXER.indexerWsUri);

  const state = await withTimeout(
    provider.queryContractState(CONTRACT_ADDRESS),
    timeoutMs,
    'The indexer',
  );

  if (!state) {
    throw new ChainUnavailableError(
      'That contract has no state on this network. Wrong address, or wrong network.',
    );
  }

  return MaskPay.ledger(state.data as never) as unknown as MaskLedger;
}

export const describeChainError = (e: unknown): string =>
  e instanceof ChainUnavailableError
    ? e.message
    : e instanceof Error
      ? e.message
      : 'Could not read the chain.';
