import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Card, Digest, ErrorNote, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { describeChainError, readLedger } from '../lib/chain.ts';
import { fromHex } from '../lib/format.ts';
import { KIND_LABEL, TOKEN_LABEL } from '../lib/invoice.ts';

interface PublicInvoice {
  status: number;
  kind: number;
  token: number;
  expiresAt: bigint;
  contributions: number;
}

const STATUS = ['open', 'settled', 'cancelled'] as const;
const TONE: Record<string, 'neutral' | 'aurora' | 'nova' | 'danger'> = {
  open: 'nova',
  settled: 'aurora',
  cancelled: 'danger',
};

/**
 * A shareable, public view of one invoice.
 *
 * Anyone can open this and check that an invoice is real and whether it
 * settled. There is nothing to protect here, because there is nothing
 * sensitive on chain to show.
 */
export function InvoicePage() {
  const { hash } = useParams<{ hash: string }>();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) {
      setError('That is not a valid invoice commitment.');
      setLoading(false);
      return;
    }
    try {
      const ledger = await readLedger();
      const key = fromHex(hash);
      if (!ledger.invoices.member(key)) {
        setError('No invoice with that commitment exists on this contract.');
        setLoading(false);
        return;
      }

      const raw = ledger.invoices.lookup(key);
      setInvoice({
        status: raw.status,
        kind: raw.kind,
        token: raw.token,
        expiresAt: raw.expires_at,
        contributions: Number(raw.contributions),
      });
      setError(null);
    } catch (e) {
      setError(describeChainError(e));
    } finally {
      setLoading(false);
    }
  }, [hash]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = invoice ? (STATUS[invoice.status] ?? 'unknown') : 'unknown';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Invoice" accent="record">
        The public record. Anyone can check this without a wallet and without trusting us.
      </PageHeader>
      <Card className="p-6 sm:p-8">

        {hash ? (
          <div className="mt-4">
            <Digest label="commitment" value={hash} />
          </div>
        ) : null}

        {loading ? <p className="mask-pulse mt-5 text-sm text-ink-dim">Reading the chain…</p> : null}
        {error ? (
          <div className="mt-5">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}

        {invoice ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              { k: 'Status', v: label, badge: true },
              { k: 'Type', v: KIND_LABEL[invoice.kind] ?? String(invoice.kind), badge: false },
              { k: 'Asset', v: TOKEN_LABEL[invoice.token] ?? String(invoice.token), badge: false },
              { k: 'Payments received', v: String(invoice.contributions), badge: false },
              {
                k: 'Expires',
                v:
                  invoice.expiresAt === 0n
                    ? 'never'
                    : new Date(Number(invoice.expiresAt) * 1000).toLocaleString(),
                badge: false,
              },
              { k: 'Amount', v: 'not on chain', badge: false },
            ].map((row) => (
              <div key={row.k} className="rounded-xl border border-line bg-surface-2 p-4">
                <p className="text-[11px] uppercase tracking-wider text-ink-faint">{row.k}</p>
                {row.badge ? (
                  <div className="mt-2">
                    <Badge tone={TONE[label] ?? 'neutral'}>{row.v}</Badge>
                  </div>
                ) : (
                  <p className="mt-1 text-sm">{row.v}</p>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="p-6">
        <PrivacyNote>
          This page shows everything the chain knows about this invoice. The amount, the merchant
          and the payer are not among it — they were never published.
        </PrivacyNote>
      </Card>
    </div>
  );
}
