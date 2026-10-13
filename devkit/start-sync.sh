#!/usr/bin/env bash
# usage: start-sync.sh <network> [wallet]: stop stale runs, then start the resumable sync detached.
cd "$(dirname "$0")"
for p in $(pgrep -f "src/public-run.ts") $(pgrep -f "src/sync-only.ts"); do kill "$p" 2>/dev/null; done
sleep 2
setsid nohup ./run-sync.sh "$@" >/dev/null 2>&1 </dev/null &
disown
echo started
