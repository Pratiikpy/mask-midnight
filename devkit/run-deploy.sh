#!/usr/bin/env bash
# usage: run-deploy.sh <network> [wallet]  -> /tmp/deploy-<network>.log
cd "$(dirname "$0")"
[ -f ../.secrets/blockfrost.env ] && { set -a; . ../.secrets/blockfrost.env; set +a; }
export MASK_NETWORK="$1" NODE_OPTIONS=--max-old-space-size=9000
exec timeout 20000 node --experimental-strip-types src/deploy-public.ts "${2:-deployer}" > "/tmp/deploy-$1.log" 2>&1
