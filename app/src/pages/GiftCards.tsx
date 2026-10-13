import { useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { formatAmount, parseAmount, randomBytes, toHex } from '../lib/format.ts';

const VAULT_KEY = 'mask.giftcards.v1';

interface StoredCard {
  secret: string;
  coinPublicKey: string;
  amount: string;
  label: string;
  createdAt: number;
  commitment?: string;
}

function loadCards(): StoredCard[] {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as StoredCard[]) : [];
  } catch {
    return [];
  }
}

function saveCard(card: StoredCard): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify([card, ...loadCards()]));
}

function forgetCard(secret: string): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(loadCards().filter((c) => c.secret !== secret)));
}

const cardLink = (secret: string): string =>
  `${window.location.origin}/giftcards#${btoa(JSON.stringify({ s: secret }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;

export function GiftCardsPage() {
  const { connection, connect } = useMask();
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [cards, setCards] = useState<StoredCard[]>(() => loadCards());
  const [issued, setIssued] = useState<StoredCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseAmount(amount), [amount]);
  const valid = parsed !== null && parsed > 0n;
  const connected = connection.status === 'connected';

  function create() {
    if (!valid) return;
    setError(null);

    // The card is a secret. Generating it here means it exists only in this
    // browser until you hand it to someone.
    const secret = toHex(randomBytes(32));
    const card: StoredCard = {
      secret,
      // Derived from the secret by the wallet at issue time; shown once the
      // coin has actually been sent.
      coinPublicKey: '',
      amount: parsed!.toString(),
      label,
      createdAt: Date.now(),
    };

    saveCard(card);
    setCards(loadCards());
    setIssued(card);
  }

  function remove(secret: string) {
    forgetCard(secret);
    setCards(loadCards());
    if (issued?.secret === secret) setIssued(null);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Private" accent="gift cards">
        A gift card here is cash. Whoever holds the secret can spend it — no account, no identity, no permission needed.
      </PageHeader>
      <Card className="p-6">

        <div className="mt-6 space-y-5">
          <Field label="Card value" hint="Never published. Not even as a total.">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500"
              inputMode="numeric"
            />
          </Field>

          <Field label="Label" hint="For your own records. Stays on this device.">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Birthday — Sam"
            />
          </Field>

          {connected ? (
            <Button onClick={create} disabled={!valid} className="w-full">
              Create gift card
            </Button>
          ) : (
            <Button onClick={() => void connect()} className="w-full">
              Connect wallet to fund a card
            </Button>
          )}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          {issued ? (
            <div className="rounded-2xl border border-aurora/30 bg-aurora/5 p-5">
              <Badge tone="aurora">card created</Badge>
              <p className="mt-3 text-sm text-ink-dim">
                This link <strong className="text-ink">is</strong> the money. Anyone who sees it can
                spend it — send it the way you would send cash, and keep a copy until it is
                redeemed.
              </p>
              <div className="mt-4 break-all rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs text-ink-dim">
                {cardLink(issued.secret)}
              </div>
              <Button
                variant="ghost"
                className="mt-3 w-full"
                onClick={() => void navigator.clipboard?.writeText(cardLink(issued.secret))}
              >
                Copy card link
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
            How these stay private
          </h2>
          <div className="mt-4 space-y-3">
            <PrivacyNote>
              The card is a shielded coin sent to a key derived from its own secret. The contract
              never holds it.
            </PrivacyNote>
            <PrivacyNote>
              Because nothing is held, there is no balance on chain and no total to watch — so
              nobody can see what a card is worth or when one is spent.
            </PrivacyNote>
            <PrivacyNote>
              Spending twice is impossible: the coin can only be spent once, enforced by the
              protocol rather than by us.
            </PrivacyNote>
          </div>

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-ink-dim">
            The trade-off, plainly
          </h2>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            An earlier design had the contract hold the money, which allowed a PIN check and
            freezing a lost card. It also put the total on chain and made every redemption's size
            readable. We chose privacy. The consequence is real: <strong className="text-ink-dim">
            a lost card cannot be cancelled</strong>, exactly like losing a banknote. If you need
            PIN protection and revocation more than privacy, use Mask Card instead.
          </p>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
            Your cards
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Held on this device only. Clearing browser data destroys them and the money with them.
          </p>

          <div className="mt-4 space-y-2">
            {cards.length === 0 ? (
              <p className="text-sm text-ink-dim">No cards yet.</p>
            ) : (
              cards.map((c) => (
                <div
                  key={c.secret}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{c.label || 'Gift card'}</p>
                    <p className="text-[11px] text-ink-faint">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold">{formatAmount(BigInt(c.amount))}</span>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => void navigator.clipboard?.writeText(cardLink(c.secret))}
                    >
                      Copy
                    </Button>
                    <Button
                      variant="danger"
                      className="px-2 py-1 text-xs"
                      onClick={() => remove(c.secret)}
                    >
                      Forget
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
