// In-memory harness for mask_card.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  type Ledger,
  ledger,
  CredentialKind,
} from '../build/mask_card/contract/index.js';

export interface CardPrivateState {
  secret: Uint8Array;
  pin: Uint8Array;
  salt: Uint8Array;
  authAmount: bigint;
  authIndex: bigint;
}

export const witnesses = {
  card_secret: ({ privateState }: { privateState: CardPrivateState }) => [privateState, privateState.secret],
  card_pin: ({ privateState }: { privateState: CardPrivateState }) => [privateState, privateState.pin],
  card_salt: ({ privateState }: { privateState: CardPrivateState }) => [privateState, privateState.salt],
  auth_amount: ({ privateState }: { privateState: CardPrivateState }) => [privateState, privateState.authAmount],
  auth_index: ({ privateState }: { privateState: CardPrivateState }) => [privateState, privateState.authIndex],
};

export const bytes32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

export class MaskCardSimulator {
  readonly contract: Contract<CardPrivateState>;
  circuitContext: CircuitContext<CardPrivateState>;

  constructor(initial: CardPrivateState) {
    this.contract = new Contract<CardPrivateState>(witnesses as never);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext(initial, '0'.repeat(64)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  as(s: Partial<CardPrivateState>): this {
    this.circuitContext.currentPrivateState = { ...this.circuitContext.currentPrivateState, ...s };
    return this;
  }

  ledger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  create(kind: CredentialKind, spendLimit: bigint): Uint8Array {
    const r = this.contract.impureCircuits.create_credential(this.circuitContext, kind, spendLimit);
    this.circuitContext = r.context;
    return r.result;
  }

  authorise(kind: CredentialKind): Uint8Array {
    const r = this.contract.impureCircuits.authorise(this.circuitContext, kind);
    this.circuitContext = r.context;
    return r.result;
  }

  deactivate(kind: CredentialKind): void {
    const r = this.contract.impureCircuits.deactivate(this.circuitContext, kind);
    this.circuitContext = r.context;
  }

  isActive(commitment: Uint8Array): boolean {
    const r = this.contract.impureCircuits.credential_active(this.circuitContext, commitment);
    this.circuitContext = r.context;
    return r.result;
  }

  authUsed(nullifier: Uint8Array): boolean {
    const r = this.contract.impureCircuits.authorisation_used(this.circuitContext, nullifier);
    this.circuitContext = r.context;
    return r.result;
  }
}
