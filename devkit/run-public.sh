#!/usr/bin/env bash
# usage: run-public.sh <network> [wallet]  -> /tmp/public-<network>.log
cd "$(dirname "$0")"
[ -f ../.secrets/blockfrost.env ] && { set -a; . ../.secrets/blockfrost.env; set +a; }
export MASK_NETWORK="$1" NODE_OPTIONS=--max-old-space-size=9000
exec timeout 36000 node --experimental-strip-types src/public-run.ts "${2:-deployer}" > "/tmp/public-$1.log" 2>&1
