import { Card, PageHeader, PrivacyNote } from '../components/ui.tsx';

const VISIBLE: [string, string][] = [
  [
    'Invoice commitment',
    'A 32-byte hash. Binds merchant, amount, terms and salt — and reveals none of them.',
  ],
  ['Invoice status', 'Open, settled or cancelled. Not who settled it, and not for how much.'],
  [
    'Invoice type and asset',
    'Standard, multipay or donation; which token. Public so the terms are checkable.',
  ],
  ['Expiry', 'When settlement stops being accepted.'],
  ['Contribution count', 'How many people paid a multipay invoice. Never the amounts.'],
  [
    'Payment nullifier',
    'A hash that stops a payment being replayed. It names no payer and no amount. The transaction that publishes it also touches the invoice commitment.',
  ],
  [
    'Receipt digest',
    'Proves a payment happened. Names no payer and no amount, but can be paired with the invoice commitment it settled, because one transaction publishes both.',
  ],
  ['Total invoices created', 'One counter. No breakdown.'],
];

const HIDDEN = [
  'The amount. Of any invoice, in any state, at any time.',
  'The merchant. Identity is a key that never leaves their device.',
  'The payer. Same.',
  'The salt: publishing it would make equal invoices linkable.',
  'Invoice titles and notes. Those never leave the browser at all.',
  'Which payments a revenue attestation counted.',
  'Gift card values, and when a gift card is spent.',
];

export function PrivacyPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="What is public," accent="what is not">
        A privacy product that cannot state precisely what it hides is asking to be taken on faith.
        This is the complete list, and the limits are on it too.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
            On chain, visible to everyone
          </h2>
          <div className="mt-4 space-y-4">
            {VISIBLE.map(([label, body]) => (
              <div key={label}>
                <p className="text-sm text-ink">{label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{body}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
            Never on chain
          </h2>
          <div className="mt-4 space-y-3">
            {HIDDEN.map((h) => (
              <PrivacyNote key={h}>{h}</PrivacyNote>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight">Limits we have not solved</h2>
        <div className="mt-4 space-y-4 text-sm leading-relaxed">
          <div>
            <p className="text-ink">Timing correlation</p>
            <p className="mt-1 text-ink-faint">
              On a quiet chain, an invoice created and then settled shortly after is linkable by
              timing alone. Volume mitigates this. Cryptography does not.
            </p>
          </div>
          <div>
            <p className="text-ink">Receipt and invoice can be paired</p>
            <p className="mt-1 text-ink-faint">
              Settlement is one transaction that touches the invoice commitment and publishes the
              receipt, so an observer reading it sees both together. The commitment is an opaque
              hash and the pairing reveals no amount, payer or merchant. Removing it needs a
              different settlement design, tracked in the threat model.
            </p>
          </div>
          <div>
            <p className="text-ink">Which action ran</p>
            <p className="mt-1 text-ink-faint">
              The chain sees which circuit was called — creating versus settling — even though the
              arguments stay private. Merging them behind one entry point would hide it, at the cost
              of a slower proof for every payment.
            </p>
          </div>
          <div>
            <p className="text-ink">The fee payer</p>
            <p className="mt-1 text-ink-faint">
              Transaction fees come from a wallet. That is a property of the network, not of Mask.
            </p>
          </div>
          <div>
            <p className="text-ink">Anyone you hand the terms to</p>
            <p className="mt-1 text-ink-faint">
              A payment link contains the amount — that is how the payer knows what to pay. Sending
              it to the wrong person tells them the amount, and no protocol prevents that.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight">Why you do not have to trust us</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-dim">
          <p>
            Proving runs on your machine. We do not operate a prover, because a prover sees the
            values it is proving about.
          </p>
          <p>
            Invoice terms live in your browser and travel in a URL fragment, which is never
            transmitted to a server. Our backend cannot leak an amount because it never receives
            one.
          </p>
          <p>
            The claims on this page are checked by tests that read each call&rsquo;s public transcript
            and every ledger collection, and fail if a private value appears in any common
            encoding. The search is proven able to find public values first. What is not yet
            covered is listed in the threat model.
          </p>
        </div>
      </Card>
    </div>
  );
}
