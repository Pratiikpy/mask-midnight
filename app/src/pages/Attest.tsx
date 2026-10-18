import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Digest, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { ProofProgress } from '../components/ProofProgress.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { formatAmount, fromHex, parseAmount, toHex } from '../lib/format.ts';
import { KIND_LABEL, TOKEN_LABEL, loadInvoices, type InvoiceRecord } from '../lib/invoice.ts';
import { readLedger, describeChainError } from '../lib/chain.ts';
import { CONTRACT_ADDRESS } from '../lib/config.ts';
import { emptyPrivateState } from '../lib/contract.ts';
import { decodeRefundCode, type RefundCode } from '../lib/refund.ts';
import { syncInvoiceStatuses } from '../lib/sync.ts';
import { useCircuit } from '../lib/useCircuit.ts';

const BATCH = 4;

export function AttestPage() {
  const { providers, connection, connect } = useMask();
  const circuit = useCircuit(providers as Record<string, unknown> | null, CONTRACT_ADDRESS);
  const [threshold, setThreshold] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(() => loadInvoices());
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);

  // Only settled invoices have a receipt on the tree to prove membership of.
  // Settlement happens in the payer's browser, so read it back from the chain.
  const refresh = useCallback(async () => {
    if (await syncInvoiceStatuses()) setInvoices(loadInvoices());
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 6_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const eligible = useMemo(() => invoices.filter((i) => i.status === 'settled'), [invoices]);
  const chosen = useMemo(
    () => selected.map((salt) => eligible.find((i) => i.salt === salt)).filter((i): i is InvoiceRecord => !!i),
    [eligible, selected],
  );
  const trueTotal = useMemo(() => chosen.reduce((sum, i) => sum + BigInt(i.amount), 0n), [chosen]);

  // Each payment needs the evidence only its payer holds: the payer key, the
  // payment index and the receipt. The payer's payment code carries all three.
  const decoded = useMemo(() => {
    const out: Record<string, RefundCode | null> = {};
    for (const i of chosen) out[i.salt] = codes[i.salt] ? decodeRefundCode(codes[i.salt]) : null;
    return out;
  }, [chosen, codes]);
  const missing = chosen.filter((i) => !decoded[i.salt]);
  const withoutReceipt = chosen.filter((i) => decoded[i.salt] && !decoded[i.salt]!.receipt);
  const uniform = chosen.every((i) => i.kind === chosen[0]!.kind && i.token === chosen[0]!.token);

  const parsedThreshold = useMemo(() => parseAmount(threshold), [threshold]);
  const enoughSelected = selected.length === BATCH;
  const claimHolds = parsedThreshold !== null && parsedThreshold <= trueTotal;
  const evidenceReady = enoughSelected && missing.length === 0 && withoutReceipt.length === 0;
  const canAttest =
    evidenceReady && uniform && parsedThreshold !== null && parsedThreshold > 0n && claimHolds;
  const proving = circuit.stage === 'proving' || circuit.stage === 'submitting';

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
    setDigest(null);
    circuit.reset();

    // The Merkle paths come from the ledger the indexer serves, not from a
    // local reconstruction: that is what ties each amount to a real payment.
    let state;
    try {
      const ledger = await readLedger();
      const paths = chosen.map((inv) => {
        const path = ledger.receipt_tree.findPathForLeaf(fromHex(decoded[inv.salt]!.receipt!));
        if (path === undefined) {
          throw new Error(
            `The receipt for "${inv.title || 'an invoice'}" is not on the chain yet. Wait for the payment to confirm, or check the code.`,
          );
        }
        return path;
      });
      state = {
        ...emptyPrivateState(),
        merchantKey: fromHex(chosen[0]!.merchantKey),
        attestedAmounts: chosen.map((i) => BigInt(i.amount)),
        attestedSalts: chosen.map((i) => fromHex(i.salt)),
        attestedPayers: chosen.map((i) => fromHex(decoded[i.salt]!.payerKey)),
        attestedIndices: chosen.map((i) => BigInt(decoded[i.salt]!.paymentIndex)),
        attestedPaths: paths,
      };
    } catch (e) {
      setError(describeChainError(e));
      return;
    }

    try {
      const out = (await circuit.run('attest_revenue_at_least', state, [
        chosen[0]!.kind,
        chosen[0]!.token,
        parsedThreshold!,
      ])) as { private: { result: Uint8Array } };
      setDigest(toHex(out.private.result));
    } catch {
      // useCircuit surfaces the contract's own message below.
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
            hint={`${selected.length} of ${BATCH} selected. A circuit cannot loop over a variable number of items, so the batch size is fixed. Each payment also needs the code its payer copied from their receipt: only the payer holds the key that names it.`}
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
                  const parsed = decoded[inv.salt];
                  const raw = codes[inv.salt] ?? '';
                  return (
                    <div key={inv.salt} className="space-y-2">
                      <button
                        type="button"
                        onClick={() => toggle(inv.salt)}
                        aria-pressed={on}
                        className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                          on ? 'border-aurora bg-aurora/5' : 'border-line hover:border-line-bright'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">
                            {inv.title || 'Untitled invoice'}
                          </span>
                          <span className="block text-xs text-ink-faint">
                            {new Date(inv.createdAt).toLocaleDateString()} · {KIND_LABEL[inv.kind]}
                          </span>
                        </span>
                        <span className="ml-4 shrink-0 text-sm">
                          {formatAmount(BigInt(inv.amount))}{' '}
                          <span className="text-ink-dim">{TOKEN_LABEL[inv.token]}</span>
                        </span>
                      </button>
                      {on ? (
                        <div className="pl-2">
                          <Input
                            value={raw}
                            onChange={(e) => setCodes((c) => ({ ...c, [inv.salt]: e.target.value }))}
                            placeholder="Paste this payment's code from the payer"
                            aria-label={`Payment code for ${inv.title || 'this invoice'}`}
                          />
                          {raw && !parsed ? (
                            <p className="mt-1 text-xs text-danger">That is not a payment code.</p>
                          ) : parsed && !parsed.receipt ? (
                            <p className="mt-1 text-xs text-danger">
                              This code was made before revenue proofs existed. Ask the payer to copy
                              it again from their receipt.
                            </p>
                          ) : parsed ? (
                            <p className="mt-1 text-xs text-aurora">Payment code accepted.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
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

          {enoughSelected && !uniform ? (
            <ErrorNote>All four payments must be the same kind of invoice and the same asset.</ErrorNote>
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
            <Button onClick={() => void attest()} disabled={!canAttest || proving} className="w-full">
              Publish attestation
            </Button>
          ) : (
            <Button onClick={() => void connect()} className="w-full">
              Connect wallet to attest
            </Button>
          )}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <ProofProgress
            stage={circuit.stage}
            circuit="attest_revenue_at_least"
            startedAt={circuit.startedAt}
            error={circuit.error}
          />

          {digest ? (
            <div className="rounded-2xl border border-aurora/40 bg-aurora/5 p-5">
              <Badge tone="aurora">attestation published</Badge>
              <p className="mt-3 text-sm text-ink-dim">
                The chain now holds a statement that this merchant's revenue over four payments is at
                least {formatAmount(parsedThreshold ?? 0n)} {TOKEN_LABEL[chosen[0]?.token ?? 0]}.
                Hand this digest to whoever needs to check it; they can verify it without a wallet.
              </p>
              <div className="mt-3">
                <Digest value={digest} label="digest" />
              </div>
              <p className="mt-3 break-all font-mono text-xs text-aurora">{digest}</p>
            </div>
          ) : null}
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
