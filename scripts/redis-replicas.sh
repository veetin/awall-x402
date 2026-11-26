#!/usr/bin/env bash
# Two gateway replicas behind a load balancer, sharing one Redis bucket.
#
# This is the deployment claim of the shared bucket: with the bucket in Redis,
# two replicas apply one quota, not one each. The script starts Redis and Caddy
# in Docker, two gateways on different ports, drives traffic through the
# balancer and fails when the free quota was granted more than once.
#
# A control phase repeats the run with the in-process bucket, where the quota
# does double, so a passing run cannot pass for the wrong reason.
#
# Needs Docker. Everything it starts is torn down on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The origin URL lives in awall.yaml, so the demo origin keeps its usual port.
ORIGIN_PORT="${ORIGIN_PORT:-8787}"
EDGE_PORT="${EDGE_PORT:-8411}"
PORT_A="${PORT_A:-8412}"
PORT_B="${PORT_B:-8413}"
REDIS_PORT="${REDIS_PORT:-6399}"
API_KEY="${API_KEY:-replica-key}"
PAY_TO="${STELLAR_PAY_TO:-GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO}"
REQUESTS="${REQUESTS:-400}"
REDIS_NAME="awall-replicas-redis"
CADDY_NAME="awall-replicas-edge"
CADDY_CONTROL="awall-replicas-control-edge"
LOG_DIR="$(mktemp -d)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  docker rm -f "$CADDY_NAME" "$CADDY_CONTROL" "$REDIS_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null "$url"; then return 0; fi
    sleep 0.25
  done
  echo "timed out waiting for $url" >&2
  return 1
}

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

echo "== starting redis on :$REDIS_PORT"
docker rm -f "$REDIS_NAME" >/dev/null 2>&1 || true
docker run -d --name "$REDIS_NAME" -p "$REDIS_PORT:6379" redis:7-alpine >/dev/null
for _ in $(seq 1 40); do
  if docker exec "$REDIS_NAME" redis-cli ping >/dev/null 2>&1; then break; fi
  sleep 0.25
done

echo "== starting origin-demo on :$ORIGIN_PORT"
ORIGIN_PORT="$ORIGIN_PORT" pnpm --dir "$ROOT" --filter @awall/origin-demo start \
  >"$LOG_DIR/origin.log" 2>&1 &
PIDS+=("$!")
wait_for "http://127.0.0.1:$ORIGIN_PORT/v1/health"

for port in "$PORT_A" "$PORT_B"; do
  echo "== starting gateway replica on :$port"
  AWALL_PORT="$port" \
  REDIS_URL="redis://127.0.0.1:$REDIS_PORT" \
  STELLAR_PAY_TO="$PAY_TO" \
    pnpm --dir "$ROOT" --filter @awall/gateway start >"$LOG_DIR/gateway-$port.log" 2>&1 &
  PIDS+=("$!")
done
wait_for "http://127.0.0.1:$PORT_A/v1/health"
wait_for "http://127.0.0.1:$PORT_B/v1/health"

cat >"$LOG_DIR/Caddyfile" <<EOF
{
	admin off
}
:$EDGE_PORT {
	reverse_proxy 127.0.0.1:$PORT_A 127.0.0.1:$PORT_B {
		lb_policy round_robin
	}
}
EOF

echo "== starting caddy on :$EDGE_PORT, round robin over both replicas"
docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
docker run -d --name "$CADDY_NAME" --network host \
  -v "$LOG_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null
wait_for "http://127.0.0.1:$EDGE_PORT/v1/health"

echo "== spending the free quota through the balancer ($REQUESTS requests)"
allowed=0
required=0
other=0
for _ in $(seq 1 "$REQUESTS"); do
  code="$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "http://127.0.0.1:$EDGE_PORT/v1/search?q=replica")"
  case "$code" in
    200) allowed=$((allowed + 1)) ;;
    402) required=$((required + 1)) ;;
    *) other=$((other + 1)); echo "   unexpected $code" ;;
  esac
done

echo "   200: $allowed    402: $required    other: $other"

# The shared quota is `free_tier.credits` plus `burst`, read from awall.yaml.
capacity="$(python3 - "$ROOT/awall.yaml" <<'PY'
import sys

credits = burst = 0
inside = False
for line in open(sys.argv[1], encoding="utf-8"):
    stripped = line.strip()
    if stripped.startswith("free_tier:"):
        inside = True
        continue
    if inside:
        if stripped and not line.startswith(" "):
            break
        if stripped.startswith("credits:"):
            credits = int(stripped.split(":")[1])
        if stripped.startswith("burst:"):
            burst = int(stripped.split(":")[1])
print(credits + burst)
PY
)"

echo "== checking the quota was granted once, not twice"
echo "   shared quota from awall.yaml: $capacity credits"
if [ "$other" -ne 0 ]; then
  echo "   FAIL: $other requests answered with neither 200 nor 402" >&2
  exit 1
fi
if [ "$required" -eq 0 ]; then
  echo "   FAIL: no 402, so the quota never ran out" >&2
  exit 1
fi
# One pool refills while the run lasts, so the count lands a little above the
# capacity. Two independent pools would land near twice it.
limit=$((capacity + capacity / 2))
if [ "$allowed" -gt "$limit" ]; then
  echo "   FAIL: $allowed requests passed, more than $limit; the quota doubled" >&2
  exit 1
fi
echo "   OK: $allowed requests passed, at most $limit allowed"

echo "== control: the same two replicas without REDIS_URL"
CTRL_A="${CTRL_A:-8422}"
CTRL_B="${CTRL_B:-8423}"
CTRL_EDGE="${CTRL_EDGE:-8421}"
for port in "$CTRL_A" "$CTRL_B"; do
  AWALL_PORT="$port" STELLAR_PAY_TO="$PAY_TO" \
    pnpm --dir "$ROOT" --filter @awall/gateway start >"$LOG_DIR/control-$port.log" 2>&1 &
  PIDS+=("$!")
done
wait_for "http://127.0.0.1:$CTRL_A/v1/health"
wait_for "http://127.0.0.1:$CTRL_B/v1/health"

cat >"$LOG_DIR/Caddyfile.control" <<EOF
{
	admin off
}
:$CTRL_EDGE {
	reverse_proxy 127.0.0.1:$CTRL_A 127.0.0.1:$CTRL_B {
		lb_policy round_robin
	}
}
EOF
docker rm -f "$CADDY_CONTROL" >/dev/null 2>&1 || true
docker run -d --name "$CADDY_CONTROL" --network host \
  -v "$LOG_DIR/Caddyfile.control:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null
wait_for "http://127.0.0.1:$CTRL_EDGE/v1/health"

control_allowed=0
for _ in $(seq 1 "$REQUESTS"); do
  code="$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer control-$API_KEY" \
    "http://127.0.0.1:$CTRL_EDGE/v1/search?q=control")"
  if [ "$code" = "200" ]; then control_allowed=$((control_allowed + 1)); fi
done
echo "   200 without the shared bucket: $control_allowed"
if [ "$control_allowed" -le "$limit" ]; then
  echo "   FAIL: in-memory buckets passed only $control_allowed, so this run proves nothing" >&2
  exit 1
fi
echo "   OK: $control_allowed against $allowed, so the shared bucket is what held the line"

echo "== running the live Redis test suite"
REDIS_TEST_URL="redis://127.0.0.1:$REDIS_PORT" \
  pnpm --dir "$ROOT" --filter @awall/gateway test -- test/redis-live.test.ts

echo "== done"
