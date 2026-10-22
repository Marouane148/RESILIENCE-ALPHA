import re
import time
from collections import deque

import requests
from prometheus_client import Gauge, start_http_server
from sklearn.ensemble import IsolationForest

API_METRICS_URL = "http://payment-api:3000/metrics"
POLL_SECONDS = 5
REFIT_EVERY = 24  # observations nominales avant ré-entraînement (environ 2 minutes)
BASELINE_SIZE = 240
# Garde de magnitude : un verdict du modèle n'est retenu que si l'observation dépasse nettement le profil nominal vers le HAUT.
# Sans elle, un trafic très régulier produit des faux positifs sur de simples fluctuations (taux de rejets à 0).
MIN_REJECTION_RATE = 0.5      # rejets par seconde
REQUEST_RATE_FACTOR = 2.0     # multiple du taux de requêtes nominal maximal observé
REQUEST_RATE_FLOOR = 2.0      # requêtes par seconde

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
target_up = Gauge(
    "resilience_detector_target_up",
    "1 when the detector can read the payment API metrics, 0 during an outage (no verdict is issued).",
)
baseline_samples = Gauge(
    "resilience_detector_baseline_samples",
    "Number of observations in the nominal baseline used to fit the model.",
)

# Profil nominal de départ (laboratoire). Il est complété par le trafic réel jugé normal.
SEED_PROFILE = [[0.0, 0.5], [0.0, 1.0], [0.1, 1.5], [0.0, 2.0], [0.2, 2.5], [0.1, 3.0]]


def read_counter(payload: str, metric_name: str) -> float:
    match = re.search(rf"^{metric_name}\s+([0-9.]+)$", payload, re.MULTILINE)
    return float(match.group(1)) if match else 0.0


def counter_delta(current: float, previous: float) -> float:
    """Variation d'un compteur ; après un redémarrage de l'API le compteur repart de zéro."""
    return current if current < previous else current - previous


class TrafficDetector:
    def __init__(self) -> None:
        self.baseline = deque(SEED_PROFILE, maxlen=BASELINE_SIZE)
        self.model = IsolationForest(contamination=0.05, random_state=42)
        self.model.fit(list(self.baseline))
        self.nominal_since_fit = 0

    def exceeds_nominal(self, rejection_rate: float, request_rate: float) -> bool:
        nominal_rejections = max(point[0] for point in self.baseline)
        nominal_requests = max(point[1] for point in self.baseline)
        return (
            rejection_rate > nominal_rejections + MIN_REJECTION_RATE
            or request_rate > max(nominal_requests * REQUEST_RATE_FACTOR, nominal_requests + REQUEST_RATE_FLOOR)
        )

    def evaluate(self, rejection_rate: float, request_rate: float) -> tuple[float, bool]:
        vector = [[rejection_rate, request_rate]]
        score = float(self.model.decision_function(vector)[0])
        # Verdict final : le modèle isole l'observation ET elle dépasse le profil nominal (bruit exclu).
        detected = bool(self.model.predict(vector)[0] == -1) and self.exceeds_nominal(rejection_rate, request_rate)
        if not detected:
            # Seul le trafic jugé normal alimente la base : une attaque ne contamine pas le modèle.
            self.baseline.append(vector[0])
            self.nominal_since_fit += 1
            if self.nominal_since_fit >= REFIT_EVERY:
                self.model.fit(list(self.baseline))
                self.nominal_since_fit = 0
        return score, detected


def main() -> None:
    start_http_server(8000)
    detector = TrafficDetector()
    previous = None

    while True:
        try:
            payload = requests.get(API_METRICS_URL, timeout=2).text
            now = time.monotonic()
            requests_total = read_counter(payload, "payment_api_requests_total")
            rejections_total = read_counter(payload, "payment_api_rejected_requests_total")
            target_up.set(1)

            if previous is not None:
                elapsed = max(now - previous["time"], 1.0)
                request_rate = counter_delta(requests_total, previous["requests"]) / elapsed
                rejection_rate = counter_delta(rejections_total, previous["rejections"]) / elapsed
                score, detected = detector.evaluate(rejection_rate, request_rate)
                anomaly_score.set(score)
                anomaly_detected.set(int(detected))
                observed_rejections.set(rejection_rate)
                baseline_samples.set(len(detector.baseline))
            previous = {"time": now, "requests": requests_total, "rejections": rejections_total}
        except requests.RequestException:
            # Une panne de disponibilité n'est pas une anomalie de trafic : la remédiation relève de PaymentApiDown.
            target_up.set(0)
            anomaly_detected.set(0)
            anomaly_score.set(0.0)
            observed_rejections.set(0.0)
            previous = None
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
