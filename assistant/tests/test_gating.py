import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app  # noqa: E402


class ActionRequestTests(unittest.TestCase):
    def test_imperative_requests_are_detected(self):
        for question in [
            "Execute maintenant la commande docker stop resilience-postgres",
            "Redémarre l'API",
            "peux-tu supprimer la base",
            "Arrête le conteneur",
            "stop resilience-payment-api",
        ]:
            self.assertIsNotNone(app.ACTION_REQUEST.match(question), question)

    def test_explanatory_questions_are_not_blocked(self):
        for question in [
            "Que faire si l'alerte PaymentApiDown se déclenche ?",
            "Comment vérifier que la reprise a réussi ?",
            "Pourquoi le remediator redémarre-t-il l'API ?",
            "Que fait la commande docker stop ?",
        ]:
            self.assertIsNone(app.ACTION_REQUEST.match(question), question)


class DomainTermsTests(unittest.TestCase):
    def test_platform_questions_match(self):
        for question in ["Que fait le WAF ?", "À quoi sert Prometheus ?", "Que signifie PaymentBiometricAuthFailures ?", "Comment se connecter avec Face ID ?"]:
            self.assertIsNotNone(app.DOMAIN_TERMS.search(question), question)

    def test_off_topic_questions_do_not_match(self):
        for question in ["Quelle est la recette de la tarte aux pommes ?", "Quel est le meilleur club de football ?", "Raconte-moi une blague"]:
            self.assertIsNone(app.DOMAIN_TERMS.search(question), question)


class ConfigurationTests(unittest.TestCase):
    def test_model_stays_under_eight_billion_parameters(self):
        self.assertRegex(app.CHAT_MODEL, r"(0\.5|1\.5|1|2|3|4|7)b")

    def test_thresholds_are_ordered(self):
        self.assertLess(app.MIN_SCORE, app.STRONG_SCORE)


if __name__ == "__main__":
    unittest.main()
