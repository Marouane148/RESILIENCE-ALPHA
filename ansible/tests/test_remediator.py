import importlib.util
import os
import threading
import time
import unittest
from unittest import mock

os.environ["REMEDIATOR_TOKEN"] = "secret-token"
spec = importlib.util.spec_from_file_location("remediator", os.path.join(os.path.dirname(__file__), "..", "remediator.py"))
remediator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remediator)


class AuthorizationTests(unittest.TestCase):
    def test_accepts_the_bearer_token(self):
        self.assertTrue(remediator.is_authorized("Bearer secret-token"))

    def test_refuses_missing_or_wrong_token(self):
        self.assertFalse(remediator.is_authorized(""))
        self.assertFalse(remediator.is_authorized("Bearer wrong"))
        self.assertFalse(remediator.is_authorized("secret-token"))

    def test_refuses_everything_when_no_token_is_configured(self):
        with mock.patch.object(remediator, "AUTH_TOKEN", ""):
            self.assertFalse(remediator.is_authorized("Bearer "))


class CoalescingTests(unittest.TestCase):
    def setUp(self):
        remediator.state.update(running=False, rerun=False)

    def test_alert_during_a_run_triggers_one_rerun_instead_of_being_dropped(self):
        started, release = threading.Event(), threading.Event()
        runs = []

        def fake_playbook():
            runs.append(time.monotonic())
            started.set()
            if len(runs) == 1:
                release.wait(2)
            return 0

        with mock.patch.object(remediator, "execute_playbook", fake_playbook):
            self.assertEqual(remediator.request_remediation(), "started")
            self.assertTrue(started.wait(2))
            self.assertEqual(remediator.request_remediation(), "queued")
            self.assertEqual(remediator.request_remediation(), "queued")
            release.set()
            deadline = time.monotonic() + 2
            while remediator.state["running"] and time.monotonic() < deadline:
                time.sleep(0.01)

        self.assertEqual(len(runs), 2)
        self.assertFalse(remediator.state["running"])


class RetryTests(unittest.TestCase):
    def setUp(self):
        remediator.state.update(running=False, rerun=False)

    def test_failed_run_is_retried_without_waiting_for_the_next_alert(self):
        codes = iter([2, 2, 0])
        calls = []

        def fake_playbook():
            calls.append(1)
            return next(codes)

        with mock.patch.object(remediator, "execute_playbook", fake_playbook), mock.patch.object(remediator.time, "sleep"):
            remediator.state["running"] = True
            remediator.worker()

        self.assertEqual(len(calls), 3)
        self.assertFalse(remediator.state["running"])

    def test_gives_up_after_the_maximum_number_of_consecutive_failures(self):
        calls = []

        def always_failing():
            calls.append(1)
            return 2

        with mock.patch.object(remediator, "execute_playbook", always_failing), mock.patch.object(remediator.time, "sleep"):
            remediator.state["running"] = True
            remediator.worker()

        self.assertEqual(len(calls), remediator.MAX_CONSECUTIVE_FAILURES)
        self.assertFalse(remediator.state["running"])


if __name__ == "__main__":
    unittest.main()
