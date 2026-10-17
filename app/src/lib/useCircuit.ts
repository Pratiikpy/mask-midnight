// Run a circuit and report which stage it is actually in.
//
// midnight-js does not emit progress events, so the stages are taken from the
// providers themselves: proofProvider.proveTx, walletProvider.balanceTx and
// midnightProvider.submitTx each fire as they are entered. That gives the UI
// the real phase rather than a guess, which matters when the whole thing takes
// half a minute.

import { useCallback, useRef, useState } from 'react';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Stage } from '../components/ProofProgress.tsx';
import { demoChain, isDemoProviders } from './demo.ts';
import {
  MaskPayContract,
  PRIVATE_STATE_ID,
  type MaskPrivateState,
} from './contract.ts';

/** Wrap providers so each stage transition is observable. */
export function instrument(
  providers: Record<string, unknown>,
  onStage: (s: Stage) => void,
): Record<string, unknown> {
  const proof = providers.proofProvider as { proveTx: (...a: unknown[]) => Promise<unknown> };
  const wallet = providers.walletProvider as { balanceTx: (...a: unknown[]) => Promise<unknown> };
  const midnight = providers.midnightProvider as { submitTx: (...a: unknown[]) => Promise<unknown> };

  return {
    ...providers,
    proofProvider: {
      ...proof,
      proveTx: async (...args: unknown[]) => {
        onStage('proving');
        return proof.proveTx(...args);
      },
    },
    walletProvider: {
      ...wallet,
      balanceTx: async (...args: unknown[]) => {
        onStage('balancing');
        return wallet.balanceTx(...args);
      },
    },
    midnightProvider: {
      ...midnight,
      submitTx: async (...args: unknown[]) => {
        onStage('submitting');
        const r = await midnight.submitTx(...args);
        onStage('confirming');
        return r;
      },
    },
  };
}

export interface CircuitRun {
  stage: Stage;
  startedAt: number | null;
  error: string | null;
  result: unknown;
  run: (
    circuit: string,
    privateState: MaskPrivateState,
    args: unknown[],
  ) => Promise<unknown>;
  reset: () => void;
}

export function useCircuit(
  providers: Record<string, unknown> | null,
  contractAddress: string | undefined,
): CircuitRun {
  const [stage, setStage] = useState<Stage>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const joined = useRef<unknown>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setError(null);
    setResult(null);
    setStartedAt(null);
  }, []);

  const run = useCallback(
    async (circuit: string, privateState: MaskPrivateState, args: unknown[]) => {
      if (!providers) throw new Error('Connect a wallet first.');
      const demo = isDemoProviders(providers);
      if (!contractAddress && !demo) {
        throw new Error(
          'No contract address configured. Run the devkit deploy script, then restart the app.',
        );
      }

      setError(null);
      setResult(null);
      setStartedAt(Date.now());
      setStage('proving');

      try {
        if (demo) {
          const out = await demoChain.call(circuit, privateState, args);
          setResult(out);
          setStage('done');
          return out;
        }

        const wired = instrument(providers, setStage);

        // findDeployedContract installs `initialPrivateState` in the provider,
        // replacing whatever is stored. Setting the invoice's terms first and
        // joining second therefore ran the first circuit of every page load
        // against an empty state: amount 0, so an invoice was committed with
        // amount 0, and paying it failed with "coin value does not match".
        // Join first, then set the terms for this call.
        if (!joined.current) {
          joined.current = await findDeployedContract(wired as never, {
            contractAddress: contractAddress as string,
            compiledContract: MaskPayContract,
            privateStateId: PRIVATE_STATE_ID,
            initialPrivateState: privateState,
          } as never);
        }

        // Private state is set immediately before the call, because each
        // circuit needs the terms of one specific invoice.
        await (wired.privateStateProvider as {
          set(id: string, s: MaskPrivateState): Promise<void>;
        }).set(PRIVATE_STATE_ID, privateState);

        const callTx = (joined.current as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> })
          .callTx;
        const fn = callTx[circuit];
        if (!fn) throw new Error(`Unknown circuit: ${circuit}`);

        const out = await fn(...args);
        setResult(out);
        setStage('done');
        return out;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(cleanMessage(message));
        setStage('failed');
        throw e;
      }
    },
    [providers, contractAddress],
  );

  return { stage, startedAt, error, result, run, reset };
}

/**
 * Surface the contract's own assert message rather than the SDK's wrapper.
 *
 * A failed assert is the product working — the user should see "invoice is not
 * open", not a stack of transaction plumbing.
 */
function cleanMessage(raw: string): string {
  const assertMatch = /failed assert:\s*(.+?)(?:\n|$)/i.exec(raw);
  if (assertMatch?.[1]) return assertMatch[1].trim();
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}
