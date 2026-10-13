#!/usr/bin/env bash
# usage: run-verify.sh <network> [wallet]  -> /tmp/verify-<network>.log
cd "$(dirname "$0")"
[ -f ../.secrets/blockfrost.env ] && { set -a; . ../.secrets/blockfrost.env; set +a; }
export MASK_NETWORK="$1" NODE_OPTIONS=--max-old-space-size=9000
exec timeout 20000 node --experimental-strip-types src/verify-deployment.ts "${2:-deployer}" > "/tmp/verify-$1.log" 2>&1
