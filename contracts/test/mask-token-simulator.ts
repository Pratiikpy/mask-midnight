// In-memory harness for mask_token.
//
// mask_token has no witnesses — everything it needs is either an argument or
// public ledger state — so the private state is empty. It is still threaded
// through because the runtime's circuit context requires one.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, type Ledger, ledger } from '../build/mask_token/contract/index.js';

export type TokenPrivateState = Record<string, never>;

export const bytes32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

/** A shielded coin as the circuits return and accept it. */
export interface ShieldedCoin {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

export class MaskTokenSimulator {
  readonly contract: Contract<TokenPrivateState>;
  circuitContext: CircuitContext<TokenPrivateState>;

  constructor(seed: Uint8Array = bytes32(0x5e)) {
    this.contract = new Contract<TokenPrivateState>({} as never);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext({}, '0'.repeat(64)), seed);
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  ledger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  mint(token: unknown, amount: bigint): ShieldedCoin {
    const r = this.contract.impureCircuits.mint(this.circuitContext, token, amount);
    this.circuitContext = r.context;
    return r.result as unknown as ShieldedCoin;
  }

  tokenColor(token: unknown): Uint8Array {
    const r = this.contract.impureCircuits.token_color(this.circuitContext, token);
    this.circuitContext = r.context;
    return r.result;
  }

  /** The zswap-side effects of everything called so far. */
  zswap(): unknown {
    return this.circuitContext.currentZswapLocalState;
  }
}
