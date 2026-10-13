// Assembles the provider set midnight-js needs to deploy and call contracts.
//
// Six providers, same shape the browser DApp will use — the only difference is
// that Node reads proving keys off disk (NodeZkConfigProvider) and persists
// private state to LevelDB, where the browser fetches keys over HTTP and keeps
// private state in the wallet.

import {
  type CoinPublicKey,
  type EncPublicKey,
  type FinalizedTransaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  type MidnightProvider,
  type UnboundTransaction,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';

import { endpoints } from './config.ts';
import type { WalletContext } from './wallet.ts';

/**
 * Implements both `WalletProvider` (key material + transaction balancing) and
 * `MidnightProvider` (submission). midnight-js expects these as two providers
 * but one object satisfies both.
 */
export class DevWalletProvider implements WalletProvider, MidnightProvider {
  // Written as an explicit field rather than a constructor parameter property:
  // Node's type-stripping loader rejects parameter properties.
  readonly ctx: WalletContext;

  constructor(ctx: WalletContext) {
    this.ctx = ctx;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.ctx.shieldedSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.ctx.shieldedSecretKeys.encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.ctx.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.ctx.shieldedSecretKeys,
        dustSecretKey: this.ctx.dustSecretKey,
      },
      { ttl },
    );
    const signed = await this.ctx.wallet.signRecipe(recipe, (payload) =>
      this.ctx.unshieldedKeystore.signData(payload),
    );
    return this.ctx.wallet.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.ctx.wallet.submitTransaction(tx);
  }
}

export interface BuildProvidersOptions {
  /** Directory holding the compiler's `keys/` and `zkir/` output for this contract. */
  zkConfigPath: string;
  /** LevelDB store name for private state. */
  privateStateStoreName: string;
  /** Namespaces the private state store per wallet. */
  accountId: string;
}

export function buildProviders(ctx: WalletContext, opts: BuildProvidersOptions) {
  const zkConfigProvider = new NodeZkConfigProvider<string>(opts.zkConfigPath);
  const walletProvider = new DevWalletProvider(ctx);

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: opts.privateStateStoreName,
      signingKeyStoreName: `${opts.privateStateStoreName}-signing-keys`,
      // Encrypts the local LevelDB private-state store on this machine only.
      // The SDK enforces at least 3 of {upper, lower, digit, special}.
      // Dev default for the local devnet — nothing of value is protected by it.
      privateStoragePasswordProvider: () => 'Mask-Devkit-Local-2026!',
      accountId: opts.accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(endpoints.indexer, endpoints.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(endpoints.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}
