import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorNote, PrivacyNote } from '../components/ui.tsx';
import { formatAmount } from '../lib/format.ts';
import { KIND_LABEL, TOKEN_LABEL, decodeTerms } from '../lib/invoice.ts';

const BACKEND = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3100';

interface Session {
  id: string;
  status: 'pending' | 'settled' | 'expired';
  paymentUrl: string;
  commitment?: string;
  clientReference?: string;
  successUrl?: string;
  cancelUrl?: string;
  expiresAt: number;
}

/**
 * The hosted checkout page a merchant redirects a customer to.
 *
 * It polls the backend rather than the chain directly: the backend is already
 * watching, and a customer's browser should not have to. Note what the session
 * does not carry — an amount. That comes from the payment link's fragment,
 * which the backend never saw.
 */
export function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${BACKEND}/api/checkout/sessions/${id}`);
      if (res.status === 404) throw new Error('That checkout session does not exist.');
      if (!res.ok) throw new Error(`The checkout service returned ${res.status}.`);
      setSession((await res.json()) as Session);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Settlement takes ~30s, so polling faster than a couple of seconds is waste.
  useEffect(() => {
    if (!session || session.status !== 'pending') return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [session, load]);

  useEffect(() => {
    if (session?.status === 'settled' && session.successUrl) {
      const t = setTimeout(() => {
        window.location.href = session.successUrl!;
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [session]);

  const terms = session ? decodeTerms(session.paymentUrl) : null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>

        {error ? (
          <div className="mt-5">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}

        {!session && !error ? (
          <p className="mask-pulse mt-5 text-sm text-ink-dim">Loading session…</p>
        ) : null}

        {session ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-ink-faint">Amount due</span>
                <Badge
                  tone={
                    session.status === 'settled'
                      ? 'aurora'
                      : session.status === 'expired'
                        ? 'danger'
                        : 'nova'
                  }
                >
                  {session.status}
                </Badge>
              </div>
              <p className="mt-2 text-3xl font-semibold tracking-tight">
                {terms ? formatAmount(BigInt(terms.amount)) : '—'}{' '}
                <span className="text-base font-normal text-ink-dim">
                  {terms ? TOKEN_LABEL[terms.token] : ''}
                </span>
              </p>
              {terms ? (
                <p className="mt-2 text-xs text-ink-faint">{KIND_LABEL[terms.kind]} invoice</p>
              ) : null}
              {session.clientReference ? (
                <p className="mt-3 text-xs text-ink-faint">order {session.clientReference}</p>
              ) : null}
            </div>

            {session.status === 'pending' ? (
              <>
                <a href={session.paymentUrl}>
                  <Button className="w-full">Pay now</Button>
                </a>
                <p className="mask-pulse text-center text-xs text-ink-faint">
                  Watching the chain for your payment…
                </p>
              </>
            ) : null}

            {session.status === 'settled' ? (
              <div className="rounded-2xl border border-aurora/30 bg-aurora/5 p-5 text-center">
                <p className="text-sm font-semibold text-aurora">Payment confirmed</p>
                <p className="mt-1 text-sm text-ink-dim">
                  {session.successUrl ? 'Returning you to the shop…' : 'You can close this page.'}
                </p>
              </div>
            ) : null}

            {session.status === 'expired' ? (
              <div className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
                <p className="text-sm font-semibold text-danger">This session expired</p>
                <p className="mt-1 text-sm text-ink-dim">
                  Nothing was charged. Ask the merchant for a fresh link.
                </p>
                {session.cancelUrl ? (
                  <a href={session.cancelUrl}>
                    <Button variant="ghost" className="mt-4 w-full">
                      Back to the shop
                    </Button>
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="p-6">
        <PrivacyNote>
          The shop&apos;s server routed you here and will be told the payment landed. It is never
          told the amount — that travelled in the link, straight to your browser.
        </PrivacyNote>
      </Card>
    </div>
  );
}
