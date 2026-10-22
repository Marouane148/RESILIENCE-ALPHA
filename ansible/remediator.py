#!/usr/bin/env python3
import hmac
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PLAYBOOK = "/workspace/ansible/remediate_payment.yml"
PORT = int(os.environ.get("PORT", "8081"))
AUTH_TOKEN = os.environ.get("REMEDIATOR_TOKEN", "")
MAX_BODY_BYTES = 1_000_000
MAX_CONSECUTIVE_FAILURES = 5

state_lock = threading.Lock()
state = {"running": False, "rerun": False}


def log(**fields):
    print(json.dumps(fields), flush=True)


def execute_playbook() -> int:
    result = subprocess.run(
        ["ansible-playbook", "-i", "localhost,", PLAYBOOK],
        capture_output=True,
        text=True,
        check=False,
    )
    log(event="remediation", returncode=result.returncode)
    # La sortie Ansible est toujours journalisée (Loki) : elle sert à l'investigation et à la démonstration.
    print(result.stdout + result.stderr, flush=True)
    return result.returncode


def worker() -> None:
    # Un seul playbook à la fois. Une alerte qui arrive pendant l'exécution est mise en file : le playbook est relancé
    # dès que le précédent se termine, car l'état de la plateforme a pu changer entre-temps (ex. panne de la base).
    failures = 0
    while True:
        returncode = execute_playbook()
        failures = failures + 1 if returncode != 0 else 0
        if returncode != 0 and failures < MAX_CONSECUTIVE_FAILURES:
            # Échec (service pas encore revenu, nouvelle panne pendant la reprise) : on ré-évalue l'état sans attendre l'alerte suivante.
            time.sleep(2)
            continue
        with state_lock:
            if state["rerun"]:
                state["rerun"] = False
                continue
            state["running"] = False
            return


def request_remediation() -> str:
    with state_lock:
        if state["running"]:
            state["rerun"] = True
            log(event="remediation_queued", reason="playbook_running")
            return "queued"
        state["running"] = True
    threading.Thread(target=worker, daemon=True).start()
    return "started"


def is_authorized(header_value: str) -> bool:
    # Le remediator dispose de droits élevés sur Docker : seul Alertmanager, porteur du secret, peut le déclencher.
    if not AUTH_TOKEN:
        return False
    expected = f"Bearer {AUTH_TOKEN}"
    return hmac.compare_digest(header_value.encode(), expected.encode())


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: bytes = b""):
        try:
            self.send_response(status)
            self.end_headers()
            if body:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if not is_authorized(self.headers.get("Authorization", "")):
            log(event="remediation_refused", reason="unauthorized", client=self.client_address[0])
            return self.reply(401, b"unauthorized")

        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY_BYTES:
            return self.reply(413)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self.reply(400)

        if any(alert.get("status") == "firing" for alert in payload.get("alerts", [])):
            # Réponse immédiate : Alertmanager n'attend pas la fin du playbook.
            request_remediation()
        return self.reply(202, b"accepted")

    def log_message(self, format_string, *args):
        print(format_string % args, flush=True)


if __name__ == "__main__":
    if not AUTH_TOKEN:
        log(event="remediator_warning", reason="REMEDIATOR_TOKEN is empty: every request will be refused")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
