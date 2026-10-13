// The browser side of mask_pay.
//
// Private state here is per-call rather than long-lived: each circuit needs the
// terms of one specific invoice, and those differ per invoice. So the caller
// sets the state immediately before invoking, which is also what keeps a
// payer's browser from ever holding someone else's invoice terms.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import * as MaskPay from '../../../contracts/build/mask_pay/contract/index.js';
import { fromHex } from './format.ts';
import {
  emptyPrivateState,
  witnesses,
  type MaskPrivateState,
} from '../../../contracts/src/witnesses.ts';
import type { InvoiceTerms } from './invoice.ts';

export { emptyPrivateState, witnesses, type MaskPrivateState };

/**
 * Private state for one invoice.
 *
 * `ownerSecret` is supplied only by the merchant's own vault, for create, close
 * and cancel. A payer builds state from the payment link, which has no owner
 * secret, so a payer's state cannot authorise either.
 */
export const privateStateFromTerms = (
  terms: InvoiceTerms,
  payerKey: Uint8Array,
  ownerSecret?: Uint8Array,
): MaskPrivateState => ({
  ...emptyPrivateState(),
  merchantKey: fromHex(terms.merchantKey),
  salt: fromHex(terms.salt),
  amount: BigInt(terms.amount),
  payerKey,
  ownerSecret: ownerSecret ?? new Uint8Array(32),
});

export const MaskPayContract = CompiledContract.make<MaskPay.Contract<MaskPrivateState>>(
  'MaskPay',
  MaskPay.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  // Assets are served from the app's own origin — see app/public/{keys,zkir}.
  CompiledContract.withCompiledFileAssets('.'),
);

/**
 * Minimal private state provider.
 *
 * Deliberately in-memory: invoice terms are held in the app's own vault
 * (localStorage, under the merchant's control) and injected per call. A second
 * durable store would be a second place for secrets to leak from.
 */
export function inMemoryPrivateStateProvider() {
  const store = new Map<string, MaskPrivateState>();
  let contractAddress: string | undefined;
  return {
    set: async (key: string, state: MaskPrivateState) => {
      store.set(key, state);
    },
    get: async (key: string) => store.get(key) ?? null,
    remove: async (key: string) => {
      store.delete(key);
    },
    clear: async () => {
      store.clear();
    },
    setContractAddress: (addr: string) => {
      contractAddress = addr;
    },
    getContractAddress: () => contractAddress,
    setSigningKey: async () => {},
    getSigningKey: async () => null,
    removeSigningKey: async () => {},
    clearSigningKeys: async () => {},
  };
}

export const PRIVATE_STATE_ID = 'mask-pay';
