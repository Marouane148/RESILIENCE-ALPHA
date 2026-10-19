#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${TARGET_URL:-http://localhost:3000/payments}"
DURATION_SECONDS="${DURATION_SECONDS:-10}"
CONCURRENCY="${CONCURRENCY:-4}"

case "$TARGET_URL" in
  http://localhost:3000/payments|http://127.0.0.1:3000/payments)
    ;;
  *)
    echo "Refus: TARGET_URL doit rester limite a l'API locale du laboratoire." >&2
    exit 2
    ;;
esac

if ! [[ "$DURATION_SECONDS" =~ ^[1-9][0-9]*$ ]] || ! [[ "$CONCURRENCY" =~ ^[1-9][0-9]*$ ]]; then
  echo "DURATION_SECONDS et CONCURRENCY doivent etre des entiers positifs." >&2
  exit 2
fi

end_time=$((SECONDS + DURATION_SECONDS))
request_body='{"recipient":"lab-attack","amount":0}'

send_requests() {
  while (( SECONDS < end_time )); do
    curl --silent --output /dev/null --write-out '%{http_code}\n' \
      --connect-timeout 1 --max-time 2 \
      -H 'Content-Type: application/json' \
      -d "$request_body" "$TARGET_URL" || true
  done
}

pids=()
for ((worker = 1; worker <= CONCURRENCY; worker += 1)); do
  send_requests &
  pids+=("$!")
done

trap 'kill "${pids[@]}" 2>/dev/null || true' INT TERM
wait "${pids[@]}"

echo "Burst controle termine: cible=$TARGET_URL duree=${DURATION_SECONDS}s concurrence=$CONCURRENCY"
