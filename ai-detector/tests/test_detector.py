import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from detector import BASELINE_SIZE, REFIT_EVERY, TrafficDetector, counter_delta, read_counter  # noqa: E402


class CounterTests(unittest.TestCase):
    def test_reads_prometheus_counter(self):
        payload = "# HELP x\nx_total 12\npayment_api_requests_total 340\n"
        self.assertEqual(read_counter(payload, "payment_api_requests_total"), 340.0)
        self.assertEqual(read_counter(payload, "missing_metric"), 0.0)

    def test_delta_handles_counter_reset_after_restart(self):
        self.assertEqual(counter_delta(50.0, 20.0), 30.0)
        self.assertEqual(counter_delta(4.0, 900.0), 4.0)


class DetectionTests(unittest.TestCase):
    def test_nominal_traffic_is_not_anomalous(self):
        detector = TrafficDetector()
        _, detected = detector.evaluate(0.0, 1.5)
        self.assertFalse(detected)

    def test_rejection_burst_is_anomalous(self):
        detector = TrafficDetector()
        score, detected = detector.evaluate(12.9, 14.0)
        self.assertTrue(detected)
        self.assertLess(score, 0)

    def test_attack_does_not_contaminate_baseline(self):
        detector = TrafficDetector()
        before = len(detector.baseline)
        for _ in range(30):
            detector.evaluate(15.0, 16.0)
        self.assertEqual(len(detector.baseline), before)

    def test_nominal_traffic_refits_model_within_bounds(self):
        detector = TrafficDetector()
        for _ in range(REFIT_EVERY * 2):
            detector.evaluate(0.0, 1.0)
        self.assertLessEqual(len(detector.baseline), BASELINE_SIZE)
        self.assertGreater(len(detector.baseline), 6)
        _, detected = detector.evaluate(14.0, 15.0)
        self.assertTrue(detected)


class NoiseGuardTests(unittest.TestCase):
    def test_regular_low_traffic_noise_is_never_an_anomaly(self):
        detector = TrafficDetector()
        for _ in range(60):
            detector.evaluate(0.0, 0.6)
        for rate in (0.2, 0.4, 0.8, 1.0, 0.0):
            _, detected = detector.evaluate(0.0, rate)
            self.assertFalse(detected, rate)

    def test_small_rejection_blips_below_the_floor_are_ignored(self):
        detector = TrafficDetector()
        _, detected = detector.evaluate(0.3, 0.6)
        self.assertFalse(detected)

    def test_a_real_burst_still_exceeds_the_nominal_profile_and_is_detected(self):
        detector = TrafficDetector()
        for _ in range(60):
            detector.evaluate(0.0, 0.6)
        _, detected = detector.evaluate(13.0, 14.0)
        self.assertTrue(detected)


if __name__ == "__main__":
    unittest.main()
