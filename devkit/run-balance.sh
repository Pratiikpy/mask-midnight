#!/usr/bin/env bash
# usage: run-balance.sh <network> <wallet>   -> /tmp/balance-<network>-<wallet>.log
cd "$(dirname "$0")"
[ -f ../.secrets/blockfrost.env ] && { set -a; . ../.secrets/blockfrost.env; set +a; }
export MASK_NETWORK="$1" NODE_OPTIONS=--max-old-space-size=9000
exec timeout 14000 node --experimental-strip-types src/balance.ts "$2" > "/tmp/balance-$1-$2.log" 2>&1
