#!/usr/bin/env bash
# End-to-end check of the free quota -> 402 path.
#
# Starts the demo origin and the gateway, spends the free quota, shows the 402
# with both payment rails, and reads the offer status. Settlement is not part of
# this script yet: see docs/05-roadmap.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGIN_PORT="${ORIGIN_PORT:-8787}"
AWALL_PORT="${AWALL_PORT:-8402}"
API_KEY="${API_KEY:-demo-key}"
PAY_TO="${STELLAR_PAY_TO:-GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO}"
LOG_DIR="$(mktemp -d)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

wait_for() {
  local url="$1"
  for _ in $(seq 1 40); do
    if curl -fs -o /dev/null "$url"; then return 0; fi
    sleep 0.25
  done
  echo "timed out waiting for $url" >&2
  return 1
}

echo "== starting origin-demo on :$ORIGIN_PORT"
ORIGIN_PORT="$ORIGIN_PORT" pnpm --dir "$ROOT" --filter @awall/origin-demo start \
  >"$LOG_DIR/origin.log" 2>&1 &
PIDS+=("$!")

echo "== starting gateway on :$AWALL_PORT"
AWALL_PORT="$AWALL_PORT" STELLAR_PAY_TO="$PAY_TO" \
  pnpm --dir "$ROOT" --filter @awall/gateway start >"$LOG_DIR/gateway.log" 2>&1 &
PIDS+=("$!")

wait_for "http://127.0.0.1:$ORIGIN_PORT/healthz"
wait_for "http://127.0.0.1:$AWALL_PORT/healthz"

echo "== spending the free quota"
calls=0
while :; do
  calls=$((calls + 1))
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "x-api-key: $API_KEY" "http://127.0.0.1:$AWALL_PORT/v1/search?q=camera")
  if [ "$code" = "402" ]; then
    echo "   call $calls answered 402 (not 429)"
    break
  fi
  if [ "$code" != "200" ]; then
    echo "   unexpected status $code on call $calls" >&2
    tail -20 "$LOG_DIR/gateway.log" >&2
    exit 1
  fi
  if [ "$calls" -gt 1000 ]; then
    echo "   quota never ran out: check awall.yaml" >&2
    exit 1
  fi
done

echo "== payment terms"
body="$LOG_DIR/402.json"
curl -s -H "x-api-key: $API_KEY" "http://127.0.0.1:$AWALL_PORT/v1/search?q=camera" -o "$body"
python3 "$ROOT/scripts/print_rails.py" "$body"

offer="$(python3 "$ROOT/scripts/print_rails.py" --offer-id "$body")"

echo "== offer status"
echo -n "   "
curl -s -w " <- %{http_code}\n" "http://127.0.0.1:$AWALL_PORT/awall/offers/$offer"

echo "== origin failure refunds the quota"
curl -s -o /dev/null -D "$LOG_DIR/flaky.h" \
  -H "x-api-key: refund-$RANDOM" "http://127.0.0.1:$AWALL_PORT/v1/flaky?fail=1"
grep -i "x-awall-free-remaining-credits" "$LOG_DIR/flaky.h" | sed 's/^/   /'

echo "== done"
