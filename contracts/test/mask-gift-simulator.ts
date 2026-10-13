// In-memory harness for mask_gift.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, type Ledger, ledger } from '../build/mask_gift/contract/index.js';

export interface GiftPrivateState {
  /** The card. Whoever holds it holds the money. */
  secret: Uint8Array;
  /** The issuing merchant's identity key. */
  merchantKey: Uint8Array;
}

export const witnesses = {
  card_secret: ({ privateState }: { privateState: GiftPrivateState }) => [
    privateState,
    privateState.secret,
  ],
  merchant_key: ({ privateState }: { privateState: GiftPrivateState }) => [
    privateState,
    privateState.merchantKey,
  ],
};

export const bytes32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

export class MaskGiftSimulator {
  readonly contract: Contract<GiftPrivateState>;
  circuitContext: CircuitContext<GiftPrivateState>;

  constructor(initial: GiftPrivateState) {
    this.contract = new Contract<GiftPrivateState>(witnesses as never);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext(initial, '0'.repeat(64)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  as(s: Partial<GiftPrivateState>): this {
    this.circuitContext.currentPrivateState = { ...this.circuitContext.currentPrivateState, ...s };
    return this;
  }

  ledger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  issue(): Uint8Array {
    const r = this.contract.impureCircuits.issue(this.circuitContext);
    this.circuitContext = r.context;
    return r.result;
  }

  voidCard(): void {
    const r = this.contract.impureCircuits.void_card(this.circuitContext);
    this.circuitContext = r.context;
  }

  cardIssued(commitment: Uint8Array): boolean {
    const r = this.contract.impureCircuits.card_issued(this.circuitContext, commitment);
    this.circuitContext = r.context;
    return r.result;
  }

  cardVoided(commitment: Uint8Array): boolean {
    const r = this.contract.impureCircuits.card_voided(this.circuitContext, commitment);
    this.circuitContext = r.context;
    return r.result;
  }
}
