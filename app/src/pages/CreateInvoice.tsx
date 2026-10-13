import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Digest,
  ErrorNote,
  Field,
  Input,
  PrivacyNote,
  Segmented,
} from '../components/ui.tsx';
import { ProofProgress } from '../components/ProofProgress.tsx';
import { PaymentQR } from '../components/PaymentQR.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { useCircuit } from '../lib/useCircuit.ts';
import { CONTRACT_ADDRESS } from '../lib/config.ts';
import { privateStateFromTerms } from '../lib/contract.ts';
import { formatAmount, fromHex, parseAmount, randomBytes, toHex } from '../lib/format.ts';
import {
  InvoiceKind,
  TOKEN_LABEL,
  TokenKind,
  merchantKey,
  saveInvoice,
  shareLink,
  type InvoiceKindValue,
  type LineItem,
  type TokenKindValue,
} from '../lib/invoice.ts';

const EXPIRY_OPTIONS = [
  { label: 'No expiry', hours: 0 },
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
];

const KIND_OPTIONS: { value: InvoiceKindValue; label: string; hint: string }[] = [
  {
    value: InvoiceKind.STANDARD,
    label: 'Standard',
    hint: 'One payment, then the invoice closes.',
  },
  {
    value: InvoiceKind.MULTIPAY,
    label: 'Multi-pay',
    hint: 'Many people can pay the same invoice until you close it. Each contribution is the amount above.',
  },
  {
    value: InvoiceKind.DONATION,
    label: 'Donation',
    hint: 'Open collection with no expected total. Stays open until you close it.',
  },
];

const TOKEN_OPTIONS: { value: TokenKindValue; label: string; hint: string }[] = [
  { value: TokenKind.NATIVE, label: TOKEN_LABEL[0]!, hint: 'The network’s own token.' },
  {
    value: TokenKind.MUSDC,
    label: TOKEN_LABEL[1]!,
    hint: 'A reference stable asset issued by Mask for testing. It is not real USDC.',
  },
  {
    value: TokenKind.MUSAD,
    label: TOKEN_LABEL[2]!,
    hint: 'A second reference asset issued by Mask for testing.',
  },
];

const EMPTY_ITEM: LineItem = { name: '', qty: '1', unit: '' };

const wholeNumber = (v: string): bigint | null => (/^\d+$/.test(v.trim()) ? BigInt(v.trim()) : null);

export function CreateInvoicePage() {
  const { connection, providers } = useMask();

  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [kind, setKind] = useState<InvoiceKindValue>(InvoiceKind.STANDARD);
  const [token, setToken] = useState<TokenKindValue>(TokenKind.NATIVE);
  const [expiryHours, setExpiryHours] = useState(0);
  const [showItems, setShowItems] = useState(false);
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);

  const circuit = useCircuit(providers as Record<string, unknown> | null, CONTRACT_ADDRESS);
  const [created, setCreated] = useState<{ link: string; commitment?: string } | null>(null);
  const [sent, setSent] = useState(false);

  // With line items, the total is the sum of the lines and the amount field
  // follows it; the commitment still covers one number, the total.
  const itemsTotal = useMemo(() => {
    let total = 0n;
    for (const i of items) {
      const q = wholeNumber(i.qty);
      const u = wholeNumber(i.unit);
      if (q === null || u === null) return null;
      total += q * u;
    }
    return total;
  }, [items]);

  const parsed = useMemo(
    () => (showItems ? itemsTotal : parseAmount(amount)),
    [showItems, itemsTotal, amount],
  );
  const amountValid = parsed !== null && parsed > 0n;
  const itemsValid = !showItems || items.every((i) => i.name.trim().length > 0);
  const connected = connection.status === 'connected';

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((all) => all.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function create() {
    if (!amountValid || !itemsValid) return;
    circuit.reset();
    setCreated(null);
    setSent(true);

    // Fresh randomness per invoice. Publishing it would make equal
    // merchant/amount pairs linkable, so it never leaves the browser.
    const salt = toHex(randomBytes(32));
    // A second, independent secret: authority to close or cancel. It stays in
    // this vault and is not part of `terms`, so the payment link cannot carry it.
    const ownerSecret = toHex(randomBytes(32));
    const terms = {
      merchantKey: merchantKey(),
      salt,
      amount: parsed!.toString(),
      kind,
      token,
      // Where an escrowed payment pays out. Present only when a wallet is
      // connected, because it is the wallet's shielded key; an invoice made
      // offline can still be settled by proof, just not by moving a coin.
      merchantAddr: connection.status === 'connected' ? connection.coinPublicKey : undefined,
      items: showItems ? items.map((i) => ({ name: i.name.trim(), qty: i.qty.trim(), unit: i.unit.trim() })) : undefined,
    };

    // Seconds since the epoch: the contract compares it with the block's
    // secondsSinceEpoch. A millisecond value is a date tens of thousands of
    // years away, and the invoice would never expire.
    const expiresAt =
      expiryHours === 0
        ? '0'
        : (BigInt(Math.floor(Date.now() / 1000)) + BigInt(expiryHours) * 3_600n).toString();

    saveInvoice({
      ...terms,
      ownerSecret,
      title,
      memo,
      createdAt: Date.now(),
      expiresAt,
      status: 'pending',
    });

    // The share link is available immediately: it carries the terms, which
    // exist before the chain does anything. Publishing the commitment is what
    // takes ~25s, and the payer cannot settle until it lands.
    setCreated({ link: shareLink(terms) });

    if (!connected) return;

    try {
      const out = (await circuit.run(
        'create_invoice',
        privateStateFromTerms(terms, randomBytes(32), fromHex(ownerSecret)),
        [kind, token, BigInt(expiresAt)],
      )) as { private: { result: Uint8Array } };

      const commitment = toHex(out.private.result);
      saveInvoice({
        ...terms,
        ownerSecret,
        title,
        memo,
        createdAt: Date.now(),
        expiresAt,
        commitment,
        status: 'open',
        contractAddress: CONTRACT_ADDRESS,
      });
      setCreated({ link: shareLink(terms, CONTRACT_ADDRESS), commitment });
    } catch {
      // useCircuit already surfaced the message; the share link stays usable.
    }
  }

  function another() {
    circuit.reset();
    setCreated(null);
    setSent(false);
    setAmount('');
    setTitle('');
    setMemo('');
    setItems([{ ...EMPTY_ITEM }]);
    setShowItems(false);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="font-display text-5xl tracking-tight sm:text-6xl">
          Create a <em className="text-aurora">private invoice</em>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-dim">
          Generate a privacy-preserving invoice link to receive payments securely on Midnight. The
          chain stores a commitment and never sees the amount or who you are.
        </p>
      </div>

      {!created ? (
        <Card className="p-6 sm:p-8">
          <div className="space-y-6">
            <Segmented label="Invoice type" value={kind} onChange={setKind} options={KIND_OPTIONS} />
            <Segmented label="Settlement asset" value={token} onChange={setToken} options={TOKEN_OPTIONS} />

            <Field
              label={`Amount (${TOKEN_LABEL[token]}${kind === InvoiceKind.MULTIPAY ? ', per payment' : ''})`}
              hint={
                showItems ? (
                  'Filled from your line items.'
                ) : amount && !amountValid ? (
                  <span className="text-danger">Whole numbers only.</span>
                ) : (
                  'Whole units. Never published.'
                )
              }
            >
              <Input
                value={showItems ? (itemsTotal === null ? '' : itemsTotal.toString()) : amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="42500"
                inputMode="numeric"
                autoComplete="off"
                readOnly={showItems}
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-dim hover:text-ink">
              <input
                type="checkbox"
                checked={showItems}
                onChange={(e) => setShowItems(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-nova)]"
              />
              Add line items
            </label>

            {showItems ? (
              <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
                <div className="grid grid-cols-[1fr_4.5rem_6rem_2rem] gap-3 px-1 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Unit price</span>
                  <span />
                </div>
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_4.5rem_6rem_2rem] items-center gap-3">
                    <Input
                      value={it.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      placeholder="Item name"
                      aria-label={`Item ${i + 1} name`}
                    />
                    <Input
                      value={it.qty}
                      onChange={(e) => updateItem(i, { qty: e.target.value })}
                      inputMode="numeric"
                      aria-label={`Item ${i + 1} quantity`}
                    />
                    <Input
                      value={it.unit}
                      onChange={(e) => updateItem(i, { unit: e.target.value })}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Item ${i + 1} unit price`}
                    />
                    <button
                      type="button"
                      onClick={() => setItems((all) => (all.length > 1 ? all.filter((_, k) => k !== i) : all))}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:text-danger"
                      aria-label={`Remove item ${i + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setItems((all) => [...all, { ...EMPTY_ITEM }])}
                    className="inline-flex items-center gap-1.5 text-sm text-aurora hover:underline"
                  >
                    <Plus className="h-4 w-4" /> Add item
                  </button>
                  <span className="text-sm text-ink-dim">
                    Total <strong className="text-ink">{itemsTotal === null ? '–' : formatAmount(itemsTotal)}</strong>
                  </span>
                </div>
              </div>
            ) : null}

            <Field label="Expiry" hint="After this, settlement is refused on chain.">
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map((o) => (
                  <button
                    key={o.hours}
                    type="button"
                    onClick={() => setExpiryHours(o.hours)}
                    className={`rounded-xl border px-4 py-2 text-sm transition ${
                      expiryHours === o.hours
                        ? 'border-aurora text-aurora'
                        : 'border-line text-ink-dim hover:border-line-bright'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Invoice title (optional)" hint="Stored only on this device. Never sent anywhere.">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === InvoiceKind.DONATION ? 'Monsoon relief drive' : 'Design retainer, March'}
              />
            </Field>

            <Field label="Memo (optional)" hint="Also local only.">
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" />
            </Field>

            <Button
              onClick={() => void create()}
              disabled={!amountValid || !itemsValid}
              className="w-full py-4"
            >
              {connected ? 'Create invoice' : 'Create invoice (link only, wallet not connected)'}
            </Button>

            {circuit.error ? <ErrorNote>{circuit.error}</ErrorNote> : null}
          </div>
        </Card>
      ) : null}

      {sent ? (
        <div className="mt-6">
          <ProofProgress
            stage={circuit.stage}
            circuit="create_invoice"
            startedAt={circuit.startedAt}
            error={circuit.error}
          />
        </div>
      ) : null}

      {created ? (
        <Card className="mt-6 p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <Badge tone="aurora">share link ready</Badge>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            Send this to your payer. The terms travel in the URL fragment, which browsers never send
            to a server, so the amount does not pass through us or anyone else.
          </p>
          <div className="mt-4 break-all rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs text-ink-dim">
            {created.link}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => void navigator.clipboard?.writeText(created.link)}
            >
              Copy link
            </Button>
            <Button variant="ghost" className="flex-1" onClick={another}>
              Create another
            </Button>
          </div>

          {/* For paying in person: the payer scans, and the terms go straight
              from this screen to their phone. */}
          <div className="mt-6 flex flex-col items-center gap-3 border-t border-line pt-6">
            <PaymentQR value={created.link} />
            <p className="max-w-sm text-center text-xs text-ink-faint">
              Scan to pay. The code contains the invoice&apos;s real terms, so anyone who photographs it
              can pay this invoice and can read what it is for, the same as the link.
            </p>
          </div>
          {created.commitment ? (
            <div className="mt-4">
              <Digest label="commitment" value={created.commitment} />
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="mt-6 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-dim">
          What the chain sees
        </h2>
        <div className="mt-4 space-y-3">
          <PrivacyNote>
            A 32-byte commitment binding your identity key, the amount, the asset and a random salt.
            It reveals none of them.
          </PrivacyNote>
          <PrivacyNote>
            The invoice type, asset and expiry. These are public on purpose so anyone can check the
            terms were honoured.
          </PrivacyNote>
          <PrivacyNote>A running count of invoices created. No breakdown, no amounts.</PrivacyNote>
        </div>
        <h2 className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-ink-dim">
          What it never sees
        </h2>
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          The amount, your identity key, the salt, your line items, and the title and memo. Those
          never leave this browser except in the link you choose to send.
        </p>
      </Card>
    </div>
  );
}
