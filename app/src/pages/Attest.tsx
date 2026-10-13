import { useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { ProofProgress, type Stage } from '../components/ProofProgress.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { formatAmount, parseAmount } from '../lib/format.ts';
import { TOKEN_LABEL, loadInvoices } from '../lib/invoice.ts';

const BATCH = 4;

export function AttestPage() {
  const { connection, connect } = useMask();
  const [threshold, setThreshold] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only settled invoices have a receipt on the tree to prove membership of.
  const eligible = useMemo(() => loadInvoices().filter((i) => i.status === 'settled'), []);

  const trueTotal = useMemo(
    () =>
      eligible
        .filter((i) => selected.includes(i.salt))
        .reduce((sum, i) => sum + BigInt(i.amount), 0n),
    [eligible, selected],
  );

  const parsedThreshold = useMemo(() => parseAmount(threshold), [threshold]);
  const enoughSelected = selected.length === BATCH;
  const claimHolds = parsedThreshold !== null && parsedThreshold <= trueTotal;
  const canAttest = enoughSelected && parsedThreshold !== null && parsedThreshold > 0n && claimHolds;

  function toggle(salt: string) {
    setSelected((cur) =>
      cur.includes(salt)
        ? cur.filter((s) => s !== salt)
        : cur.length >= BATCH
          ? cur
          : [...cur, salt],
    );
  }

  async function attest() {
    setError(null);
    setStartedAt(Date.now());
    try {
      setStage('proving');
      throw new Error(
        'No contract address configured. Deploy mask_pay and set VITE_CONTRACT_ADDRESS.',
      );
    } catch (e) {
      setStage('failed');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Prove" accent="revenue">
        Show an accountant, a lender or a regulator that you earned at least a given amount — without showing them what you actually earned.
      </PageHeader>
      <Card className="p-6">

        <div className="mt-6 space-y-5">
          <Field
            label={`Select exactly ${BATCH} settled payments`}
            hint={`${selected.length} of ${BATCH} selected. A circuit cannot loop over a variable number of items, so the batch size is fixed.`}
          >
            {eligible.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-dim">
                No settled payments yet. Settle some invoices first — an attestation is only
                meaningful over payments that actually happened.
              </p>
            ) : (
              <div className="space-y-2">
                {eligible.map((inv) => {
                  const on = selected.includes(inv.salt);
                  return (
                    <button
                      key={inv.salt}
                      type="button"
                      onClick={() => toggle(inv.salt)}
                      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                        on ? 'border-aurora bg-aurora/5' : 'border-line hover:border-line-bright'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {inv.title || 'Untitled invoice'}
                        </span>
                        <span className="block text-xs text-ink-faint">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </span>
                      </span>
                      <span className="ml-4 shrink-0 text-sm">
                        {formatAmount(BigInt(inv.amount))}{' '}
                        <span className="text-ink-dim">{TOKEN_LABEL[inv.token]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {enoughSelected ? (
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <p className="text-xs uppercase tracking-wider text-ink-faint">
                True total (this device only)
              </p>
              <p className="mt-1 text-lg font-semibold">{formatAmount(trueTotal)}</p>
              <p className="mt-1 text-xs text-ink-faint">
                Shown so you can pick a threshold. It is never published.
              </p>
            </div>
          ) : null}

          <Field
            label="Claim: revenue is at least"
            hint={
              parsedThreshold !== null && enoughSelected && !claimHolds ? (
                <span className="text-danger">
                  Above your true total — the contract would reject this, so the button stays off.
                </span>
              ) : (
                'This number is the only one that becomes public.'
              )
            }
          >
            <Input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="100000"
              inputMode="numeric"
            />
          </Field>

          {connection.status === 'connected' ? (
            <Button onClick={() => void attest()} disabled={!canAttest} className="w-full">
              Publish attestation
            </Button>
          ) : (
            <Button onClick={() => void connect()} className="w-full">
              Connect wallet to attest
            </Button>
          )}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <ProofProgress
            stage={stage}
            circuit="attest_revenue_at_least"
            startedAt={startedAt}
            error={error}
          />
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Badge tone="aurora">selective disclosure</Badge>
        </div>
        <h2 className="mt-4 text-sm font-semibold uppercase tracking-wider text-ink-dim">
          What the verifier learns
        </h2>
        <div className="mt-4 space-y-3">
          <PrivacyNote>The threshold you claimed, and that the chain accepted the proof.</PrivacyNote>
          <PrivacyNote>
            That every payment counted is a real payment already recorded on chain.
          </PrivacyNote>
        </div>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-ink-dim">
          What stays hidden
        </h2>
        <div className="mt-4 space-y-3">
          <PrivacyNote>Your actual revenue. Only the threshold is published.</PrivacyNote>
          <PrivacyNote>Every individual amount.</PrivacyNote>
          <PrivacyNote>Which payments you counted, and who made them.</PrivacyNote>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          Inflating an amount, inventing a payment, counting one payment twice, or attesting to
          someone else's revenue are all rejected by the contract — each is covered by a test.
        </p>
      </Card>
    </div>
  );
}
