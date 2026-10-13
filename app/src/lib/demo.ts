// Demo mode: the real compiled circuits, run in the browser against a simulated
// ledger. No wallet, no proof server, no network.
//
// This executes the same Compact contract the chain runs, through the same
// compact-runtime, so every assertion fires exactly as it would on chain: a
// forged amount, a replayed payment and an expired invoice are all refused with
// the contract's own messages. What it does not do is generate a zero-knowledge
// proof or touch a chain — the UI says so wherever demo mode is active.
//
// State lives in memory for the life of the page. Reloading starts a fresh
// ledger, because the secrets that would let it be replayed are not stored.

import {
  CostModel,
  QueryContext,
  createConstructorContext,
  ecMulGenerator,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import * as MaskPay from '../../../contracts/build/mask_pay/contract/index.js';
import { emptyPrivateState, witnesses, type MaskPrivateState } from './contract.ts';
import type { MaskLedger } from './chain.ts';

/** Marker carried by the stand-in providers object, so callers can tell the modes apart. */
export interface DemoProviders {
  readonly __demo: true;
}

export const demoProviders: DemoProviders = Object.freeze({ __demo: true as const });

export const isDemoProviders = (p: unknown): p is DemoProviders =>
  typeof p === 'object' && p !== null && (p as { __demo?: unknown }).__demo === true;

/** Reference-asset colours for the simulated ledger: distinct from each other and from native. */
const DEMO_COLORS = {
  musdc: new Uint8Array(32).fill(0xc1),
  musad: new Uint8Array(32).fill(0xc2),
};

type ImpureCircuit = (ctx: CircuitContext<MaskPrivateState>, ...args: unknown[]) => {
  context: CircuitContext<MaskPrivateState>;
  result: unknown;
};

export interface DemoCallResult {
  private: { result: unknown };
  public: { txId: string; blockHeight: number };
}

class DemoChain {
  private contract = new MaskPay.Contract<MaskPrivateState>(witnesses as never);
  private ctx: CircuitContext<MaskPrivateState> = this.fresh();
  private height = 0;
  private listeners = new Set<() => void>();

  private fresh(): CircuitContext<MaskPrivateState> {
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(emptyPrivateState(), '0'.repeat(64)),
        ecMulGenerator(7n),
        DEMO_COLORS.musdc,
        DEMO_COLORS.musad,
      );
    return {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  /** Throw the simulated chain away and start from an empty ledger. */
  reset(): void {
    this.ctx = this.fresh();
    this.height = 0;
    this.notify();
  }

  /**
   * Run one circuit as the party whose private state is given.
   *
   * A failed assertion throws before the ledger is touched, which is what makes
   * a refused payment leave no trace — the same as on chain.
   */
  async call(
    circuit: string,
    privateState: MaskPrivateState,
    args: unknown[],
  ): Promise<DemoCallResult> {
    const fn = (this.contract.impureCircuits as unknown as Record<string, ImpureCircuit>)[circuit];
    if (!fn) throw new Error(`Unknown circuit: ${circuit}`);

    const before = { ...this.ctx, currentPrivateState: privateState };
    // Let the interface paint its "proving" state before the synchronous
    // circuit run takes the main thread.
    await new Promise((r) => setTimeout(r, 60));

    let res: ReturnType<ImpureCircuit>;
    try {
      res = fn(before, ...args);
    } catch (e) {
      // The runtime wraps assertion failures; keep the contract's own message.
      throw new Error(e instanceof Error ? e.message : String(e));
    }

    this.ctx = res.context;
    this.height += 1;
    this.notify();
    return {
      private: { result: res.result },
      public: { txId: `demo-${this.height.toString(16).padStart(6, '0')}`, blockHeight: this.height },
    };
  }

  ledger(): MaskLedger {
    return MaskPay.ledger(this.ctx.currentQueryContext.state) as unknown as MaskLedger;
  }

  blockHeight(): number {
    return this.height;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export const demoChain = new DemoChain();

/** True once demo mode has been switched on for this page. */
let demoActive = false;
export const setDemoActive = (on: boolean): void => {
  demoActive = on;
};
export const isDemoActive = (): boolean => demoActive;
