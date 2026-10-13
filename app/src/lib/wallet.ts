// Lace wallet connection.
//
// The connector is injected asynchronously, so it is polled rather than read
// once. Version-gated to the 4.x connector API, which is what the pinned
// midnight-js 4.1.1 line speaks.

import type { NetworkId } from './config.ts';

export interface ShieldedAddresses {
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}

export interface WalletConfiguration {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri?: string;
  substrateNodeUri?: string;
  networkId?: string;
}

export interface ConnectedAPI {
  getConnectionStatus(): Promise<unknown>;
  getConfiguration(): Promise<WalletConfiguration>;
  getShieldedAddresses(): Promise<ShieldedAddresses>;
  balanceUnsealedTransaction(tx: string): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<string>;
}

interface InitialAPI {
  apiVersion: string;
  connect(networkId: string): Promise<ConnectedAPI>;
}

declare global {
  interface Window {
    midnight?: Record<string, unknown>;
  }
}

const COMPATIBLE_API_MAJOR = 4;

export class WalletNotFoundError extends Error {
  constructor() {
    super('No compatible Midnight wallet found. Install the Lace extension and reload.');
    this.name = 'WalletNotFoundError';
  }
}

function firstCompatibleWallet(): InitialAPI | undefined {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find((w): w is InitialAPI => {
    if (!w || typeof w !== 'object' || !('apiVersion' in w)) return false;
    const version = (w as { apiVersion: unknown }).apiVersion;
    return typeof version === 'string' && Number.parseInt(version, 10) === COMPATIBLE_API_MAJOR;
  });
}

/** Poll for the injected connector, then connect. */
export async function connectWallet(
  networkId: NetworkId,
  timeoutMs = 8_000,
): Promise<{ api: ConnectedAPI; config: WalletConfiguration; addresses: ShieldedAddresses }> {
  const deadline = Date.now() + timeoutMs;

  let initial = firstCompatibleWallet();
  while (!initial) {
    if (Date.now() > deadline) throw new WalletNotFoundError();
    await new Promise((r) => setTimeout(r, 100));
    initial = firstCompatibleWallet();
  }

  const api = await initial.connect(networkId);
  await api.getConnectionStatus();

  const [config, addresses] = await Promise.all([api.getConfiguration(), api.getShieldedAddresses()]);
  return { api, config, addresses };
}

export const isWalletInstalled = (): boolean => firstCompatibleWallet() !== undefined;
