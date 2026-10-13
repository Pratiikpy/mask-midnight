import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { describeChainError, readLedger } from '../lib/chain.ts';
import { fromHex } from '../lib/format.ts';

type Result =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'found'; label: string; detail: string }
  | { kind: 'absent'; detail: string }
  | { kind: 'error'; message: string };

export function VerifyPage() {
  const { connection } = useMask();
  const [digest, setDigest] = useState('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  const valid = /^[0-9a-fA-F]{64}$/.test(digest.trim());

  async function check() {
    setResult({ kind: 'checking' });
    try {
      // readLedger reports a missing contract and an unreachable indexer itself.
      const ledger = await readLedger();
      const digestBytes = fromHex(digest.trim());

      if (ledger.invoices.member(digestBytes)) {
        const status = ledger.invoices.lookup(digestBytes).status;
        setResult({
          kind: 'found',
          label: 'invoice',
          detail:
            status === 1
              ? 'This invoice is settled. The amount it settled for is not on chain.'
              : status === 2
                ? 'This invoice was cancelled before anyone paid.'
                : 'This invoice is open and awaiting settlement.',
        });
        return;
      }

      if (ledger.receipts.member(digestBytes)) {
        setResult({
          kind: 'found',
          label: 'receipt',
          detail:
            'A payment really happened. Who paid and how much are absent from the chain. The transaction that published this receipt also touched an invoice commitment, which is an opaque hash.',
        });
        return;
      }

      if (ledger.attestations.member(digestBytes)) {
        setResult({
          kind: 'found',
          label: 'attestation',
          detail:
            'A merchant proved a revenue claim and the chain accepted the proof. The revenue itself was never published.',
        });
        return;
      }

      setResult({
        kind: 'absent',
        detail:
          'Nothing on chain matches this digest. It may belong to a different contract, or never have been published.',
      });
    } catch (e) {
      setResult({ kind: 'error', message: describeChainError(e) });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Verify a" accent="payment">
        Check a receipt, an invoice commitment or a revenue attestation against the chain. No wallet needed to read.
      </PageHeader>
      <Card className="p-6">

        <div className="mt-6 space-y-4">
          <Field
            label="Digest"
            hint={
              digest && !valid ? (
                <span className="text-danger">Expected 64 hex characters.</span>
              ) : (
                'A 32-byte value, as hex.'
              )
            }
          >
            <Input
              value={digest}
              onChange={(e) => setDigest(e.target.value)}
              placeholder="fd6993cf63c635d3…"
              className="font-mono"
              spellCheck={false}
            />
          </Field>

          <Button onClick={() => void check()} disabled={!valid} className="w-full">
            Check on chain
          </Button>

          {result.kind === 'checking' ? (
            <p className="mask-pulse text-sm text-ink-dim">Reading contract state…</p>
          ) : null}

          {result.kind === 'found' ? (
            <div className="rounded-2xl border border-aurora/30 bg-aurora/5 p-5">
              <Badge tone="aurora">{result.label}</Badge>
              <p className="mt-2 text-sm text-ink-dim">{result.detail}</p>
            </div>
          ) : null}

          {result.kind === 'absent' ? (
            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <Badge>not found</Badge>
              <p className="mt-2 text-sm text-ink-dim">{result.detail}</p>
            </div>
          ) : null}

          {result.kind === 'error' ? <ErrorNote>{result.message}</ErrorNote> : null}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          What a verification proves
        </h2>
        <div className="mt-4 space-y-3">
          <PrivacyNote>
            <strong className="text-ink-dim">Receipt found.</strong> A payment really happened. It
            does not say who paid or how much. The transaction that published it also touched an
            invoice commitment, an opaque hash an observer can pair with it.
          </PrivacyNote>
          <PrivacyNote>
            <strong className="text-ink-dim">Invoice settled.</strong> That specific invoice is
            closed. The amount stays hidden.
          </PrivacyNote>
          <PrivacyNote>
            <strong className="text-ink-dim">Attestation found.</strong> A merchant proved a revenue
            claim and the chain accepted the proof. The revenue itself is not on chain.
          </PrivacyNote>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-ink-faint">
          Reads go straight to the indexer, so anyone can verify without trusting this app.
          {connection.status === 'connected' ? '' : ' No wallet is required.'}
        </p>
      </Card>
    </div>
  );
}
