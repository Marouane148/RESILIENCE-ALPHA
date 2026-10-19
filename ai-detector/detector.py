import re
import time

import requests
from prometheus_client import Gauge, start_http_server
from sklearn.ensemble import IsolationForest

API_METRICS_URL = "http://payment-api:3000/metrics"
POLL_SECONDS = 5

anomaly_score = Gauge(
    "resilience_anomaly_score",
    "Isolation Forest anomaly score for payment API traffic.",
)
anomaly_detected = Gauge(
    "resilience_anomaly_detected",
    "1 when the ML detector identifies anomalous payment traffic.",
)
observed_rejections = Gauge(
    "resilience_observed_rejections_per_second",
    "Observed rejected payment requests per second.",
)

# Nominal lab profile: low rejection rate and moderate request rate.
model = IsolationForest(contamination=0.05, random_state=42)
model.fit([[0.0, 0.5], [0.0, 1.0], [0.1, 1.5], [0.0, 2.0], [0.2, 2.5], [0.1, 3.0]])


def read_counter(payload: str, metric_name: str) -> float:
    match = re.search(rf"^{metric_name}\s+([0-9.]+)$", payload, re.MULTILINE)
    return float(match.group(1)) if match else 0.0


def main() -> None:
    start_http_server(8000)
    previous_requests = 0.0
    previous_rejections = 0.0
    previous_time = time.monotonic()

    while True:
        try:
            payload = requests.get(API_METRICS_URL, timeout=2).text
            current_requests = read_counter(payload, "payment_api_requests_total")
            current_rejections = read_counter(payload, "payment_api_rejected_requests_total")
            current_time = time.monotonic()
            elapsed = max(current_time - previous_time, 1.0)
            request_rate = max(current_requests - previous_requests, 0.0) / elapsed
            rejection_rate = max(current_rejections - previous_rejections, 0.0) / elapsed
            vector = [[rejection_rate, request_rate]]
            score = float(model.decision_function(vector)[0])
            detected = int(model.predict(vector)[0] == -1)
            anomaly_score.set(score)
            anomaly_detected.set(detected)
            observed_rejections.set(rejection_rate)
            previous_requests = current_requests
            previous_rejections = current_rejections
            previous_time = current_time
        except requests.RequestException:
            anomaly_detected.set(1)
            anomaly_score.set(-1.0)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
