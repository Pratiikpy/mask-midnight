// In-memory harness for mask_pay.
//
// Runs circuits against a local contract state with no chain, no proof server
// and no wallet, so the whole behavioural suite finishes in milliseconds
// instead of the ~24 s per call a real settlement costs. Proving is exercised
// separately by the on-chain devkit run; what is tested here is the contract's
// logic, which is where the security properties live.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  ecMulGenerator,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  type Ledger,
  ledger,
  InvoiceKind,
  TokenKind,
} from '../build/mask_pay/contract/index.js';

import { witnesses, type MaskPrivateState } from '../src/witnesses.js';

export { witnesses, type MaskPrivateState };

/**
 * Reference-token colours for tests.
 *
 * On chain these come from a deployed mask_token; here they only have to be
 * distinct from each other and from the native colour (all zeros), which is
 * what the wrong-asset checks turn on.
 */
export const TEST_COLORS = {
  musdc: new Uint8Array(32).fill(0xc1),
  musad: new Uint8Array(32).fill(0xc2),
};

export const NATIVE_COLOR = new Uint8Array(32);

export const bytes32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

/** Serialise any value the way an observer reading raw bytes would see it. */
export const serialise = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => {
    if (typeof val === 'bigint') return val.toString();
    if (val instanceof Uint8Array) return Buffer.from(val).toString('hex');
    return val;
  }).toLowerCase();

export class MaskPaySimulator {
  readonly contract: Contract<MaskPrivateState>;
  circuitContext: CircuitContext<MaskPrivateState>;

  /**
   * The public transcript of every call made so far, as JSON.
   *
   * This is what a chain observer is given for each transaction: the ledger
   * operations the circuit performed and the values they touched. It is NOT
   * what `circuitContext.currentQueryContext` serialises to, which is a handle
   * to WebAssembly memory and prints as `{"__wbg_ptr":N}`, an empty string to
   * search. Privacy tests that searched that were passing vacuously.
   */
  readonly transcripts: string[] = [];

  /**
   * @param oraclePk Oracle public key sealed into the contract at construction.
   *   Defaults to a fixed, real curve point so tests that never touch conversion
   *   do not have to care about it.
   */
  constructor(
    initial: MaskPrivateState,
    oraclePk: JubjubPoint = ecMulGenerator(7n),
    colors: { musdc: Uint8Array; musad: Uint8Array } = TEST_COLORS,
  ) {
    this.contract = new Contract<MaskPrivateState>(witnesses as never);
    this.#recordTranscripts();
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(initial, '0'.repeat(64)),
        oraclePk,
        colors.musdc,
        colors.musad,
      );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  /** Every published attestation digest, read from the ledger. */
  ledgerAttestationDigests(): Uint8Array[] {
    return [...(this.ledger().attestations as unknown as Iterable<Uint8Array>)];
  }

  /** Wrap every impure circuit so its public transcript is captured. */
  #recordTranscripts(): void {
    const circuits = this.contract.impureCircuits as unknown as Record<
      string,
      (...a: unknown[]) => { proofData?: { publicTranscript?: unknown } }
    >;
    for (const name of Object.keys(circuits)) {
      const original = circuits[name]!.bind(this.contract.impureCircuits);
      circuits[name] = (...args: unknown[]) => {
        const res = original(...args);
        this.transcripts.push(serialise(res.proofData?.publicTranscript ?? null));
        return res;
      };
    }
  }

  /**
   * Everything a chain observer can read: every call's public transcript, plus
   * the ledger's collections dumped entry by entry.
   *
   * Dumped by iteration because the ledger object is a set of WebAssembly-backed
   * accessors and does not serialise on its own.
   */
  observerView(): string {
    const l = this.ledger() as unknown as {
      invoices: Iterable<[Uint8Array, unknown]>;
      receipts: Iterable<Uint8Array>;
      spent: Iterable<Uint8Array>;
      attestations: Iterable<Uint8Array>;
      created: bigint;
      receipt_tree: { root(): unknown };
    };
    return [
      ...this.transcripts,
      serialise([...l.invoices]),
      serialise([...l.receipts]),
      serialise([...l.spent]),
      serialise([...l.attestations]),
      serialise(l.created),
      serialise(l.receipt_tree.root()),
    ].join('\n');
  }

  /**
   * Swap the private state wholesale. This is how a different party — another
   * payer, or an attacker who knows only some of the invoice terms — is
   * modelled: identity here *is* the private state.
   */
  as(state: Partial<MaskPrivateState>): this {
    this.circuitContext.currentPrivateState = {
      ...this.circuitContext.currentPrivateState,
      ...state,
    };
    return this;
  }

  ledger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /**
   * Set the block time the next circuit call sees, in SECONDS since the epoch.
   *
   * That is the unit the chain uses: `blockTimeLt` compares against the block's
   * `secondsSinceEpoch`, so an `expires_at` written in milliseconds is a date
   * tens of thousands of years away and never expires.
   */
  atBlockTime(secondsSinceEpoch: bigint): this {
    const ctx = this.circuitContext.currentQueryContext;
    ctx.block = { ...ctx.block, secondsSinceEpoch };
    return this;
  }

  privateState(): MaskPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  createInvoice(kind: InvoiceKind, token: TokenKind, expiresAt: bigint): Uint8Array {
    const res = this.contract.impureCircuits.create_invoice(
      this.circuitContext,
      kind,
      token,
      expiresAt,
    );
    this.circuitContext = res.context;
    return res.result;
  }

  settleInvoice(kind: InvoiceKind, token: TokenKind): Uint8Array {
    const res = this.contract.impureCircuits.settle_invoice(this.circuitContext, kind, token);
    this.circuitContext = res.context;
    return res.result;
  }

  closeInvoice(kind: InvoiceKind, token: TokenKind): void {
    const res = this.contract.impureCircuits.close_invoice(this.circuitContext, kind, token);
    this.circuitContext = res.context;
  }

  cancelInvoice(kind: InvoiceKind, token: TokenKind): void {
    const res = this.contract.impureCircuits.cancel_invoice(this.circuitContext, kind, token);
    this.circuitContext = res.context;
  }

  invoiceExists(commitment: Uint8Array): boolean {
    const res = this.contract.impureCircuits.invoice_exists(this.circuitContext, commitment);
    this.circuitContext = res.context;
    return res.result;
  }

  isSettled(commitment: Uint8Array): boolean {
    const res = this.contract.impureCircuits.is_settled(this.circuitContext, commitment);
    this.circuitContext = res.context;
    return res.result;
  }

  receiptExists(receipt: Uint8Array): boolean {
    const res = this.contract.impureCircuits.receipt_exists(this.circuitContext, receipt);
    this.circuitContext = res.context;
    return res.result;
  }
}

/**
 * A synthetic coin for exercising the escrow path offline.
 *
 * Unqualified (no mt_index) because the escrow circuit takes a ShieldedCoinInfo:
 * it receives the payer's coin and forwards it in the same transaction rather
 * than spending a coin the contract already owns.
 */
export interface Coin {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

/**
 * A shielded coin for tests.
 *
 * The colour defaults to native (all zeros) because that is what a tNIGHT coin
 * carries, and settlement now checks it: a coin of the right value in the wrong
 * asset is not payment. Pass a reference-token colour to settle a mUSDC or
 * mUSAD invoice.
 */
export const coin = (value: bigint, color: Uint8Array = NATIVE_COLOR): Coin => ({
  nonce: bytes32(0x66),
  color,
  value,
});

export interface MaskPaySimulator {
  settleShielded(kind: unknown, token: unknown, c: Coin, to: Uint8Array): Uint8Array;
}

MaskPaySimulator.prototype.settleShielded = function (
  this: MaskPaySimulator & { contract: any; circuitContext: any },
  kind: unknown,
  token: unknown,
  c: Coin,
  to: Uint8Array,
): Uint8Array {
  const res = this.contract.impureCircuits.settle_invoice_shielded(
    this.circuitContext,
    kind,
    token,
    c,
    { bytes: to },
  );
  this.circuitContext = res.context;
  return res.result;
};

export interface MaskPaySimulator {
  settleConverted(
    kind: unknown,
    invoiceToken: unknown,
    paidToken: unknown,
    c: Coin,
    merchantAddr: Uint8Array,
    quoteExpiresAt: bigint,
    signature: unknown,
  ): Uint8Array;
}

MaskPaySimulator.prototype.settleConverted = function (
  this: MaskPaySimulator & { contract: any; circuitContext: any },
  kind: unknown,
  invoiceToken: unknown,
  paidToken: unknown,
  c: Coin,
  merchantAddr: Uint8Array,
  quoteExpiresAt: bigint,
  signature: unknown,
): Uint8Array {
  const res = this.contract.impureCircuits.settle_invoice_converted(
    this.circuitContext,
    kind,
    invoiceToken,
    paidToken,
    c,
    { bytes: merchantAddr },
    quoteExpiresAt,
    signature,
  );
  this.circuitContext = res.context;
  return res.result;
};

export interface MaskPaySimulator {
  attestRevenueAtLeast(kind: unknown, token: unknown, threshold: bigint): Uint8Array;
  attestationExists(digest: Uint8Array): boolean;
  /** Merkle path for a receipt, taken from the real on-ledger tree. */
  pathFor(receipt: Uint8Array): unknown;
}

MaskPaySimulator.prototype.attestRevenueAtLeast = function (
  this: MaskPaySimulator & { contract: any; circuitContext: any },
  kind: unknown,
  token: unknown,
  threshold: bigint,
): Uint8Array {
  const res = this.contract.impureCircuits.attest_revenue_at_least(
    this.circuitContext,
    kind,
    token,
    threshold,
  );
  this.circuitContext = res.context;
  return res.result;
};

MaskPaySimulator.prototype.attestationExists = function (
  this: MaskPaySimulator & { contract: any; circuitContext: any },
  digest: Uint8Array,
): boolean {
  const res = this.contract.impureCircuits.attestation_exists(this.circuitContext, digest);
  this.circuitContext = res.context;
  return res.result;
};

MaskPaySimulator.prototype.pathFor = function (
  this: MaskPaySimulator,
  receipt: Uint8Array,
): unknown {
  const path = (this.ledger() as any).receipt_tree.findPathForLeaf(receipt);
  if (path === undefined) throw new Error('receipt not found in tree');
  return path;
};

export interface MaskPaySimulator {
  settleBatch(kind: unknown, token: unknown): Uint8Array[];
}

MaskPaySimulator.prototype.settleBatch = function (
  this: MaskPaySimulator & { contract: any; circuitContext: any },
  kind: unknown,
  token: unknown,
): Uint8Array[] {
  const res = this.contract.impureCircuits.settle_batch(this.circuitContext, kind, token);
  this.circuitContext = res.context;
  return res.result;
};

export interface MaskPaySimulator {
  refundPayment(kind: unknown, token: unknown, c: Coin, payerAddr: Uint8Array): Uint8Array;
}

MaskPaySimulator.prototype.refundPayment = function (
  this: MaskPaySimulator & { contract: any; circuitContext: any },
  kind: unknown,
  token: unknown,
  c: Coin,
  payerAddr: Uint8Array,
): Uint8Array {
  const res = this.contract.impureCircuits.refund_payment(
    this.circuitContext,
    kind,
    token,
    c,
    { bytes: payerAddr },
  );
  this.circuitContext = res.context;
  return res.result;
};
