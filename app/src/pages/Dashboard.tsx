import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Digest, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { ProofProgress } from '../components/ProofProgress.tsx';
import { formatAmount, fromHex, randomBytes, shortHex } from '../lib/format.ts';
import {
  InvoiceKind,
  KIND_LABEL,
  TOKEN_LABEL,
  forgetInvoice,
  loadInvoices,
  saveInvoice,
  shareLink,
  type InvoiceRecord,
} from '../lib/invoice.ts';
import { syncInvoiceStatuses } from '../lib/sync.ts';
import { CONTRACT_ADDRESS } from '../lib/config.ts';
import { privateStateFromTerms } from '../lib/contract.ts';
import { forgetPayment, loadPayments, type PaymentRecord } from '../lib/payments.ts';
import { coinForPayment } from '../lib/coin.ts';
import { decodeRefundCode } from '../lib/refund.ts';
import { useCircuit } from '../lib/useCircuit.ts';
import { useMask } from '../providers/MaskProvider.tsx';

const STATUS_TONE: Record<string, 'neutral' | 'aurora' | 'nova' | 'danger'> = {
  pending: 'nova',
  open: 'neutral',
  settled: 'aurora',
  cancelled: 'danger',
};

/**
 * Cancel or close one invoice.
 *
 * Authority is the per-invoice owner secret in this vault, which is not part of
 * the payment link. An invoice created before owner secrets existed has none, so
 * it cannot be managed, and the card says so instead of offering a button that
 * would fail.
 */
function InvoiceActions({ inv, onChanged }: { inv: InvoiceRecord; onChanged: () => void }) {
  const { providers, connection } = useMask();
  const circuit = useCircuit(providers as Record<string, unknown> | null, CONTRACT_ADDRESS);
  const connected = connection.status === 'connected';

  const finished = inv.status === 'settled' || inv.status === 'cancelled';
  // Keep the confirmation on screen after the action lands; only a card that
  // was already finished when the page loaded has nothing to show.
  if (!inv.commitment || (finished && circuit.stage !== 'done')) return null;

  if (!inv.ownerSecret && !finished) {
    return (
      <p className="w-full text-xs text-ink-faint">
        Created before ownership secrets existed, so it cannot be cancelled or closed.
      </p>
    );
  }

  const multi = inv.kind !== InvoiceKind.STANDARD;
  const label = multi ? 'Close' : 'Cancel';
  const circuitName = multi ? 'close_invoice' : 'cancel_invoice';

  async function act() {
    try {
      await circuit.run(
        circuitName,
        privateStateFromTerms(inv, randomBytes(32), fromHex(inv.ownerSecret!)),
        [inv.kind, inv.token],
      );
      saveInvoice({ ...inv, status: multi ? 'settled' : 'cancelled' });
      onChanged();
    } catch {
      // useCircuit surfaces the contract's own message below.
    }
  }

  return (
    <div className="w-full space-y-3">
      {finished ? null : (
      <Button
        variant="ghost"
        className="px-3 py-1.5 text-xs"
        disabled={!connected || circuit.stage === 'proving'}
        onClick={() => void act()}
        title={connected ? undefined : 'Connect a wallet or start the demo first'}
      >
        {label} invoice
      </Button>
      )}
      <ProofProgress
        stage={circuit.stage}
        circuit={circuitName}
        startedAt={circuit.startedAt}
        error={circuit.error}
      />
      {circuit.error && circuit.stage !== 'failed' ? <ErrorNote>{circuit.error}</ErrorNote> : null}
    </div>
  );
}

/**
 * Refund one payment.
 *
 * The merchant needs the payer's refund code to name the payment, and the owner
 * secret from this vault to authorise it. The refund is a shielded coin of
 * exactly the invoice amount, sent in the same transaction.
 */
function RefundAction({ inv }: { inv: InvoiceRecord }) {
  const { providers, connection } = useMask();
  const circuit = useCircuit(providers as Record<string, unknown> | null, CONTRACT_ADDRESS);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const connected = connection.status === 'connected';

  if (!inv.commitment || !inv.ownerSecret) return null;

  async function refund() {
    setError(null);
    circuit.reset();
    const parsed = decodeRefundCode(code);
    if (!parsed) {
      setError('That is not a refund code. Ask the payer to copy it again from their receipt.');
      return;
    }
    const coin = coinForPayment(inv.token, BigInt(inv.amount));
    if (!coin) {
      setError('That asset cannot be identified in this build.');
      return;
    }
    const state = privateStateFromTerms(inv, fromHex(parsed.payerKey), fromHex(inv.ownerSecret!));
    state.paymentIndex = BigInt(parsed.paymentIndex);
    try {
      await circuit.run('refund_payment', state, [
        inv.kind,
        inv.token,
        coin,
        { bytes: fromHex(parsed.payerAddr) },
      ]);
      setCode('');
    } catch {
      // useCircuit surfaces the contract's own message below.
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>
        Refund a payment
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
      <Field label="Refund code" hint="The payer copies this from their receipt and sends it to you.">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Paste the payer's refund code"
        />
      </Field>
      <div className="flex gap-2">
        <Button
          className="px-4 py-2 text-xs"
          disabled={!connected || !code.trim() || circuit.stage === 'proving'}
          onClick={() => void refund()}
        >
          Refund {formatAmount(BigInt(inv.amount))} {TOKEN_LABEL[inv.token]}
        </Button>
        <Button variant="ghost" className="px-4 py-2 text-xs" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <ProofProgress
        stage={circuit.stage}
        circuit="refund_payment"
        startedAt={circuit.startedAt}
        error={circuit.error}
      />
    </div>
  );
}

type View = 'stats' | 'dashboard';
type List = 'created' | 'paid';
type Filter = 'all' | 'open' | 'settled';

const DAY = 86_400_000;

/** Invoices created per day over the last fourteen days, oldest first. */
function perDay(invoices: InvoiceRecord[]): { label: string; count: number }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, k) => {
    const start = today.getTime() - (13 - k) * DAY;
    return {
      start,
      label: new Date(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      count: 0,
    };
  });
  for (const inv of invoices) {
    const d = days.find((x) => inv.createdAt >= x.start && inv.createdAt < x.start + DAY);
    if (d) d.count += 1;
  }
  return days;
}

function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-full border border-line-bright bg-surface/70 p-1"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-full px-6 py-2 text-sm font-semibold transition ${
            value === t.id ? 'bg-nova text-ground' : 'text-ink-dim hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{label}</p>
      <p className="font-display mt-2 text-5xl tracking-tight">{value}</p>
    </Card>
  );
}

function totalsByToken(rows: { token: number; amount: string }[]): Map<number, bigint> {
  const m = new Map<number, bigint>();
  for (const r of rows) {
    try {
      m.set(r.token, (m.get(r.token) ?? 0n) + BigInt(r.amount));
    } catch {
      /* skip malformed */
    }
  }
  return m;
}

function Totals({ title, totals }: { title: string; totals: Map<number, bigint> }) {
  return (
    <Card className="p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">{title}</p>
      <div className="mt-3 space-y-1">
        {[...totals.entries()].map(([t, v]) => (
          <p key={t} className="text-lg">
            <span className="font-semibold">{formatAmount(v)}</span>{' '}
            <span className="text-sm text-ink-dim">{TOKEN_LABEL[t]}</span>
          </p>
        ))}
        {totals.size === 0 ? <p className="text-sm text-ink-dim">Nothing yet.</p> : null}
      </div>
    </Card>
  );
}

function Statistics({
  invoices,
  payments,
}: {
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
}) {
  const byStatus = useMemo(() => {
    const c = { open: 0, settled: 0, cancelled: 0, pending: 0 };
    for (const i of invoices) c[(i.status ?? 'pending') as keyof typeof c] += 1;
    return c;
  }, [invoices]);

  const invoiced = useMemo(() => totalsByToken(invoices), [invoices]);
  const paidOut = useMemo(() => totalsByToken(payments), [payments]);
  const days = useMemo(() => perDay(invoices), [invoices]);
  const peak = Math.max(1, ...days.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Invoices created" value={invoices.length} />
        <StatCard label="Open" value={byStatus.open + byStatus.pending} />
        <StatCard label="Settled" value={byStatus.settled} />
        <StatCard label="Payments made" value={payments.length} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Totals title="Invoiced" totals={invoiced} />
        <Totals title="Paid out" totals={paidOut} />
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-dim">
          Invoices created, last 14 days
        </h2>
        <div className="mt-6 flex h-40 items-end gap-2" role="img" aria-label="Invoices created per day">
          {days.map((d) => (
            <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-nova/30 to-aurora/70"
                style={{ height: `${d.count === 0 ? 2 : Math.max(8, (d.count / peak) * 85)}%` }}
                title={`${d.label}: ${d.count}`}
              />
              <span className="text-[9px] text-ink-faint">{d.label.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <PrivacyNote>
          These figures are computed here, on this device, from your private records. The chain holds
          one commitment per invoice and a count of how many exist. It cannot compute your revenue,
          and neither can we.
        </PrivacyNote>
      </Card>
    </div>
  );
}

function PaidList({ payments, onChanged }: { payments: PaymentRecord[]; onChanged: () => void }) {
  if (payments.length === 0) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-ink-dim">
          Nothing paid from this device yet. Receipts for invoices you pay are kept here.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {payments.map((p) => (
        <Card key={p.receipt} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="aurora">paid</Badge>
                <span className="font-mono text-xs text-ink-faint">merchant {p.merchant}</span>
              </div>
              {p.items && p.items.length > 0 ? (
                <p className="mt-2 text-sm text-ink-dim">{p.items.join(', ')}</p>
              ) : null}
              <p className="mt-2 font-mono text-xs text-ink-faint">
                {new Date(p.paidAt).toLocaleString()}
              </p>
            </div>
            <p className="text-xl font-semibold">
              {formatAmount(BigInt(p.amount))}{' '}
              <span className="text-sm font-normal text-ink-dim">{TOKEN_LABEL[p.token]}</span>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Digest label="receipt" value={p.receipt} />
            {p.refundCode ? (
              <Button
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={() => void navigator.clipboard?.writeText(p.refundCode!)}
              >
                Copy refund code
              </Button>
            ) : null}
            <Button
              variant="danger"
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                forgetPayment(p.receipt);
                onChanged();
              }}
            >
              Forget
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(() => loadInvoices());
  const [payments, setPayments] = useState<PaymentRecord[]>(() => loadPayments());
  const [view, setView] = useState<View>('dashboard');
  const [list, setList] = useState<List>('created');
  const [filter, setFilter] = useState<Filter>('all');

  // A payer settles from another browser, so read the statuses back from the chain.
  const syncFromChain = useCallback(async () => {
    if (await syncInvoiceStatuses()) setInvoices(loadInvoices());
  }, []);

  useEffect(() => {
    void syncFromChain();
    const timer = setInterval(() => void syncFromChain(), 6_000);
    return () => clearInterval(timer);
  }, [syncFromChain]);

  const shown = useMemo(() => {
    if (filter === 'all') return invoices;
    return invoices.filter((i) => (i.status ?? 'pending') === filter);
  }, [invoices, filter]);

  function remove(salt: string) {
    forgetInvoice(salt);
    setInvoices(loadInvoices());
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Your" accent="dashboard">
        Held on this device. Clearing browser data loses it, so export from Settings first.
      </PageHeader>

      <div className="flex justify-center">
        <Tabs
          label="Dashboard view"
          value={view}
          onChange={setView}
          tabs={[
            { id: 'stats', label: 'Statistics' },
            { id: 'dashboard', label: 'Dashboard' },
          ]}
        />
      </div>

      {view === 'stats' ? (
        <Statistics invoices={invoices} payments={payments} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              label="Invoice list"
              value={list}
              onChange={setList}
              tabs={[
                { id: 'created', label: 'My invoices' },
                { id: 'paid', label: 'Paid invoices' },
              ]}
            />
            {list === 'created' ? (
              <div className="flex gap-2">
                {(['all', 'open', 'settled'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={`rounded-xl border px-4 py-2 text-sm capitalize transition ${
                      filter === f ? 'border-aurora text-aurora' : 'border-line text-ink-dim'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {list === 'paid' ? (
            <PaidList payments={payments} onChanged={() => setPayments(loadPayments())} />
          ) : shown.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="text-sm text-ink-dim">
                {invoices.length === 0 ? 'No invoices yet.' : 'Nothing matches that filter.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {shown.map((inv) => (
                <Card key={inv.salt} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-medium">{inv.title || 'Untitled invoice'}</h3>
                        <Badge tone={STATUS_TONE[inv.status ?? 'pending']}>
                          {inv.status ?? 'pending'}
                        </Badge>
                        <Badge>{KIND_LABEL[inv.kind]}</Badge>
                      </div>
                      {inv.memo ? <p className="mt-1 text-sm text-ink-dim">{inv.memo}</p> : null}
                      <p className="mt-2 font-mono text-xs text-ink-faint">
                        salt {shortHex(inv.salt, 8, 6)} ·{' '}
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xl font-semibold">
                        {formatAmount(BigInt(inv.amount))}{' '}
                        <span className="text-sm font-normal text-ink-dim">
                          {TOKEN_LABEL[inv.token]}
                        </span>
                      </p>
                      <p className="mt-1 text-[11px] text-ink-faint">local only</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {inv.commitment ? <Digest label="commitment" value={inv.commitment} /> : null}
                    <Button
                      variant="ghost"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => void navigator.clipboard?.writeText(shareLink(inv))}
                    >
                      Copy payment link
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => remove(inv.salt)}
                    >
                      Forget
                    </Button>
                    <InvoiceActions inv={inv} onChanged={() => setInvoices(loadInvoices())} />
                    <RefundAction inv={inv} />
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card className="p-6">
            <PrivacyNote>
              These records exist only on this device. Forgetting one removes it here and does
              nothing on chain.
            </PrivacyNote>
          </Card>
        </>
      )}
    </div>
  );
}
