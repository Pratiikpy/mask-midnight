// Private-state witnesses for mask_pay.
//
// A witness is a value the contract asks the caller's own machine for. None of
// them is ever transmitted: they are private inputs to the proof, and the
// compiler refuses to let any of them reach the public ledger without an
// explicit disclose().
//
// This file is the single definition. The simulator tests, the headless devkit
// and the browser app all import it, so a witness added to the contract is added
// here once, and a missing one fails the build rather than a transaction.

/** Everything a caller keeps on their own machine. Never transmitted. */
export interface MaskPrivateState {
  /** The merchant's identity key. Carried in a payment link, so it is NOT an authority. */
  merchantKey: Uint8Array;
  /** Per-invoice randomness. Publishing it would make equal invoices linkable. */
  salt: Uint8Array;
  /** The invoice amount. Never disclosed, in any circuit. */
  amount: bigint;
  /** The payer's identity key: distinct per payment so nullifiers cannot be linked. */
  payerKey: Uint8Array;
  /** Distinguishes deliberate repeat contributions from replays. Pinned to 0 for STANDARD. */
  paymentIndex: bigint;
  /** Per-invoice ownership secret. Authorises close and cancel; never in a payment link. */
  ownerSecret: Uint8Array;
  /** Amount actually handed over when settling in a different asset. */
  convertedAmount: bigint;
  /** Evidence backing a revenue attestation. Receipts are derived, not given. */
  attestedAmounts: bigint[];
  attestedSalts: Uint8Array[];
  attestedPayers: Uint8Array[];
  attestedIndices: bigint[];
  attestedPaths: unknown[];
  /** Four invoices settled under one proof. */
  batchAmounts: bigint[];
  batchSalts: Uint8Array[];
  batchMerchants: Uint8Array[];
  batchIndices: bigint[];
}

export const emptyPrivateState = (): MaskPrivateState => ({
  merchantKey: new Uint8Array(32),
  salt: new Uint8Array(32),
  amount: 0n,
  payerKey: new Uint8Array(32),
  paymentIndex: 0n,
  ownerSecret: new Uint8Array(32),
  convertedAmount: 0n,
  attestedAmounts: [],
  attestedSalts: [],
  attestedPayers: [],
  attestedIndices: [],
  attestedPaths: [],
  batchAmounts: [],
  batchSalts: [],
  batchMerchants: [],
  batchIndices: [],
});

type Ctx = { privateState: MaskPrivateState };

/** Read one field of the private state as a witness result. */
const read =
  <K extends keyof MaskPrivateState>(key: K) =>
  ({ privateState }: Ctx): [MaskPrivateState, MaskPrivateState[K]] => [
    privateState,
    privateState[key],
  ];

const TWO_248 = 1n << 248n;

export const witnesses = {
  merchant_key: read('merchantKey'),
  invoice_salt: read('salt'),
  invoice_amount: read('amount'),
  payer_key: read('payerKey'),
  payment_index: read('paymentIndex'),
  owner_secret: read('ownerSecret'),
  converted_amount: read('convertedAmount'),
  attested_amounts: read('attestedAmounts'),
  attested_salts: read('attestedSalts'),
  attested_payers: read('attestedPayers'),
  attested_indices: read('attestedIndices'),
  attested_paths: read('attestedPaths'),
  batch_amounts: read('batchAmounts'),
  batch_salts: read('batchSalts'),
  batch_merchants: read('batchMerchants'),
  batch_indices: read('batchIndices'),

  /**
   * Schnorr challenge reduction, required by the vendored verifier.
   *
   * The circuit needs the challenge truncated to 248 bits, but transientHash
   * returns a value in BLS12-381's scalar field (about 2^255). It cannot divide,
   * so the prover supplies (quotient, remainder) for division by 2^248 and the
   * circuit checks q * 2^248 + r == c_full with q range-bounded, which is what
   * stops a prover choosing an arbitrary challenge and forging a signature.
   */
  getSchnorrReduction: (
    { privateState }: Ctx,
    challengeHash: bigint,
  ): [MaskPrivateState, [bigint, bigint]] => [
    privateState,
    [challengeHash / TWO_248, challengeHash % TWO_248],
  ],
};
