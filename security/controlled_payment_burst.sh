#!/usr/bin/env bash
# Burst applicatif contrôlé : requêtes de paiement invalides contre l'API fictive du laboratoire.
# Cibles autorisées : localhost, 127.0.0.1 ou une adresse privée fournie par LAB_HOST_IP (PC Hôte du groupe).
set -euo pipefail

LAB_HOST_IP="${LAB_HOST_IP:-}"
API_PORT="${API_PORT:-3000}"
DURATION_SECONDS="${DURATION_SECONDS:-10}"
CONCURRENCY="${CONCURRENCY:-4}"

private_ip='^(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})$'

if [[ -z "$LAB_HOST_IP" ]]; then
  host="localhost"
elif [[ "$LAB_HOST_IP" =~ $private_ip ]]; then
  host="$LAB_HOST_IP"
else
  echo "Refus: LAB_HOST_IP doit etre une adresse privee du reseau du groupe (10.x, 172.16-31.x, 192.168.x)." >&2
  exit 2
fi

if [[ -n "${TARGET_URL:-}" ]]; then
  echo "Refus: TARGET_URL n'est plus accepte, utilisez LAB_HOST_IP pour designer le PC Hote du laboratoire." >&2
  exit 2
fi

if ! [[ "$API_PORT" =~ ^[0-9]{2,5}$ ]] || ! [[ "$DURATION_SECONDS" =~ ^[1-9][0-9]*$ ]] || ! [[ "$CONCURRENCY" =~ ^[1-9][0-9]*$ ]]; then
  echo "API_PORT, DURATION_SECONDS et CONCURRENCY doivent etre des entiers positifs." >&2
  exit 2
fi

TARGET_URL="http://${host}:${API_PORT}/payments"
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
