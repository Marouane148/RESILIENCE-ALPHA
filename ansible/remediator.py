#!/usr/bin/env python3
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

PLAYBOOK = "/workspace/ansible/remediate_payment.yml"
PORT = int(os.environ.get("PORT", "8081"))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        alerts = payload.get("alerts", [])
        active_alerts = [alert for alert in alerts if alert.get("status") == "firing"]

        if active_alerts:
            result = subprocess.run(
                ["ansible-playbook", "-i", "localhost,", PLAYBOOK],
                capture_output=True,
                text=True,
                check=False,
            )
            print(json.dumps({"event": "remediation", "returncode": result.returncode}), flush=True)
            if result.returncode != 0:
                print(result.stdout + result.stderr, flush=True)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b"remediation failed")
                return

        self.send_response(202)
        self.end_headers()
        self.wfile.write(b"accepted")

    def log_message(self, format_string, *args):
        print(format_string % args, flush=True)


HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
