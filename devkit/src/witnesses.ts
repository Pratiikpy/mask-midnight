// Witness implementations for mask_smoke.
//
// Witnesses run on the caller's own machine and feed private values into the
// circuit. Nothing here is transmitted; only what a circuit explicitly
// disclose()s ever reaches the ledger. The private state is the Mask-side
// store that would, in the real product, hold the invoice a merchant created.

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

export interface MaskPrivateState {
  /** Stand-in for the merchant's identity key. */
  merchantSecret: Uint8Array;
  /** The invoice amount. Never disclosed. */
  amount: bigint;
  /** Per-invoice randomness — without it, equal amounts would share a commitment. */
  salt: Uint8Array;
}

export const createMaskPrivateState = (
  merchantSecret: Uint8Array,
  amount: bigint,
  salt: Uint8Array,
): MaskPrivateState => ({ merchantSecret, amount, salt });

export const witnesses = {
  merchant_secret: ({
    privateState,
  }: WitnessContext<unknown, MaskPrivateState>): [MaskPrivateState, Uint8Array] => [
    privateState,
    privateState.merchantSecret,
  ],

  invoice_amount: ({
    privateState,
  }: WitnessContext<unknown, MaskPrivateState>): [MaskPrivateState, bigint] => [
    privateState,
    privateState.amount,
  ],

  invoice_salt: ({
    privateState,
  }: WitnessContext<unknown, MaskPrivateState>): [MaskPrivateState, Uint8Array] => [
    privateState,
    privateState.salt,
  ],
};
