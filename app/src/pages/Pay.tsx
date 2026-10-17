import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { ProofProgress } from '../components/ProofProgress.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { coinPublicKeyHex } from '../lib/wallet.ts';
import { useCircuit } from '../lib/useCircuit.ts';
import { CONTRACT_ADDRESS } from '../lib/config.ts';
import { privateStateFromTerms } from '../lib/contract.ts';
import { coinForPayment, escrowSupported } from '../lib/coin.ts';
import { formatAmount, fromHex, randomBytes, shortHex, toHex } from '../lib/format.ts';
import { encodeRefundCode } from '../lib/refund.ts';
import { savePayment } from '../lib/payments.ts';
import { KIND_LABEL, TOKEN_LABEL, decodeTerms, type InvoiceTerms } from '../lib/invoice.ts';

export function PayPage() {
  const { connection, connect, providers } = useMask();
  const [raw, setRaw] = useState('');
  const [terms, setTerms] = useState<(InvoiceTerms & { contractAddress?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [refundCode, setRefundCode] = useState<string | null>(null);
  // Escrow actually moves a coin; recording proves the payment without moving
  // one. Escrow is the default when it is possible, because "paid" should mean
  // paid — but it needs the merchant's payout address from the link, and for a
  // reference asset it needs to know which token contract issued it.
  const [moveCoin, setMoveCoin] = useState(true);
  const circuit = useCircuit(
    providers as Record<string, unknown> | null,
    CONTRACT_ADDRESS,
  );

  // A share link puts the terms in the fragment.
  //
  // Re-read on every hash change, not only on mount. Opening a second payment
  // link in the same tab changes the fragment without remounting the route, and
  // a mount-only read left the previous invoice on screen — a payer who
  // followed a new link would have been shown, and would have settled, the old
  // one.
  useEffect(() => {
    const read = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;
      const decoded = decodeTerms(fragment);
      if (decoded) {
        setTerms(decoded);
        setRaw(fragment);
        setReceipt(null);
        setError(null);
      } else {
        setError('That payment link is malformed. Ask the merchant to send it again.');
      }
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const amount = useMemo(() => {
    if (!terms) return null;
    try {
      return BigInt(terms.amount);
    } catch {
      return null;
    }
  }, [terms]);

  function loadFromInput() {
    setError(null);
    const trimmed = raw.trim();
    const fragment = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#') + 1) : trimmed;
    const decoded = decodeTerms(fragment);
    if (!decoded) {
      setError('Could not read that link. Paste the whole thing, including the part after the #.');
      return;
    }
    setTerms(decoded);
  }

  // Escrow needs somewhere to send the coin and a colour for the asset. Both
  // can be missing on an older link or an unconfigured deployment, and the page
  // says which rather than failing thirty seconds into a proof.
  const escrowBlocker = useMemo(() => {
    if (!terms) return null;
    if (!terms.merchantAddr)
      return 'This payment link has no payout address, so the merchant can only be paid by proof.';
    if (!escrowSupported(terms.token))
      return `This build has no ${TOKEN_LABEL[terms.token]} contract configured, so a ${TOKEN_LABEL[terms.token]} coin cannot be identified.`;
    return null;
  }, [terms]);

  const willMoveCoin = moveCoin && escrowBlocker === null;

  async function pay() {
    if (!terms) return;
    setError(null);
    setReceipt(null);
    setRefundCode(null);
    circuit.reset();

    // A fresh payer key per payment: the nullifier binds to it, so reusing one
    // across payments would link them to each other.
    const payerKey = randomBytes(32);
    const privateState = privateStateFromTerms(terms, payerKey);

    try {
      let out: { private: { result: Uint8Array } };

      if (willMoveCoin) {
        const coin = coinForPayment(terms.token, BigInt(terms.amount));
        if (!coin) {
          setError('That asset cannot be identified in this build.');
          return;
        }
        out = (await circuit.run('settle_invoice_shielded', privateState, [
          terms.kind,
          terms.token,
          coin,
          { bytes: fromHex(coinPublicKeyHex(terms.merchantAddr!)) },
        ])) as { private: { result: Uint8Array } };
      } else {
        out = (await circuit.run('settle_invoice', privateState, [
          terms.kind,
          terms.token,
        ])) as { private: { result: Uint8Array } };
      }

      const receiptHex = Array.from(out.private.result, (b) => b.toString(16).padStart(2, '0')).join('');
      setReceipt(receiptHex);
      // Everything a merchant needs to refund this payment, kept on this
      // device until the payer chooses to send it.
      let code: string | undefined;
      if (connection.status === 'connected') {
        code = encodeRefundCode({
          payerKey: toHex(payerKey),
          paymentIndex: privateState.paymentIndex.toString(),
          payerAddr: connection.coinPublicKey,
        });
        setRefundCode(code);
      }
      savePayment({
        receipt: receiptHex,
        amount: terms.amount,
        token: terms.token,
        merchant: shortHex(terms.merchantKey, 8, 4),
        paidAt: Date.now(),
        refundCode: code,
        items: terms.items?.map((i) => i.name),
      });
    } catch {
      // useCircuit surfaces the contract's own assert message.
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Make a" accent="private payment">
        Paying proves you know the invoice's real terms — without any of them being published.
      </PageHeader>
      <Card className="p-6">

        {!terms ? (
          <div className="mt-6 space-y-4">
            <Field label="Payment link" hint="Paste the link the merchant sent you.">
              <Input
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="https://…/pay#…"
              />
            </Field>
            <Button onClick={loadFromInput} disabled={!raw.trim()} className="w-full">
              Load invoice
            </Button>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-ink-faint">Amount due</span>
                <Badge tone="neutral">{KIND_LABEL[terms.kind]}</Badge>
              </div>
              <p className="mt-2 text-3xl font-semibold tracking-tight">
                {amount !== null ? formatAmount(amount) : '—'}{' '}
                <span className="text-base font-normal text-ink-dim">
                  {TOKEN_LABEL[terms.token]}
                </span>
              </p>
              {terms.items && terms.items.length > 0 ? (
                <table className="mt-4 w-full text-sm" aria-label="Line items">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-widest text-ink-faint">
                      <th className="pb-2 font-semibold">Item</th>
                      <th className="pb-2 text-right font-semibold">Qty</th>
                      <th className="pb-2 text-right font-semibold">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terms.items.map((it, i) => (
                      <tr key={i} className="border-t border-line/60 text-ink-dim">
                        <td className="py-2">{it.name}</td>
                        <td className="py-2 text-right">{it.qty}</td>
                        <td className="py-2 text-right">{formatAmount(BigInt(it.unit))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              <p className="mt-3 font-mono text-xs text-ink-faint">
                merchant {shortHex(terms.merchantKey, 10, 6)}
              </p>
            </div>

            <PrivacyNote>
              You are seeing this amount because the merchant sent it to you directly. It is not on
              the chain, and settling will not put it there.
            </PrivacyNote>

            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <span className="text-xs uppercase tracking-wider text-ink-faint">How to pay</span>
              <div className="mt-3 space-y-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="paymode"
                    className="mt-1 accent-aurora"
                    checked={willMoveCoin}
                    disabled={escrowBlocker !== null}
                    onChange={() => setMoveCoin(true)}
                  />
                  <span>
                    <span className="text-sm font-medium">Send the money</span>
                    <span className="block text-xs text-ink-dim">
                      A shielded coin worth exactly the amount due moves to the merchant in the same
                      transaction. The contract refuses anything of the wrong value or the wrong
                      asset.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="paymode"
                    className="mt-1 accent-aurora"
                    checked={!willMoveCoin}
                    onChange={() => setMoveCoin(false)}
                  />
                  <span>
                    <span className="text-sm font-medium">Record the payment only</span>
                    <span className="block text-xs text-ink-dim">
                      Publishes the receipt and closes the invoice without moving a coin — for when
                      the money has already changed hands elsewhere.
                    </span>
                  </span>
                </label>
              </div>
              {escrowBlocker ? (
                <p className="mt-3 text-xs text-ink-faint">{escrowBlocker}</p>
              ) : null}
            </div>

            {connection.status === 'connected' ? (
              <Button onClick={() => void pay()} className="w-full">
                {willMoveCoin ? 'Pay' : 'Record'}{' '}
                {amount !== null ? formatAmount(amount) : ''} {TOKEN_LABEL[terms.token]}
              </Button>
            ) : (
              <Button onClick={() => void connect()} className="w-full">
                Connect wallet to pay
              </Button>
            )}

            <Button variant="ghost" className="w-full" onClick={() => setTerms(null)}>
              Use a different link
            </Button>

            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {circuit.error ? <ErrorNote>{circuit.error}</ErrorNote> : null}

            <ProofProgress
              stage={circuit.stage}
              circuit={willMoveCoin ? 'settle_invoice_shielded' : 'settle_invoice'}
              startedAt={circuit.startedAt}
              error={circuit.error}
            />

            {receipt ? (
              <div className="rounded-2xl border border-aurora/30 bg-aurora/5 p-5">
                <Badge tone="aurora">receipt</Badge>
                <p className="mt-2 text-sm text-ink-dim">
                  Keep this. It proves the payment happened, without revealing what it was worth
                  or who paid.
                </p>
                <p className="mt-3 break-all font-mono text-xs text-aurora">{receipt}</p>
              </div>
            ) : null}

            {receipt && refundCode ? (
              <div className="rounded-2xl border border-line bg-surface-2 p-5">
                <Badge>refund code</Badge>
                <p className="mt-2 text-sm text-ink-dim">
                  Only if you ask for a refund: send this to the merchant, privately. It names this
                  payment and where the refund should go. Do not post it.
                </p>
                <p className="mt-3 break-all font-mono text-xs text-ink-faint">{refundCode}</p>
                <Button
                  variant="ghost"
                  className="mt-3 px-3 py-1.5 text-xs"
                  onClick={() => void navigator.clipboard?.writeText(refundCode)}
                >
                  Copy refund code
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          How this stays private
        </h2>
        <div className="mt-4 space-y-3">
          <PrivacyNote>
            Your wallet proves the amount matches what the invoice committed to. The proof carries
            the answer, not the number.
          </PrivacyNote>
          <PrivacyNote>
            {willMoveCoin
              ? 'The coin moves as a shielded transfer. Sender, recipient and value are all hidden by the protocol — verified against a live chain, not assumed.'
              : 'Recording moves no coin. It publishes a receipt proving this payment happened, and nothing about what it was worth.'}
          </PrivacyNote>
          <PrivacyNote>
            A one-time nullifier is published so the same payment can never be replayed. It is a hash
            and reveals neither the amount nor the payer.
          </PrivacyNote>
          <PrivacyNote>
            Pay the wrong amount and it fails on your own machine in under a second — nothing is
            submitted, nothing is spent.
          </PrivacyNote>
        </div>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Why it takes a moment
        </h2>
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          Proving runs on your own machine, on purpose. A hosted prover would be faster but would
          see the amount, which defeats the point. Measured settlement takes roughly 30–45 seconds.
        </p>
      </Card>
    </div>
  );
}
