#!/usr/bin/env bash
# usage: watch-balance.sh <network> <wallet>: wait for the sync to finish, report peak memory and the result.
log="/tmp/balance-$1-$2.log"; peak=0
while pgrep -f "balance.ts $2" >/dev/null; do
  r=$(ps -o rss= -p "$(pgrep -f "node --experimental-strip-types src/balance.ts $2" | tail -1)" 2>/dev/null | tr -d ' ')
  [ -n "$r" ] && [ "$r" -gt "$peak" ] && peak=$r
  sleep 20
done
echo "peak_rss_mb=$((peak/1024))"
grep -A10 '^{' "$log" || grep -v RPC-CORE "$log" | tail -8 | sed 's/project_id=[A-Za-z0-9]*/project_id=***/g'
