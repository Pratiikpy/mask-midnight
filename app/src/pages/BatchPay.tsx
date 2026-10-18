// Paying four invoices under one proof.
//
// The contract can settle four at once. Whether that is worth doing was an open
// question — one proof over a bigger circuit could easily cost more than four
// small ones — so it was measured on the devnet rather than assumed:
//
//   four settle_invoice calls   100.7 s
//   one settle_batch of four     59.9 s
//
// 40% faster, and one transaction instead of four. That is the case for this
// page existing. Payroll is the obvious use, but any merchant clearing a day's
// invoices gets the same win.
//
// Exactly four, because a circuit cannot loop over a variable number of items.
// A wider batch is a wider compiled variant of the contract, not a different
// screen. The page says so rather than pretending the limit is a choice.

import { useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { ProofProgress } from '../components/ProofProgress.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { useCircuit } from '../lib/useCircuit.ts';
import { CONTRACT_ADDRESS } from '../lib/config.ts';
import { emptyPrivateState } from '../lib/contract.ts';
import { formatAmount, fromHex, randomBytes, shortHex, toHex } from '../lib/format.ts';
import { encodeRefundCode } from '../lib/refund.ts';
import { savePayment } from '../lib/payments.ts';
import { coinPublicKeyHex } from '../lib/wallet.ts';
import {
  InvoiceKind,
  TOKEN_LABEL,
  TokenKind,
  decodeTerms,
  type InvoiceTerms,
  type TokenKindValue,
} from '../lib/invoice.ts';

const SLOTS = [0, 1, 2, 3] as const;

interface Slot {
  raw: string;
  terms: (InvoiceTerms & { contractAddress?: string }) | null;
  error: string | null;
}

const emptySlot = (): Slot => ({ raw: '', terms: null, error: null });

export function BatchPayPage() {
  const { connection, connect, providers } = useMask();
  const [slots, setSlots] = useState<Slot[]>(SLOTS.map(emptySlot));
  const [receipts, setReceipts] = useState<string[] | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const circuit = useCircuit(providers as Record<string, unknown> | null, CONTRACT_ADDRESS);

  const filled = slots.filter((s) => s.terms !== null);
  const ready = filled.length === 4;

  // Every entry in one batch is settled under a single set of public terms, so
  // they must agree on kind and asset. Mixing them is not a limitation to work
  // around — it would be settling four different kinds of thing at once.
  const mismatch = useMemo(() => {
    if (!ready) return null;
    const first = filled[0]!.terms!;
    const differsOnKind = filled.some((s) => s.terms!.kind !== first.kind);
    const differsOnToken = filled.some((s) => s.terms!.token !== first.token);
    if (differsOnKind) return 'All four invoices must be the same type.';
    if (differsOnToken) return 'All four invoices must be in the same asset.';
    if (first.kind !== InvoiceKind.STANDARD) {
      return 'Batch settlement handles standard invoices. Multi-pay and donations settle one contribution at a time.';
    }
    return null;
  }, [ready, filled]);

  const duplicate = useMemo(() => {
    const salts = filled.map((s) => s.terms!.salt);
    return new Set(salts).size !== salts.length;
  }, [filled]);

  const total = useMemo(() => {
    try {
      return filled.reduce((sum, s) => sum + BigInt(s.terms!.amount), 0n);
    } catch {
      return null;
    }
  }, [filled]);

  function load(index: number, raw: string) {
    setReceipts(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setSlots((prev) => prev.map((s, i) => (i === index ? emptySlot() : s)));
      return;
    }
    const fragment = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#') + 1) : trimmed;
    const terms = decodeTerms(fragment);
    setSlots((prev) =>
      prev.map((s, i) =>
        i === index
          ? {
              raw,
              terms,
              error: terms ? null : 'Could not read that link. Paste the whole thing.',
            }
          : s,
      ),
    );
  }

  async function payAll() {
    if (!ready || mismatch || duplicate) return;
    setReceipts(null);
    setCodes([]);
    circuit.reset();

    const entries = filled.map((s) => s.terms!);

    // One payer key for the whole batch. The nullifiers differ anyway, because
    // each binds to its own invoice commitment — and four keys would mean four
    // unrelated-looking payments, which is the opposite of what a payroll run
    // wants to be able to prove later.
    const payerKey = randomBytes(32);

    try {
      const out = (await circuit.run(
        'settle_batch',
        {
          ...emptyPrivateState(),
          payerKey,
          batchAmounts: entries.map((t) => BigInt(t.amount)),
          batchSalts: entries.map((t) => fromHex(t.salt)),
          batchMerchants: entries.map((t) => fromHex(t.merchantKey)),
          batchIndices: [0n, 0n, 0n, 0n],
        },
        [entries[0]!.kind, entries[0]!.token],
      )) as { private: { result: Uint8Array[] } };

      const hexes = out.private.result.map((r) => toHex(r));
      setReceipts(hexes);
      // Each merchant needs its own payment's code to refund it or to count it
      // in a revenue proof, and only this browser holds the key that names it.
      // Kept here on this device until the payer chooses to send them.
      if (connection.status === 'connected') {
        const made = hexes.map((receipt) =>
          encodeRefundCode({
            payerKey: toHex(payerKey),
            paymentIndex: '0',
            payerAddr: coinPublicKeyHex(connection.coinPublicKey),
            receipt,
          }),
        );
        setCodes(made);
        hexes.forEach((receipt, i) =>
          savePayment({
            receipt,
            amount: entries[i]!.amount,
            token: entries[i]!.token,
            merchant: shortHex(entries[i]!.merchantKey, 8, 4),
            paidAt: Date.now(),
            refundCode: made[i],
            items: entries[i]!.items?.map((it) => it.name),
          }),
        );
      }
    } catch {
      // useCircuit surfaces the contract's own assert message.
    }
  }

  const token: TokenKindValue = filled[0]?.terms?.token ?? TokenKind.NATIVE;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Pay four" accent="at once">
        Four invoices, one proof, one transaction. Measured at 60 seconds against 101 for the same four paid one at a time.
      </PageHeader>
      <Card className="p-6">

        <div className="mt-6 space-y-4">
          {SLOTS.map((i) => {
            const slot = slots[i]!;
            return (
              <Field
                key={i}
                label={`Invoice ${i + 1}`}
                hint={
                  slot.terms
                    ? `${formatAmount(BigInt(slot.terms.amount))} ${TOKEN_LABEL[slot.terms.token]} · merchant ${slot.terms.merchantKey.slice(0, 10)}…`
                    : 'Paste the payment link'
                }
              >
                <Input
                  value={slot.raw}
                  onChange={(e) => load(i, e.target.value)}
                  placeholder="https://…/pay#…"
                />
                {slot.error ? (
                  <p className="mt-2 text-xs text-danger">{slot.error}</p>
                ) : null}
              </Field>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-line bg-surface-2 p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-ink-faint">Batch total</span>
            <Badge tone="neutral">{filled.length} of 4</Badge>
          </div>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {total !== null && filled.length > 0 ? formatAmount(total) : '—'}{' '}
            <span className="text-base font-normal text-ink-dim">{TOKEN_LABEL[token]}</span>
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            This total is computed in your browser from links you were sent. It is not published, and
            the four amounts inside it are not published either.
          </p>
        </div>

        {mismatch ? <ErrorNote>{mismatch}</ErrorNote> : null}
        {duplicate ? (
          <ErrorNote>
            The same invoice appears twice. The contract refuses a batch that settles one invoice
            more than once, so this would fail after the proof rather than before it.
          </ErrorNote>
        ) : null}

        <div className="mt-6 space-y-3">
          {connection.status === 'connected' ? (
            <Button
              onClick={() => void payAll()}
              disabled={!ready || mismatch !== null || duplicate}
              className="w-full"
            >
              {ready ? `Pay all four` : `Add ${4 - filled.length} more`}
            </Button>
          ) : (
            <Button onClick={() => void connect()} className="w-full">
              Connect wallet to pay
            </Button>
          )}

          {circuit.error ? <ErrorNote>{circuit.error}</ErrorNote> : null}

          <ProofProgress
            stage={circuit.stage}
            circuit="settle_batch"
            startedAt={circuit.startedAt}
            error={circuit.error}
          />

          {receipts ? (
            <div className="rounded-2xl border border-aurora/30 bg-aurora/5 p-5">
              <Badge tone="aurora">four receipts</Badge>
              <p className="mt-2 text-sm text-ink-dim">
                All four settled together. Either every one of them landed or none did — the contract
                has no way to settle three.
              </p>
              <div className="mt-3 space-y-1">
                {receipts.map((r) => (
                  <p key={r} className="break-all font-mono text-xs text-aurora">
                    {r}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {receipts && codes.length > 0 ? (
            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <Badge>payment codes</Badge>
              <p className="mt-2 text-sm text-ink-dim">
                Only if a merchant asks for a refund, or needs to count a payment in a revenue
                proof: send that payment's code to that merchant, privately. Do not post them.
              </p>
              <div className="mt-3 space-y-3">
                {codes.map((c, i) => (
                  <div key={receipts[i]} className="flex items-center gap-3">
                    <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-faint">
                      {formatAmount(BigInt(filled[i]?.terms?.amount ?? '0'))} · {c}
                    </p>
                    <Button
                      variant="ghost"
                      className="shrink-0 px-3 py-1.5 text-xs"
                      onClick={() => void navigator.clipboard?.writeText(c)}
                    >
                      Copy code {i + 1}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Why four, and why batch
        </h2>
        <div className="mt-4 space-y-3">
          <PrivacyNote>
            One proof covers all four settlements. Measured on the devnet: 60 seconds, against 101
            for four separate payments — proving cost grows more slowly than the circuit does.
          </PrivacyNote>
          <PrivacyNote>
            It is atomic. A bad entry settles nothing, so a payroll run cannot pay three people and
            leave the fourth to be found by hand.
          </PrivacyNote>
          <PrivacyNote>
            Exactly four, because a circuit cannot loop over a variable number of items. A wider
            batch means compiling a wider variant of the contract, not changing this page.
          </PrivacyNote>
          <PrivacyNote>
            The ledger records four settlements and four receipts. Not the four amounts, not their
            total, and not that they were paid by the same person.
          </PrivacyNote>
        </div>
      </Card>
    </div>
  );
}
