#!/usr/bin/env bash
cd "$(dirname "$0")"
exec npx vite --port 5177 --host 127.0.0.1 --strictPort >> dev.log 2>&1
