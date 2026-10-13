#!/usr/bin/env bash
# usage: start-public.sh <network> [wallet]  — stop any balance probe for the wallet, then start the full run detached.
cd "$(dirname "$0")"
for p in $(pgrep -f "src/balance.ts"); do kill "$p" 2>/dev/null; done
sleep 2
rm -f "/tmp/public-$1.log"
setsid nohup ./run-public.sh "$@" >/dev/null 2>&1 </dev/null &
disown
echo started
