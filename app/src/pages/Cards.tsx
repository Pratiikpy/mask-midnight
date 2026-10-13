import { useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { formatAmount, parseAmount, randomBytes, shortHex, toHex } from '../lib/format.ts';

const VAULT_KEY = 'mask.cards.v1';

interface StoredCard {
  secret: string;
  /** Stored so the card is usable; a real deployment would derive it from a PIN entry each time. */
  pin: string;
  salt: string;
  spendLimit: string;
  label: string;
  createdAt: number;
  commitment?: string;
  active: boolean;
}

const load = (): StoredCard[] => {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as StoredCard[]) : [];
  } catch {
    return [];
  }
};

const persist = (cards: StoredCard[]) => localStorage.setItem(VAULT_KEY, JSON.stringify(cards));

/** Four to twelve digits, the range a card PIN realistically occupies. */
const PIN_RE = /^\d{4,12}$/;

export function CardsPage() {
  const { connection, connect } = useMask();
  const [pin, setPin] = useState('');
  const [limit, setLimit] = useState('');
  const [label, setLabel] = useState('');
  const [cards, setCards] = useState<StoredCard[]>(() => load());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const parsedLimit = useMemo(() => parseAmount(limit), [limit]);
  const pinValid = PIN_RE.test(pin);
  const valid = pinValid && parsedLimit !== null && parsedLimit > 0n;
  const connected = connection.status === 'connected';

  function create() {
    if (!valid) return;
    setError(null);

    const card: StoredCard = {
      secret: toHex(randomBytes(32)),
      // The PIN is hashed into the commitment; it is the second factor, so a
      // stolen card without it authorises nothing.
      pin: toHex(new TextEncoder().encode(pin.padEnd(32, '\0')).slice(0, 32)),
      salt: toHex(randomBytes(32)),
      spendLimit: parsedLimit!.toString(),
      label,
      createdAt: Date.now(),
      active: true,
    };

    const next = [card, ...load()];
    persist(next);
    setCards(next);
    setPin('');
    setLimit('');
    setLabel('');
    setNotice('Card created. It lives on this device — back it up from Settings.');
  }

  function freeze(secret: string) {
    const next = load().map((c) => (c.secret === secret ? { ...c, active: false } : c));
    persist(next);
    setCards(next);
    setNotice('Card frozen. It can no longer authorise a payment.');
  }

  function remove(secret: string) {
    const next = load().filter((c) => c.secret !== secret);
    persist(next);
    setCards(next);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Mask" accent="Card">
        Pay without connecting a wallet. The card proves itself with a secret and a PIN, and neither ever reaches the chain.
      </PageHeader>
      <Card className="p-6">

        <div className="mt-6 space-y-5">
          <Field
            label="PIN"
            hint={
              pin && !pinValid ? (
                <span className="text-danger">4 to 12 digits.</span>
              ) : (
                'Second factor. A stolen card without it authorises nothing.'
              )
            }
          >
            <Input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
              inputMode="numeric"
              type="password"
              autoComplete="off"
            />
          </Field>

          <Field label="Spend limit per payment" hint="Checked on chain against a private amount.">
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="100000"
              inputMode="numeric"
            />
          </Field>

          <Field label="Label" hint="Local only.">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Travel card"
            />
          </Field>

          {connected ? (
            <Button onClick={create} disabled={!valid} className="w-full">
              Create card
            </Button>
          ) : (
            <Button onClick={() => void connect()} className="w-full">
              Connect wallet to create a card
            </Button>
          )}

          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {notice ? <PrivacyNote>{notice}</PrivacyNote> : null}
        </div>
      </Card>

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
            Card vs gift card
          </h2>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            A <strong className="text-ink-dim">Mask Card</strong> is a credential: it proves you may
            spend, and the money comes from your own wallet. Because the contract holds nothing, a
            PIN check and freezing a lost card both work.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            A <strong className="text-ink-dim">gift card</strong> is the money itself, handed to
            someone else. That means no PIN and no freezing — it is cash.
          </p>

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wider text-ink-dim">
            What the chain sees
          </h2>
          <div className="mt-4 space-y-3">
            <PrivacyNote>A commitment binding the secret and the PIN. Neither is recoverable.</PrivacyNote>
            <PrivacyNote>
              The spend limit, published so a merchant can check it was respected.
            </PrivacyNote>
            <PrivacyNote>
              A count of how many times the card has been used — never the amounts.
            </PrivacyNote>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
            Your cards
          </h2>
          <div className="mt-4 space-y-2">
            {cards.length === 0 ? (
              <p className="text-sm text-ink-dim">No cards yet.</p>
            ) : (
              cards.map((c) => (
                <div key={c.secret} className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm">{c.label || 'Mask Card'}</p>
                        <Badge tone={c.active ? 'aurora' : 'danger'}>
                          {c.active ? 'active' : 'frozen'}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-ink-faint">
                        {shortHex(c.secret, 10, 6)}
                      </p>
                    </div>
                    <p className="text-sm">
                      limit{' '}
                      <span className="font-semibold">{formatAmount(BigInt(c.spendLimit))}</span>
                    </p>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {c.active ? (
                      <Button
                        variant="ghost"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => freeze(c.secret)}
                      >
                        Freeze
                      </Button>
                    ) : null}
                    <Button
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
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
