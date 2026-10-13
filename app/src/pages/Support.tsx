import { useState } from 'react';
import { Button, Card, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';

const TOPICS = [
  {
    q: 'I lost my merchant identity key. Can you recover it?',
    a: 'No, and that is not a policy we could change. The key exists only on your device — the chain holds no copy and neither do we. Invoices created with it can no longer be proven as yours. Settings has a backup export; use it before you need it.',
  },
  {
    q: 'A payment is taking thirty seconds. Is it stuck?',
    a: 'Almost certainly not. Proving runs on your own machine and is CPU-bound; measured settlement is 30 to 60 seconds. The progress bar shows the real stage rather than a guess. You can close the tab — the payment completes on chain regardless.',
  },
  {
    q: 'Can you tell me how much an invoice was for?',
    a: 'No, because we do not have it. Amounts never reach any server of ours, and the chain stores only a commitment. If you have the payment link, the amount is inside it — that is the only copy outside the merchant and the payer.',
  },
  {
    q: 'I lost a gift card link.',
    a: 'The link is the money, like a banknote. Whoever holds it can spend it, and it cannot be cancelled. That is the cost of a card nobody can trace. If you need cards you can freeze, use Mask Card instead.',
  },
  {
    q: 'My payment was rejected instantly.',
    a: 'That is the system working. A wrong amount, a wrong token or an already-settled invoice fails on your own machine in under a second — nothing is submitted and nothing is spent. Check the amount against the link you were sent.',
  },
  {
    q: 'Can a court order you to hand over transaction data?',
    a: 'They can ask. We would have commitments and receipts, which are hashes, and nothing else. There is no amount, merchant or payer in our possession to disclose.',
  },
];

export function SupportPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Support and" accent="feedback">
        Most questions have the same root: we deliberately cannot see your data, which changes what support is able to do for you.
      </PageHeader>

      <div className="space-y-3">
        {TOPICS.map((t) => (
          <Card key={t.q} className="p-6">
            <h2 className="font-medium">{t.q}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">{t.a}</p>
          </Card>
        ))}
      </div>

      <Card className="p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight">Still stuck</h2>
        <p className="mt-1 text-sm text-ink-dim">
          Do not include amounts, keys or payment links. We cannot act on them and would rather not
          receive them.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Email" hint="So we can reply.">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
            />
          </Field>

          <Field label="What happened">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="What you did, what you expected, and what happened instead."
              className="w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-ink outline-none transition placeholder:text-ink-faint focus:border-aurora"
            />
          </Field>

          <Button
            onClick={() => setSent(true)}
            disabled={!email.trim() || !message.trim()}
            className="w-full"
          >
            Send
          </Button>

          {sent ? (
            <PrivacyNote>
              This form is not wired to a mail service in this build — point it at one before
              launch. Nothing was transmitted.
            </PrivacyNote>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
