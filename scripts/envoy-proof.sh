#!/usr/bin/env bash
# Mode B against a real Envoy, with the ext_authz filter this repository ships.
#
# Same four claims as scripts/traefik-proof.sh, through a different edge:
#
#   1. an allowed request reaches the application with the decision headers;
#   2. the 402 reaches the client whole, header and body;
#   3. a request with PAYMENT-SIGNATURE skips ext_authz and is answered from
#      the gateway's settlement path;
#   4. the reservation the application received buys one usage report.
#
# Envoy differs from Traefik here: it sends no X-Forwarded-Uri and instead
# appends the original path to the filter's `path_prefix`, so this also proves
# the gateway reads the request under decision off its own path.
#
# Needs Docker. Everything it starts is torn down on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-8798}"
AWALL_PORT="${AWALL_PORT:-8452}"
EDGE_PORT="${EDGE_PORT:-8451}"
API_KEY="${API_KEY:-envoy-key}"
METERED_KEY="${METERED_KEY:-envoy-metered-key}"
PAY_TO="${STELLAR_PAY_TO:-GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO}"
ENVOY_NAME="awall-envoy-proof"
LOG_DIR="$(mktemp -d)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  docker rm -f "$ENVOY_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for() {
  local url="$1"
  shift
  for _ in $(seq 1 80); do
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

# The shipped envoy.yaml with the listener port and the two cluster addresses
# pointed at the processes above. Everything else is the file as it ships.
sed \
  -e "s|address: 0.0.0.0, port_value: 8080|address: 0.0.0.0, port_value: $EDGE_PORT|" \
  -e "s|address: awall, port_value: 8402|address: 127.0.0.1, port_value: $AWALL_PORT|" \
  -e "s|address: app, port_value: 8080|address: 127.0.0.1, port_value: $APP_PORT|" \
  -e "s|uri: http://awall:8402|uri: http://127.0.0.1:$AWALL_PORT|" \
  "$ROOT/deploy/envoy/envoy.yaml" >"$LOG_DIR/envoy.yaml"

echo "== starting envoy on :$EDGE_PORT with the shipped ext_authz filter"
docker rm -f "$ENVOY_NAME" >/dev/null 2>&1 || true
docker run -d --name "$ENVOY_NAME" --network host \
  -v "$LOG_DIR/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
  envoyproxy/envoy:v1.32-latest \
  -c /etc/envoy/envoy.yaml --log-level warn >/dev/null
wait_for "http://127.0.0.1:$EDGE_PORT/v1/health"

echo "== 1. an allowed request reaches the application with the decision headers"
status="$(curl -s -o "$LOG_DIR/allowed.json" -w "%{http_code}" \
  -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:$EDGE_PORT/v1/search?q=envoy")"
[ "$status" = "200" ] || fail "the allowed request answered $status, not 200"
read -r reservation cost identity < <(python3 "$ROOT/scripts/read_decision_headers.py" "$LOG_DIR/allowed.json")
[ -n "$identity" ] || fail "ext_authz did not pass X-AWall-Identity to the application"
[ -n "$reservation" ] || fail "ext_authz did not pass X-AWall-Reservation to the application"
echo "   200, identity $identity, cost $cost credits, reservation on the upstream request"

echo "== 2. spending the free quota until the 402 comes through the edge"
status=0
for _ in $(seq 1 400); do
  status="$(curl -s -o "$LOG_DIR/402.json" -D "$LOG_DIR/402.headers" -w "%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "http://127.0.0.1:$EDGE_PORT/v1/search?q=envoy")"
  if [ "$status" = "402" ]; then break; fi
  if [ "$status" != "200" ]; then fail "the edge answered $status, neither 200 nor 402"; fi
done
[ "$status" = "402" ] || fail "the free quota never ran out"
grep -iq "^payment-required:" "$LOG_DIR/402.headers" \
  || fail "the PAYMENT-REQUIRED header did not survive ext_authz"
python3 "$ROOT/scripts/check_402_body.py" "$LOG_DIR/402.json"

echo "== 3. a request with PAYMENT-SIGNATURE skips ext_authz"
body="$(curl -s -H "Authorization: Bearer $API_KEY" \
  -H "PAYMENT-SIGNATURE: not-a-real-payload" \
  "http://127.0.0.1:$EDGE_PORT/v1/search?q=envoy")"
case "$body" in
  *invalid_payload*) ;;
  *) fail "the paid request did not reach the gateway's settlement path: $body" ;;
esac
echo "   routed straight to the gateway, which answered from settle"

echo "== 4. a metered route charges what the application reports, once"
status="$(curl -s -o "$LOG_DIR/metered.json" -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $METERED_KEY" \
  --data '{"prompt":"two words"}' \
  "http://127.0.0.1:$EDGE_PORT/v1/completions")"
[ "$status" = "200" ] || fail "the metered request answered $status, not 200"
read -r metered_reservation metered_cost _ < <(python3 "$ROOT/scripts/read_decision_headers.py" "$LOG_DIR/metered.json")
[ -n "$metered_reservation" ] || fail "the metered request carried no reservation"
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
