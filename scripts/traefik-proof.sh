#!/usr/bin/env bash
# Mode B end to end: a real Traefik with the shipped forwardAuth middleware.
#
# Starts the gateway and a protected application on the host, runs Traefik in
# Docker with deploy/traefik/dynamic.yml, and checks four things:
#
#   1. an allowed request reaches the application, carrying the decision
#      headers that forwardAuth copies onto the upstream request;
#   2. the 402 reaches the client whole, with the PAYMENT-REQUIRED header and
#      the same accepts array as inline mode;
#   3. a request with PAYMENT-SIGNATURE skips forwardAuth and lands on the
#      gateway's settlement path, by the header routing rule;
#   4. the reservation the application received buys exactly one usage report.
#
# The application is an echo server, because what is under test is what the
# edge puts on the upstream request, and only the application can see that.
#
# Needs Docker. Everything it starts is torn down on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-8788}"
AWALL_PORT="${AWALL_PORT:-8432}"
EDGE_PORT="${EDGE_PORT:-8431}"
API_KEY="${API_KEY:-traefik-key}"
# A key of its own, so the free quota spent above does not pay for the
# metered route and hide the adjustment behind a credit debit.
METERED_KEY="${METERED_KEY:-traefik-metered-key}"
HOST_HEADER="${HOST_HEADER:-api.traefik.test}"
PAY_TO="${STELLAR_PAY_TO:-GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO}"
TRAEFIK_NAME="awall-traefik-proof"
LOG_DIR="$(mktemp -d)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  docker rm -f "$TRAEFIK_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for() {
  local url="$1"
  shift
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null "$@" "$url"; then return 0; fi
    sleep 0.25
  done
  echo "timed out waiting for $url" >&2
  return 1
}

fail() {
  echo "   FAIL: $1" >&2
  exit 1
}

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

echo "== starting the echo application on :$APP_PORT"
node "$ROOT/scripts/echo-app.mjs" "$APP_PORT" >"$LOG_DIR/app.log" 2>&1 &
PIDS+=("$!")
wait_for "http://127.0.0.1:$APP_PORT/v1/health"

echo "== starting gateway on :$AWALL_PORT"
AWALL_PORT="$AWALL_PORT" STELLAR_PAY_TO="$PAY_TO" \
  pnpm --dir "$ROOT" --filter @awall/gateway start >"$LOG_DIR/gateway.log" 2>&1 &
PIDS+=("$!")
wait_for "http://127.0.0.1:$AWALL_PORT/v1/health"

# The shipped dynamic.yml with the three deployment-specific values replaced:
# the host, the gateway address and the application behind the edge.
sed \
  -e "s|api.exemplo.com|$HOST_HEADER|g" \
  -e "s|http://awall:8402|http://127.0.0.1:$AWALL_PORT|g" \
  -e "s|http://app:8080|http://127.0.0.1:$APP_PORT|g" \
  "$ROOT/deploy/traefik/dynamic.yml" >"$LOG_DIR/dynamic.yml"

cat >"$LOG_DIR/traefik.yml" <<EOF
entryPoints:
  web:
    address: ":$EDGE_PORT"
providers:
  file:
    filename: /etc/traefik/dynamic.yml
log:
  level: INFO
EOF

echo "== starting traefik on :$EDGE_PORT with the shipped forwardAuth middleware"
docker rm -f "$TRAEFIK_NAME" >/dev/null 2>&1 || true
docker run -d --name "$TRAEFIK_NAME" --network host \
  -v "$LOG_DIR/traefik.yml:/etc/traefik/traefik.yml:ro" \
  -v "$LOG_DIR/dynamic.yml:/etc/traefik/dynamic.yml:ro" \
  traefik:v3.2 >/dev/null
wait_for "http://127.0.0.1:$EDGE_PORT/v1/health" -H "Host: $HOST_HEADER"
if docker logs "$TRAEFIK_NAME" 2>&1 | grep -q "Error while building configuration"; then
  docker logs "$TRAEFIK_NAME" 2>&1 | grep "Error while building configuration" >&2
  fail "traefik refused deploy/traefik/dynamic.yml"
fi

echo "== 1. an allowed request reaches the application with the decision headers"
status="$(curl -s -o "$LOG_DIR/allowed.json" -w "%{http_code}" \
  -H "Host: $HOST_HEADER" -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:$EDGE_PORT/v1/search?q=traefik")"
[ "$status" = "200" ] || fail "the allowed request answered $status, not 200"
read -r reservation cost identity < <(python3 "$ROOT/scripts/read_decision_headers.py" "$LOG_DIR/allowed.json")
[ -n "$reservation" ] || fail "forwardAuth did not pass X-AWall-Reservation to the application"
[ -n "$identity" ] || fail "forwardAuth did not pass X-AWall-Identity to the application"
echo "   200, identity $identity, cost $cost credits, reservation on the upstream request"

echo "== 2. spending the free quota until the 402 comes through the edge"
status=0
for _ in $(seq 1 400); do
  status="$(curl -s -o "$LOG_DIR/402.json" -D "$LOG_DIR/402.headers" -w "%{http_code}" \
    -H "Host: $HOST_HEADER" -H "Authorization: Bearer $API_KEY" \
    "http://127.0.0.1:$EDGE_PORT/v1/search?q=traefik")"
  if [ "$status" = "402" ]; then break; fi
  if [ "$status" != "200" ]; then fail "the edge answered $status, neither 200 nor 402"; fi
done
[ "$status" = "402" ] || fail "the free quota never ran out"
grep -iq "^payment-required:" "$LOG_DIR/402.headers" \
  || fail "the PAYMENT-REQUIRED header did not survive forwardAuth"
python3 "$ROOT/scripts/check_402_body.py" "$LOG_DIR/402.json"

echo "== 3. a request with PAYMENT-SIGNATURE skips forwardAuth"
# Deliberately not a valid payload. The point is which path answered: the
# gateway's settlement path reports invalid_payload, while forwardAuth would
# have answered the same 402 as above, with an accepts array.
body="$(curl -s -H "Host: $HOST_HEADER" -H "Authorization: Bearer $API_KEY" \
  -H "PAYMENT-SIGNATURE: not-a-real-payload" \
  "http://127.0.0.1:$EDGE_PORT/v1/search?q=traefik")"
case "$body" in
  *invalid_payload*) ;;
  *) fail "the paid request did not reach the gateway's settlement path: $body" ;;
esac
echo "   routed straight to the gateway, which answered from settle"

echo "== 4. a metered route charges what the application reports, once"
# POST /v1/completions is the metered route in awall.yaml, estimated at 50
# credits. The real cost only exists after the response, which in decision mode
# the gateway never sees, so it arrives as a usage report.
status="$(curl -s -o "$LOG_DIR/metered.json" -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -H "Host: $HOST_HEADER" -H "Authorization: Bearer $METERED_KEY" \
  --data '{"prompt":"two words"}' \
  "http://127.0.0.1:$EDGE_PORT/v1/completions")"
[ "$status" = "200" ] || fail "the metered request answered $status, not 200"
read -r metered_reservation metered_cost _ < <(python3 "$ROOT/scripts/read_decision_headers.py" "$LOG_DIR/metered.json")
[ -n "$metered_reservation" ] || fail "the metered request carried no reservation"
echo "   200, estimated at $metered_cost credits before the response"

usage="$(curl -s -X POST -H "Content-Type: application/json" \
  --data "{\"reservationId\":\"$metered_reservation\",\"originStatus\":200,\"outputTokens\":17}" \
  "http://127.0.0.1:$AWALL_PORT/awall/usage")"
charged="$(python3 "$ROOT/scripts/read_charged.py" "$usage")"
[ "$charged" = "17" ] || fail "the report of 17 tokens charged $charged credits: $usage"
again="$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
  --data "{\"reservationId\":\"$metered_reservation\",\"originStatus\":200,\"outputTokens\":17}" \
  "http://127.0.0.1:$AWALL_PORT/awall/usage")"
[ "$again" = "404" ] || fail "the same reservation was accepted twice ($again)"
echo "   17 tokens charged 17 credits against an estimate of $metered_cost; the second report answered 404"

echo "== done"
