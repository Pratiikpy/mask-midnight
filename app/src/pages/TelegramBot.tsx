import { Badge, Card, PrivacyNote } from '../components/ui.tsx';

const COMMANDS: [string, string][] = [
  ['/invoice <commitment>', 'Open, settled or cancelled. Never an amount.'],
  ['/receipt <digest>', 'Is this payment on the ledger.'],
  ['/attestation <digest>', 'Was this revenue claim published.'],
  ['/watch <commitment>', 'One message when it settles.'],
  ['/unwatch <commitment>', 'Stop watching.'],
  ['/watching', 'What this chat is watching.'],
  ['/stats', 'Invoices created: the one public aggregate.'],
  ['/create', 'Opens the invoice form in the browser.'],
  ['/pay <link>', 'Opens a payment link in the browser.'],
  ['/privacy', 'What this bot never sees.'],
];

const SPLIT: [string, string][] = [
  ['Look up an invoice’s status', 'Create an invoice'],
  ['Check a receipt or attestation', 'Pay one'],
  ['Watch for settlement', 'Prove revenue'],
  ['The public invoice count', 'Anything else that needs a secret'],
];

export function TelegramBotPage() {
  return (
    <div className="space-y-6">
      <Card className="p-6 sm:p-8">
        <Badge tone="aurora">integrations</Badge>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">
          A bot that <em className="text-aurora">knows nothing</em> worth stealing.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">
          The Telegram bot reads public ledger state and hands out links. It never holds a key, an
          invoice amount or a salt, because bot messages are plaintext to Telegram and a chat log of
          invoice terms would be a chat log of everything the chain was careful not to learn.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-dim">
            Where each job happens
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <span className="text-xs uppercase tracking-wider text-aurora">In the bot</span>
            <span className="text-xs uppercase tracking-wider text-nova">In the browser</span>
            {SPLIT.map(([a, b]) => (
              <div key={a} className="contents">
                <span className="text-ink-dim">{a}</span>
                <span className="text-ink-dim">{b}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-dim">Commands</h2>
          <div className="mt-4 space-y-2">
            {COMMANDS.map(([c, d]) => (
              <div key={c} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line/60 py-2">
                <code className="font-mono text-xs text-aurora">{c}</code>
                <span className="text-sm text-ink-dim">{d}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-dim">Running it yourself</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          You bring the bot token, which only you can create: message @BotFather, send /newbot, and
          pass the token in <code className="font-mono text-xs text-aurora">TELEGRAM_BOT_TOKEN</code>.
          It refuses to start without a token and a contract address, and says which is missing. It
          uses long polling, so it works from behind a laptop with no public endpoint.
        </p>
        <div className="mt-4 space-y-2">
          <PrivacyNote>No hosted bot is offered. A hosted bot would have to be trusted with chat metadata.</PrivacyNote>
          <PrivacyNote>The router is a pure function: every reply it can produce is tested against a chain reader that tries to hand it an amount, a salt and a merchant key.</PrivacyNote>
        </div>
      </Card>
    </div>
  );
}
