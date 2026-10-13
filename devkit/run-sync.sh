#!/usr/bin/env bash
# usage: run-sync.sh <network> [wallet]  -> /tmp/sync-<network>.log
cd "$(dirname "$0")"
[ -f ../.secrets/blockfrost.env ] && { set -a; . ../.secrets/blockfrost.env; set +a; }
export MASK_NETWORK="$1" NODE_OPTIONS=--max-old-space-size=9000
exec timeout 50000 node --experimental-strip-types src/sync-only.ts "${2:-deployer}" >> "/tmp/sync-$1.log" 2>&1
