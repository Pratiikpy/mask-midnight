#!/usr/bin/env bash
cd "$(dirname "$0")"
exec npx vite preview --port 5175 --host 127.0.0.1 --strictPort >> preview.log 2>&1
