// Endpoints for the Mask local devnet (mask/midnight/devnet/devnet.yml).
//
// These match the container port mappings exactly. Network id is `undeployed`,
// which is what the node's `dev` preset produces.

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

export type NetworkName = 'undeployed' | 'preview' | 'preprod' | 'mainnet';

/**
 * Which chain the harness talks to. Defaults to the local devnet so existing
 * scripts behave exactly as before; set MASK_NETWORK=preview to target the
 * public Preview network. Preprod and mainnet are served by Blockfrost and need
 * BLOCKFROST_PROJECT_ID.
 */
export const NETWORK_ID: NetworkName = (process.env.MASK_NETWORK ?? 'undeployed') as NetworkName;

/**
 * Seed of the genesis mint wallet. On a `CFG_PRESET=dev` node this account
 * holds every NIGHT minted in the genesis block, so it is the source of funds
 * for every test account we create.
 *
 * Local devnet only. It is a well-known constant published by
 * midnightntwrk/midnight-local-dev and carries no value anywhere else.
 */
export const GENESIS_MINT_WALLET_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

function endpointsFor(network: NetworkName) {
  switch (network) {
    case 'undeployed':
      return {
        indexer: 'http://127.0.0.1:8088/api/v4/graphql',
        indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
        node: 'http://127.0.0.1:9944',
        nodeWS: 'ws://127.0.0.1:9944',
        proofServer: 'http://127.0.0.1:6300',
        faucet: '',
      };
    case 'preview':
      return {
        indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
        indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
        node: 'https://rpc.preview.midnight.network',
        nodeWS: 'wss://rpc.preview.midnight.network',
        proofServer: 'http://127.0.0.1:6300',
        faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
      };
    case 'preprod':
    case 'mainnet': {
      const token = process.env.BLOCKFROST_PROJECT_ID;
      if (!token) throw new Error(`MASK_NETWORK=${network} needs BLOCKFROST_PROJECT_ID`);
      return {
        indexer: `https://midnight-${network}.blockfrost.io/api/v0?project_id=${token}`,
        indexerWS: `wss://midnight-${network}.blockfrost.io/api/v0/ws?project_id=${token}`,
        node: `https://rpc.midnight-${network}.blockfrost.io?project_id=${token}`,
        nodeWS: `wss://rpc.midnight-${network}.blockfrost.io?project_id=${token}`,
        proofServer: 'http://127.0.0.1:6300',
        faucet: network === 'preprod' ? 'https://midnight-tmnight-preprod.nethermind.dev/' : '',
      };
    }
  }
}

export const endpoints = endpointsFor(NETWORK_ID);

export function envConfig(): EnvironmentConfiguration {
  return {
    walletNetworkId: NETWORK_ID,
    networkId: NETWORK_ID,
    indexer: endpoints.indexer,
    indexerWS: endpoints.indexerWS,
    node: endpoints.node,
    nodeWS: endpoints.nodeWS,
    proofServer: endpoints.proofServer,
    faucet: endpoints.faucet,
  };
}

setNetworkId(NETWORK_ID);

/**
 * The privacy canary.
 *
 * Seeded onto the real deployed contract alongside the demo invoices, and then
 * looked for by `check-canary.ts`. Two values with opposite jobs:
 *
 *   `expiry` is written into the public invoice record, so it MUST be findable.
 *     If it is not, the search is looking at the wrong bytes and any clean
 *     result it prints is meaningless.
 *   `amount` never leaves the witness, so it must NOT be findable.
 *
 * Both are six bytes wide on purpose. A realistic invoice amount like 42_500
 * encodes as the two bytes `a604`, which occurs by chance many times in a
 * megabyte of hex — small values cannot be decided either way, so the canary
 * carries the proof and the demo invoices stay readable.
 */
export const PRIVACY_CANARY = {
  amount: 867_530_912_345_678n,
  expiry: 1_759_296_000_999n,
} as const;
