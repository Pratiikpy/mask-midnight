#!/usr/bin/env bash
# usage: launch-sync.sh <network> [wallet]: start a resumable sync detached, leaving other syncs alone.
cd "$(dirname "$0")"
setsid nohup ./run-sync.sh "$@" >/dev/null 2>&1 </dev/null &
disown
echo started
