import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, PageHeader, PrivacyNote } from '../components/ui.tsx';
import { describeChainError, readLedger, type MaskLedger } from '../lib/chain.ts';
import { fromHex, shortHex, toHex } from '../lib/format.ts';
import { KIND_LABEL, TOKEN_LABEL } from '../lib/invoice.ts';

interface Row {
  commitment: string;
  status: number;
  kind: number;
  token: number;
  contributions: number;
  expiresAt: bigint;
}

interface Snapshot {
  rows: Row[];
  receipts: string[];
  counts: { created: bigint; open: number; settled: number; cancelled: number; receipts: number; attestations: number; refunds: number };
}

const STATUS = ['open', 'settled', 'cancelled'] as const;
const STATUS_TONE = { open: 'neutral', settled: 'aurora', cancelled: 'danger' } as const;
const SHOWN = 50;

type Filter = 'all' | 'open' | 'settled';
type Found =
  | { kind: 'invoice'; status: number; contributions: number }
  | { kind: 'receipt' }
  | { kind: 'none' }
  | { kind: 'bad' };

function lookup(ledger: MaskLedger, query: string): Found {
  const hex = query.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return { kind: 'bad' };
  const key = fromHex(hex);
  if (ledger.invoices.member(key)) {
    const v = ledger.invoices.lookup(key);
    return { kind: 'invoice', status: v.status, contributions: Number(v.contributions) };
  }
  if (ledger.receipts.member(key)) return { kind: 'receipt' };
  return { kind: 'none' };
}

export function ExplorerPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [ledger, setLedger] = useState<MaskLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const l = await readLedger();
      setLedger(l);

      const rows: Row[] = [];
      const byStatus = [0, 0, 0];
      for (const [key, value] of l.invoices as unknown as Iterable<[Uint8Array, Row & Record<string, unknown>]>) {
        const v = value as unknown as { status: number; kind: number; token: number; contributions: bigint; expires_at: bigint };
        byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
        if (rows.length < SHOWN) {
          rows.push({
            commitment: toHex(key),
            status: v.status,
            kind: v.kind,
            token: v.token,
            contributions: Number(v.contributions),
            expiresAt: v.expires_at,
          });
        }
      }

      const receipts: string[] = [];
      for (const r of l.receipts) {
        if (receipts.length < 8) receipts.push(toHex(r));
      }

      setSnap({
        rows,
        receipts,
        counts: {
          created: l.created,
          open: byStatus[0]!,
          settled: byStatus[1]!,
          cancelled: byStatus[2]!,
          receipts: Number(l.receipts.size()),
          attestations: Number(l.attestations.size()),
          refunds: Number(l.refunded.size()),
        },
      });
    } catch (e) {
      setError(describeChainError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (!snap) return [];
    if (filter === 'all') return snap.rows;
    return snap.rows.filter((r) => STATUS[r.status] === filter);
  }, [snap, filter]);

  function search() {
    if (!ledger || !query.trim()) return;
    setFound(lookup(ledger, query));
  }

  const stats = snap
    ? [
        { label: 'Invoices created', value: snap.counts.created.toString() },
        { label: 'Open', value: snap.counts.open },
        { label: 'Settled', value: snap.counts.settled },
        { label: 'Payment receipts', value: snap.counts.receipts },
        { label: 'Revenue attestations', value: snap.counts.attestations },
        { label: 'Refunds', value: snap.counts.refunds },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Pay privately." accent="Nullify the trace.">
        Everything the chain publicly knows about this contract, which is deliberately not very much.
      </PageHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="mx-auto mb-10 max-w-2xl"
        role="search"
      >
        <div className="flex items-center gap-2 rounded-full border border-line-bright bg-surface/80 p-2 pl-5 backdrop-blur focus-within:border-aurora">
          <Search className="h-4 w-4 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFound(null);
            }}
            placeholder="Paste an invoice commitment or a payment receipt"
            aria-label="Search the ledger"
            className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none placeholder:font-sans placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={!ledger || !query.trim()}
            className="rounded-full bg-nova px-5 py-2 text-xs font-semibold text-ground transition hover:brightness-110 disabled:bg-line disabled:text-ink-faint"
          >
            Search
          </button>
        </div>
        {found ? (
          <p role="status" className="mt-3 text-center text-sm text-ink-dim">
            {found.kind === 'invoice' ? (
              <>
                Invoice found: <strong className="text-aurora">{STATUS[found.status]}</strong>
                {found.contributions > 0 ? `, ${found.contributions} payment${found.contributions === 1 ? '' : 's'}` : ''}. No amount is
                recorded.
              </>
            ) : found.kind === 'receipt' ? (
              <>A payment receipt. A payment happened; the ledger holds no amount and no payer.</>
            ) : found.kind === 'none' ? (
              <>Nothing on this ledger matches that value.</>
            ) : (
              <span className="text-danger">That is not a 64-character hex value.</span>
            )}
          </p>
        ) : null}
      </form>

      {error ? (
        <div className="mb-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      {snap ? (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <Card key={s.label} className="p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{s.label}</p>
              <p className="font-display mt-2 text-5xl tracking-tight">{s.value}</p>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="mask-pulse h-2 w-2 rounded-full bg-aurora" />
            Invoices
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex rounded-full border border-line bg-ground/40 p-1">
              {(['all', 'open', 'settled'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                    filter === f ? 'bg-surface-2 text-ink' : 'text-ink-faint hover:text-ink'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <Button variant="ghost" className="px-4 py-2 text-xs" onClick={() => void load()} disabled={loading}>
              {loading ? 'Reading…' : 'Refresh'}
            </Button>
          </div>
        </div>

        {!snap ? (
          <p className="p-6 text-sm text-ink-dim">{loading ? 'Reading the ledger…' : 'Nothing loaded.'}</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-sm text-ink-dim">
            {snap.rows.length === 0 ? 'No invoices yet.' : 'Nothing matches that filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" aria-label="Invoices on the ledger">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                  <th className="px-6 py-3 font-semibold">Commitment</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Type</th>
                  <th className="px-3 py-3 font-semibold">Asset</th>
                  <th className="px-3 py-3 text-right font-semibold">Payments</th>
                  <th className="px-6 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.commitment} className="border-t border-line/60">
                    <td className="px-6 py-3 font-mono text-xs text-ink-dim">{shortHex(r.commitment, 14, 8)}</td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONE[STATUS[r.status] ?? 'open']}>{STATUS[r.status]}</Badge>
                    </td>
                    <td className="px-3 py-3 text-ink-dim">{KIND_LABEL[r.kind]}</td>
                    <td className="px-3 py-3 text-ink-dim">{TOKEN_LABEL[r.token]}</td>
                    <td className="px-3 py-3 text-right text-ink-dim">{r.contributions}</td>
                    <td className="px-6 py-3 text-right text-ink-faint">hidden</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {snap && snap.rows.length >= SHOWN ? (
          <p className="border-t border-line px-6 py-3 text-xs text-ink-faint">Showing the first {SHOWN}.</p>
        ) : null}
      </Card>

      {snap ? (
        <Card className="mb-6 p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-dim">Payment receipts</h2>
            <Badge tone="aurora">{snap.receipts.length}</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-faint">Proof that payments happened. Not who paid and not how much.</p>
          <div className="mt-4 space-y-2">
            {snap.receipts.length === 0 ? (
              <p className="text-sm text-ink-dim">No payments yet.</p>
            ) : (
              snap.receipts.map((r) => (
                <p key={r} className="font-mono text-xs text-ink-dim">
                  {shortHex(r, 20, 12)}
                </p>
              ))
            )}
          </div>
        </Card>
      ) : null}

      <Card className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-dim">
          What an explorer cannot show you
        </h2>
        <div className="mt-4 space-y-3">
          <PrivacyNote>
            No amounts. Not for a single invoice, not in aggregate. The chain holds none.
          </PrivacyNote>
          <PrivacyNote>
            No merchants and no payers. Identities are commitments, not addresses.
          </PrivacyNote>
          <PrivacyNote>
            A receipt can be paired with the invoice commitment it settled, because one transaction
            publishes both. The commitment is an opaque hash, so the pairing reveals no amount,
            payer or merchant.
          </PrivacyNote>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-ink-faint">
          On a quiet chain, timing also correlates a creation with the settlement that follows it.
          That is mitigated by volume, not by cryptography, and it would be dishonest to claim
          otherwise.
        </p>
      </Card>
    </div>
  );
}
