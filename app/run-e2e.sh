#!/usr/bin/env bash
# Build the test bundle and run the browser suite, logging to /tmp.
cd "$(dirname "$0")"
npm run build:e2e > /tmp/e2e-build.log 2>&1 || { echo BUILD-FAILED >> /tmp/e2e-build.log; exit 1; }
timeout 1200 npx playwright test > /tmp/e2e-run.log 2>&1
echo "EXIT $?" >> /tmp/e2e-run.log
