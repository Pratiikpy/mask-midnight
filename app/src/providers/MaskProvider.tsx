// Wallet connection, provider assembly, and the contract handle.
//
// One context rather than several: every screen that does anything on chain
// needs all of it, and splitting it only produces a chain of nested providers
// that must be kept in sync.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { fromHex as sdkFromHex, toHex as sdkToHex } from '@midnight-ntwrk/midnight-js-utils';

import { LOCAL_FALLBACK, NETWORK_ID } from '../lib/config.ts';
import { inMemoryPrivateStateProvider } from '../lib/contract.ts';
import { connectWallet, isWalletInstalled, type ConnectedAPI } from '../lib/wallet.ts';
import { demoChain, demoProviders, setDemoActive } from '../lib/demo.ts';

export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; coinPublicKey: string; proverUri: string; indexerUri: string }
  | { status: 'error'; message: string };

interface MaskContextValue {
  connection: ConnectionState;
  connect: () => Promise<void>;
  /** Run the real circuits in the browser against a simulated ledger. */
  startDemo: () => void;
  disconnect: () => void;
  mode: 'none' | 'wallet' | 'demo';
  walletInstalled: boolean;
  /** Assembled providers, available once connected. */
  providers: unknown | null;
  api: ConnectedAPI | null;
}

const MaskContext = createContext<MaskContextValue | null>(null);

export function MaskProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'disconnected' });
  const [providers, setProviders] = useState<unknown | null>(null);
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [mode, setMode] = useState<'none' | 'wallet' | 'demo'>('none');

  const startDemo = useCallback(() => {
    demoChain.reset();
    setDemoActive(true);
    setApi(null);
    setProviders(demoProviders);
    setMode('demo');
    setConnection({
      status: 'connected',
      // A fixed, obviously synthetic key: demo payments go nowhere.
      coinPublicKey: 'de'.repeat(32),
      proverUri: 'in this browser (no proof generated)',
      indexerUri: 'simulated ledger',
    });
  }, []);

  const connect = useCallback(async () => {
    setConnection({ status: 'connecting' });
    try {
      setNetworkId(NETWORK_ID);
      const { api: connected, config, addresses } = await connectWallet(NETWORK_ID);

      // The wallet is the authority on endpoints. Fall back only for a local
      // devnet wallet that does not report a prover URI.
      const indexerUri = config.indexerUri ?? LOCAL_FALLBACK.indexerUri;
      const indexerWsUri = config.indexerWsUri ?? LOCAL_FALLBACK.indexerWsUri;
      const proverUri = config.proverServerUri ?? LOCAL_FALLBACK.proverServerUri;

      const zkConfigProvider = new FetchZkConfigProvider(
        window.location.origin,
        fetch.bind(window),
      );

      const assembled = {
        privateStateProvider: inMemoryPrivateStateProvider(),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(proverUri, zkConfigProvider),
        publicDataProvider: indexerPublicDataProvider(indexerUri, indexerWsUri),
        walletProvider: {
          getCoinPublicKey: () => addresses.shieldedCoinPublicKey,
          getEncryptionPublicKey: () => addresses.shieldedEncryptionPublicKey,
          balanceTx: async (tx: { serialize(): Uint8Array }) => {
            const received = await connected.balanceUnsealedTransaction(sdkToHex(tx.serialize()));
            return sdkFromHex(received.tx);
          },
        },
        midnightProvider: {
          submitTx: async (tx: { serialize(): Uint8Array; identifiers(): string[] }) => {
            await connected.submitTransaction(sdkToHex(tx.serialize()));
            return tx.identifiers()[0]!;
          },
        },
      };

      setDemoActive(false);
      setMode('wallet');
      setApi(connected);
      setProviders(assembled);
      setConnection({
        status: 'connected',
        coinPublicKey: addresses.shieldedCoinPublicKey,
        proverUri,
        indexerUri,
      });
    } catch (e) {
      setConnection({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not connect to the wallet.',
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    setDemoActive(false);
    setMode('none');
    setApi(null);
    setProviders(null);
    setConnection({ status: 'disconnected' });
  }, []);

  const value = useMemo<MaskContextValue>(
    () => ({
      connection,
      connect,
      startDemo,
      disconnect,
      mode,
      walletInstalled: isWalletInstalled(),
      providers,
      api,
    }),
    [connection, connect, startDemo, disconnect, mode, providers, api],
  );

  return <MaskContext.Provider value={value}>{children}</MaskContext.Provider>;
}

export function useMask(): MaskContextValue {
  const ctx = useContext(MaskContext);
  if (!ctx) throw new Error('useMask must be used inside MaskProvider');
  return ctx;
}
