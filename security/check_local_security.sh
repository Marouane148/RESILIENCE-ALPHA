#!/usr/bin/env bash
set -euo pipefail

base_url="${API_URL:-http://localhost:3000}"

status=$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/payments")
if [[ "$status" != "401" ]]; then
  echo "FAIL: /payments devrait exiger une authentification (HTTP 401 attendu, obtenu $status)." >&2
  exit 1
fi

health=$(curl -fsS "$base_url/health")
grep -q '"status":"ok"' <<< "$health"
echo "OK: endpoint métier protégé et healthcheck opérationnel."
