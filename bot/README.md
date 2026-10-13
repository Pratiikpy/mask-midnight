# Mask bot

A Telegram bot for Mask on Midnight. It reads public ledger state and hands out
links. It never holds a key, an invoice amount, or a salt.

## Why it does so little

A bot that created invoices, kept merchant sessions and quoted amounts would be
the obvious design. It is the wrong one here: the amount, the salt and the
merchant's identity key *are* the secret. A bot that created invoices would hold all three for every merchant it
served, rebuilding on one server exactly the database this product exists to
avoid. Telegram would hold it too: bot messages are plaintext to Telegram, so a
chat log of invoice terms is a chat log of everything the chain was carefully
not told.

So the split is:

| In the bot | In the browser |
|---|---|
| look up an invoice's status | create an invoice |
| check a receipt or attestation | pay one |
| watch for settlement | prove revenue |
| the public invoice count | anything else needing a secret |

## Commands

```
/invoice <commitment>    open, settled or cancelled — never an amount
/receipt <digest>        is this payment on the ledger
/attestation <digest>    was this revenue claim published
/watch <commitment>      one message when it settles
/unwatch <commitment>    stop
/watching                what this chat is watching
/stats                   invoices created — the one public aggregate
/create                  opens the invoice form in the browser
/pay <link>              opens a payment link in the browser
/privacy                 what this bot never sees
```

## Running it

Needs a bot token, which only you can create:

1. Message [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`.
2. It replies with a token like `123456789:AA...`.

```bash
export TELEGRAM_BOT_TOKEN='123456789:AA...'
export MASK_CONTRACT_ADDRESS="$(grep -oP 'VITE_CONTRACT_ADDRESS=\K.*' ../app/.env.local)"
export MASK_APP_URL='http://localhost:5175'      # optional
node --experimental-strip-types src/index.ts
```

It refuses to start without those two and says which is missing. Everything else
has a devnet default.

Long polling, not webhooks — a webhook needs a public HTTPS endpoint, which a
local devnet does not have. `getUpdates` works from behind a laptop.

## Tests

```bash
npx vitest run
```

56 tests, no token and no chain required: the router is a pure function and the
notifier is driven by hand. Among them is the one that matters most — every
reply the router can produce is checked against a chain reader that tries to
hand it an amount, a salt and a merchant key, and none of them appear.

## What is not covered

The process itself — long polling, sending, and the wiring in `src/index.ts` —
has no automated test, because exercising it needs a real token. That is why
there is almost nothing in that file: everything with a decision in it lives in
`commands.ts`, `watch.ts` and `config.ts`, which are tested.
