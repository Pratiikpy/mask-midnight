// Progress for an on-chain action.
//
// A Midnight transaction takes 25–60 seconds on the measured devnet, almost
// all of it inside the proof server. An indeterminate spinner for that long
// reads as a hang, and users close the tab.
//
// So the four real stages are named and shown as they happen, with a running
// clock and an honest estimate. The estimate comes from measurements in
// docs/MIDNIGHT_CONTRACT_STATUS.md, not from a guess, and the UI says
// "usually about Xs" rather than pretending to know.

import { useEffect, useState } from 'react';
import { EXPECTED_PROOF_SECONDS } from '../lib/config.ts';
import { useMask } from '../providers/MaskProvider.tsx';

export type Stage = 'idle' | 'proving' | 'balancing' | 'submitting' | 'confirming' | 'done' | 'failed';

const ORDER: Stage[] = ['proving', 'balancing', 'submitting', 'confirming'];

const COPY: Record<string, { title: string; detail: string }> = {
  proving: {
    title: 'Generating proof',
    detail: 'Your machine is proving the payment is valid without revealing the amount.',
  },
  balancing: {
    title: 'Wallet balancing',
    detail: 'Lace is selecting coins and signing.',
  },
  submitting: {
    title: 'Submitting',
    detail: 'Broadcasting to the node.',
  },
  confirming: {
    title: 'Confirming',
    detail: 'Waiting for the indexer to see it on chain.',
  },
};

export function ProofProgress({
  stage,
  circuit,
  startedAt,
  error,
}: {
  stage: Stage;
  circuit: string;
  startedAt: number | null;
  error?: string | null;
}) {
  const [, force] = useState(0);
  const { mode } = useMask();

  // The clock is the reassurance. Tick it while anything is in flight.
  useEffect(() => {
    if (stage === 'idle' || stage === 'done' || stage === 'failed') return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  if (stage === 'idle') return null;

  const seconds = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const expected = EXPECTED_PROOF_SECONDS[circuit] ?? 30;
  const currentIndex = ORDER.indexOf(stage);

  if (stage === 'failed') {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
        <p className="text-sm font-semibold text-danger">Rejected</p>
        <p className="mt-1 text-sm text-ink-dim">{error ?? 'The transaction was rejected.'}</p>
        <p className="mt-3 text-xs text-ink-faint">
          Nothing was submitted and nothing was spent — the check failed on your own machine,
          before the transaction left it.
        </p>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="rounded-2xl border border-aurora/30 bg-aurora/5 p-5">
        <p className="text-sm font-semibold text-aurora">
          {mode === 'demo' ? 'Accepted by the contract' : 'Confirmed on chain'}
        </p>
        <p className="mt-1 text-sm text-ink-dim">
          {mode === 'demo'
            ? 'Run in this browser against a simulated ledger. No proof was generated.'
            : `Took ${seconds}s.`}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-ink">{COPY[stage]?.title ?? 'Working'}</p>
        <p className="font-mono text-xs text-ink-faint">
          {seconds}s <span className="text-ink-faint/60">/ usually about {expected}s</span>
        </p>
      </div>

      <p className="mt-1 text-sm text-ink-dim">{COPY[stage]?.detail}</p>

      <div className="mt-4 flex gap-1.5">
        {ORDER.map((s, i) => (
          <div key={s} className="relative h-1 flex-1 overflow-hidden rounded-full bg-line">
            {i < currentIndex ? <div className="h-full w-full bg-aurora" /> : null}
            {i === currentIndex ? <div className="mask-sweep h-full w-full bg-aurora/25" /> : null}
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-between text-[11px] uppercase tracking-wider text-ink-faint">
        {ORDER.map((s, i) => (
          <span key={s} className={i <= currentIndex ? 'text-aurora' : undefined}>
            {s}
          </span>
        ))}
      </div>

      {seconds > expected * 1.5 ? (
        <p className="mt-4 text-xs text-ink-faint">
          Taking longer than usual. Proving is CPU-bound — it is still working. You can leave this
          tab; the payment completes on chain regardless.
        </p>
      ) : null}
    </div>
  );
}
