#!/usr/bin/env bash
# Start the optional services: the backend (checkout + assistant) and the
# Telegram bot.
#
# Both read their keys from midnight/.env, which is gitignored. Neither is
# required to use Mask — the app talks to the chain directly — so this is a
# separate script rather than part of the quick start.
#
# Run it in your own terminal. Ctrl-C stops both.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f .env ]; then
  echo "No .env here. It needs TELEGRAM_BOT_TOKEN, GOOGLE_API_KEY and MASK_CONTRACT_ADDRESS."
  exit 1
fi

set -a; . ./.env; set +a
export MASK_CONTRACT_ADDRESS="${MASK_CONTRACT_ADDRESS:-$(sed -n 's/^VITE_CONTRACT_ADDRESS=//p' app/.env.local | tr -d '\r')}"

echo "contract ${MASK_CONTRACT_ADDRESS:0:16}…"

node --experimental-strip-types backend/src/server.ts &
BACKEND=$!
node --experimental-strip-types bot/src/index.ts &
BOT=$!

# One Ctrl-C stops both, rather than leaving an orphan holding the bot token.
trap 'kill $BACKEND $BOT 2>/dev/null; exit 0' INT TERM
wait
