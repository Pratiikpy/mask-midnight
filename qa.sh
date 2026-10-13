#!/usr/bin/env bash
# Full-system QA for Mask on Midnight.
#
# Runs every automated suite and every live check against the running devnet,
# and prints one verdict. Exits non-zero if anything fails, so it can gate a
# release rather than being read optimistically.
#
#   bash qa.sh
#
# Requires: the devnet up, mask_pay deployed (devkit/src/deploy.ts), and the
# contract seeded (devkit/src/seed.ts) for the live checks.

set -u
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PASS=0
FAIL=0
SKIP=0
declare -a RESULTS

record() {
  local status="$1" name="$2" detail="${3:-}"
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP) SKIP=$((SKIP + 1)) ;;
  esac
  RESULTS+=("$(printf '%-6s %-38s %s' "$status" "$name" "$detail")")
}

hr() { printf '%s\n' "------------------------------------------------------------------"; }

# ---------------------------------------------------------------- environment

hr; echo "ENVIRONMENT"; hr

for c in mask-node mask-indexer mask-proof-server; do
  if docker ps --filter "name=$c" --format '{{.Names}}' 2>/dev/null | grep -q "$c"; then
    record PASS "devnet: $c" "running"
  else
    record FAIL "devnet: $c" "not running"
  fi
done

if curl -sf --max-time 5 http://localhost:6300/health >/dev/null 2>&1; then
  record PASS "proof server /health" "200"
else
  record FAIL "proof server /health" "unreachable"
fi

BLOCK=$(curl -s --max-time 5 -X POST http://localhost:8088/api/v4/graphql \
  -H 'Content-Type: application/json' -d '{"query":"{ block { height } }"}' 2>/dev/null \
  | grep -oP '"height":\K[0-9]+' || true)
if [ -n "$BLOCK" ]; then
  record PASS "indexer reachable" "block $BLOCK"
else
  record FAIL "indexer reachable" "no response"
fi

ADDR=""
if [ -f "$ROOT/app/.env.local" ]; then
  ADDR=$(grep -oP 'VITE_CONTRACT_ADDRESS=\K\w+' "$ROOT/app/.env.local" || true)
fi
if [ -n "$ADDR" ]; then
  record PASS "contract deployed" "${ADDR:0:16}…"
else
  record FAIL "contract deployed" "no address in app/.env.local"
fi

# ------------------------------------------------------------------ contracts

hr; echo "CONTRACTS"; hr

COMPACT="$HOME/.local/bin/compact"
if [ -x "$COMPACT" ]; then
  for name in mask_pay mask_token mask_card mask_gift mask_smoke; do
    OUT=$(mktemp -d)
    if "$COMPACT" compile +0.31.1 "$ROOT/contracts/src/$name.compact" "$OUT" >/dev/null 2>&1 \
       && [ -f "$OUT/compiler/contract-info.json" ]; then
      N=$(python3 -c "import json;print(len(json.load(open('$OUT/compiler/contract-info.json'))['circuits']))")
      record PASS "compiles: $name" "$N circuits"
    else
      record FAIL "compiles: $name" "compiler error"
    fi
    rm -rf "$OUT"
  done
else
  record SKIP "contract compilation" "compact CLI not installed"
fi

# ---------------------------------------------------------------- test suites

hr; echo "TEST SUITES"; hr

run_vitest() {
  local name="$1" dir="$2"
  if [ ! -d "$dir" ]; then record SKIP "$name" "not present"; return; fi
  local out
  out=$(cd "$dir" && npx vitest run 2>&1)
  local line
  line=$(echo "$out" | grep -oP 'Tests\s+\K.*' | head -1)
  if echo "$out" | grep -q "Tests.*failed"; then
    record FAIL "$name" "$line"
  elif [ -n "$line" ]; then
    record PASS "$name" "$line"
  else
    record FAIL "$name" "no test output"
  fi
}

run_vitest "contracts suite"   "$ROOT/contracts"
run_vitest "node sdk suite"    "$ROOT/packages/mask-node"
run_vitest "backend suite"     "$ROOT/backend"
run_vitest "bot suite"         "$ROOT/bot"

# A missing pytest must not read as success. An earlier version of this check
# treated "No module named pytest" as a pass because the string contained
# neither "failed" nor "error" — a false green, which is worse than a red.
if ! command -v python3 >/dev/null; then
  record SKIP "python sdk suite" "python3 unavailable"
elif ! python3 -c "import pytest" >/dev/null 2>&1; then
  record SKIP "python sdk suite" "pytest not installed"
elif [ ! -d "$ROOT/packages/mask-python" ]; then
  record SKIP "python sdk suite" "package not present"
else
  PY=$(cd "$ROOT/packages/mask-python" && python3 -m pytest tests -q 2>&1 | tail -1)
  if echo "$PY" | grep -qE '[0-9]+ passed' && ! echo "$PY" | grep -qE 'failed|error'; then
    record PASS "python sdk suite" "$PY"
  else
    record FAIL "python sdk suite" "$PY"
  fi
fi

# --------------------------------------------------------------- live on-chain

hr; echo "LIVE ON-CHAIN"; hr

if [ -n "$ADDR" ]; then
  LIVE=$(cd "$ROOT/packages/mask-node" && node --experimental-strip-types live-check.ts 2>&1)
  if echo "$LIVE" | grep -q "ALL LIVE CHECKS PASSED"; then
    N=$(echo "$LIVE" | grep -c '^PASS')
    record PASS "sdk reads real chain state" "$N checks"
  else
    record FAIL "sdk reads real chain state" "$(echo "$LIVE" | grep '^FAIL' | head -1)"
  fi
else
  record SKIP "sdk reads real chain state" "no contract deployed"
fi

# The reference token, end to end: minted on chain, invoiced, and settled with
# the minted coin — plus the wrong-asset attempt the contract must refuse.
if [ -n "$ADDR" ]; then
  TOK=$(cd "$ROOT/devkit" && node --experimental-strip-types src/token-e2e.ts 2>&1)
  if echo "$TOK" | grep -q "mUSDC E2E PASSED"; then
    record PASS "mUSDC minted and spent" "$(echo "$TOK" | grep -oP 'settled with mUSDC     yes \(\K[0-9]+ms')"
  else
    record FAIL "mUSDC minted and spent" "$(echo "$TOK" | grep -E 'FAILED|refused|control' | head -1)"
  fi

  # The result the browser payment path depends on: a coin the DApp invents,
  # funded by the wallet during balancing. Without it the Pay page cannot offer
  # escrow at all, so it is checked rather than remembered.
  FRESH=$(cd "$ROOT/devkit" && node --experimental-strip-types src/fresh-coin-probe.ts 2>&1)
  if echo "$FRESH" | grep -q "ACCEPTED"; then
    record PASS "wallet funds an invented coin" "browser escrow path is viable"
  else
    record FAIL "wallet funds an invented coin" "$(echo "$FRESH" | grep -A1 'REJECTED' | tail -1)"
  fi
else
  record SKIP "mUSDC minted and spent" "no contract deployed"
  record SKIP "wallet funds an invented coin" "no contract deployed"
fi

# ------------------------------------------------------------------ prod build

hr; echo "PRODUCTION BUILD"; hr

# The app only ever ran in dev until this check existed, and the production
# build was broken three separate ways: an unresolvable polyfill shim, a
# top-level-await plugin crashing inside SWC, and — the one that would have
# survived to deployment — a duplicated WASM runtime that made every chain read
# fail with "expected instance of Oi". A dev server proves nothing about any of
# them, so the build runs here.
BUILD=$(cd "$ROOT/app" && npx vite build 2>&1)
if echo "$BUILD" | grep -q "built in"; then
  SIZE=$(echo "$BUILD" | grep -oP 'dist/assets/index-\S+\.js\s+\K[0-9,.]+ kB' | head -1)
  record PASS "app production build" "${SIZE:-built}"

  # One copy of each WASM module, not two. Two is the duplication bug.
  LEDGER_COPIES=$(ls "$ROOT/app/dist/assets/" 2>/dev/null | grep -c 'midnight_ledger_wasm_bg.*\.wasm')
  if [ "$LEDGER_COPIES" = "1" ]; then
    record PASS "single ledger WASM in bundle" "no duplicate runtime"
  else
    record FAIL "single ledger WASM in bundle" "$LEDGER_COPIES copies — chain reads will fail"
  fi
else
  record FAIL "app production build" "$(echo "$BUILD" | grep -E 'error|Error' | head -1)"
  record SKIP "single ledger WASM in bundle" "build failed"
fi

# Installability: a manifest with no icons gets no install prompt, which is the
# state this was in.
ICONS=$(python3 -c "import json;print(len(json.load(open('$ROOT/app/public/manifest.webmanifest'))['icons']))" 2>/dev/null)
if [ "${ICONS:-0}" -ge 3 ] && [ -f "$ROOT/app/public/sw.js" ]; then
  record PASS "PWA installable" "$ICONS icons, service worker present"
else
  record FAIL "PWA installable" "icons=${ICONS:-0}, sw.js=$([ -f "$ROOT/app/public/sw.js" ] && echo yes || echo no)"
fi

# ---------------------------------------------------------------------- backend

hr; echo "BACKEND"; hr

# The backend is optional — the app talks to the chain directly — so a missing
# one is a SKIP, not a failure. A running one that answers wrongly is a failure.
if curl -sf --max-time 5 http://localhost:3100/health >/dev/null 2>&1; then
  HEALTH=$(curl -s --max-time 5 http://localhost:3100/health)
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    record PASS "backend health" "contract $(echo "$HEALTH" | grep -oP '"contract":"\K[0-9a-f]{16}')…"
  else
    record FAIL "backend health" "$HEALTH"
  fi

  # The assistant must report honestly whether it can answer, because the app
  # hides the chat box entirely when it cannot.
  ASSIST=$(curl -s --max-time 5 http://localhost:3100/api/assistant)
  if echo "$ASSIST" | grep -q '"configured":true'; then
    record PASS "assistant" "configured"
  elif echo "$ASSIST" | grep -q '"configured":false'; then
    record SKIP "assistant" "no GOOGLE_API_KEY — the app hides it, by design"
  else
    record FAIL "assistant" "$ASSIST"
  fi

  # The boundary that matters: a request carrying a private field is refused,
  # not quietly stripped and forwarded to a third party.
  LEAKTEST=$(curl -s --max-time 8 -X POST http://localhost:3100/api/assistant/chat     -H 'Content-Type: application/json'     -d '{"messages":[{"role":"user","content":"hi"}],"context":{"amount":42500}}')
  if echo "$LEAKTEST" | grep -q 'Refused: amount'; then
    record PASS "assistant refuses an amount" "rejected before the request is built"
  else
    record FAIL "assistant refuses an amount" "$LEAKTEST"
  fi
else
  record SKIP "backend health" "not running"
  record SKIP "assistant" "backend not running"
  record SKIP "assistant refuses an amount" "backend not running"
fi

# ------------------------------------------------------------------------- app

hr; echo "APP"; hr

if curl -sf --max-time 5 http://localhost:5175/ >/dev/null 2>&1; then
  record PASS "app serving" "http://localhost:5175"
  for route in "" create dashboard pay batch giftcards cards attest explorer verify vision privacy docs support settings; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:5175/$route")
    if [ "$CODE" = "200" ]; then
      record PASS "route /$route" "200"
    else
      record FAIL "route /$route" "$CODE"
    fi
  done
else
  record SKIP "app serving" "dev server not running"
fi

# ------------------------------------------------------------------ privacy

hr; echo "PRIVACY ASSERTIONS"; hr

# The claim the whole product rests on, checked against everything an outside
# observer can read: every block the indexer holds, every raw transaction in
# them, and the contract's own state — roughly four million characters.
#
# Two earlier versions of this check were wrong in opposite directions, and both
# lessons are baked into the tools it now calls:
#
#   * It searched only the contract's latest action while claiming to search
#     every transaction. The query behind that claim was malformed and its
#     failure was swallowed, so it passed over a haystack it never fetched.
#   * Its needle set held only padded machine words. Midnight stores a ledger
#     integer in the fewest bytes that hold it, so a value published in the
#     clear was invisible to the search — a clean result that meant nothing.
#
# Hence the control probe below: it publishes a value deliberately and fails if
# the search cannot find it. A privacy pass is only reported when the search has
# proven it can see something.

# The claim, checked on the contract the app actually talks to. seed.ts plants
# a canary: an amount six bytes wide that must stay hidden, beside an expiry
# published in the clear that must be found. Realistic demo amounts like 42_500
# encode as two bytes and collide by chance in a megabyte of hex, so they cannot
# decide anything either way — the canary carries the proof instead.
if [ -n "$ADDR" ]; then
  CAN=$(cd "$ROOT/devkit" && node --experimental-strip-types src/check-canary.ts "$ADDR" 2>&1)
  if echo "$CAN" | grep -q "PRIVACY VERIFIED on the deployed contract"; then
    record PASS "no private amount on chain" "$(echo "$CAN" | grep -oP 'searched\s+\K[0-9]+') chars, search proven sighted"
  elif echo "$CAN" | grep -q "CANARY UNPROVEN"; then
    record FAIL "no private amount on chain" "search could not see a value published in the clear"
  else
    record FAIL "no private amount on chain" "$(echo "$CAN" | grep -E 'LEAKED|FAILED' | head -1)"
  fi
else
  record SKIP "no private amount on chain" "no contract deployed"
fi

# Does the search work at all? Publishes a public value and a private one on a
# throwaway contract, then requires the public one to be found and the private
# one not to be.
CTRL=$(cd "$ROOT/devkit" && node --experimental-strip-types src/control-probe.ts 2>&1)
if echo "$CTRL" | grep -q "PRIVACY VERIFIED"; then
  record PASS "privacy search proven sighted" "public value found, private value absent"
elif echo "$CTRL" | grep -q "CHECK UNPROVEN"; then
  record FAIL "privacy search proven sighted" "search is blind to public values"
else
  record FAIL "privacy search proven sighted" "$(echo "$CTRL" | tail -1)"
fi

# The attestation, proven on chain rather than in the simulator: four real
# payments, four Merkle paths out of the live ledger, one proof.
ATT=$(cd "$ROOT/devkit" && node --experimental-strip-types src/attest-e2e.ts 2>&1)
if echo "$ATT" | grep -q "ATTESTATION E2E PASSED"; then
  record PASS "revenue attestation on chain" "$(echo "$ATT" | grep -oP 'attest_revenue_at_least\s+\K[0-9]+ms')"
else
  record FAIL "revenue attestation on chain" "$(echo "$ATT" | grep -E 'FAILED|CONTROL' | head -1)"
fi

# ---------------------------------------------------------------------- report

hr; echo "RESULTS"; hr
printf '%s\n' "${RESULTS[@]}"
hr
printf 'PASS %d   FAIL %d   SKIP %d\n' "$PASS" "$FAIL" "$SKIP"
hr

if [ "$FAIL" -gt 0 ]; then
  echo "QA FAILED"
  exit 1
fi
echo "QA PASSED"
