# Détection ML d'anomalies

Le service `anomaly-detector` utilise `IsolationForest` de scikit-learn sur deux signaux issus de l'API paiement :

- le taux de requêtes HTTP observé ;
- le taux de requêtes de paiement rejetées.

Le modèle est entraîné au démarrage sur un profil nominal fictif et local au laboratoire. Il expose :

- `resilience_anomaly_score` : score produit par Isolation Forest ;
- `resilience_anomaly_detected` : `1` lorsqu'un profil est considéré comme anormal ;
- `resilience_observed_rejections_per_second` : signal explicatif.

Prometheus scrape le port `8000` du détecteur et déclenche `PaymentMlAnomalyDetected` lorsque le signal ML reste anormal au moins dix secondes. Cette alerte suit ensuite la même chaîne Alertmanager -> remediator -> Ansible.

## Limites

Le modèle est volontairement minimal pour un démonstrateur de quatre jours : le jeu d'entraînement est synthétique, le seuil dépend du profil nominal et aucune donnée financière réelle n'est utilisée. En production, il faudrait versionner les données, réentraîner le modèle, mesurer les faux positifs et séparer les décisions de disponibilité des décisions de sécurité.
