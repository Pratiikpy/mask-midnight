#!/usr/bin/env bash
for p in $(pgrep -f "src/sync-only.ts"); do kill "$p" 2>/dev/null; done
echo killed
