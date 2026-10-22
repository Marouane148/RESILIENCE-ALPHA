# Détection ML d'anomalies

Le service `anomaly-detector` utilise `IsolationForest` (scikit-learn) sur deux signaux issus de l'API de paiement, lus sur `/metrics` toutes les 5 secondes :

- le **taux de requêtes HTTP** (variation de `payment_api_requests_total`) ;
- le **taux de requêtes rejetées** (variation de `payment_api_rejected_requests_total`).

## Données et préparation

- **Amorçage** : un profil nominal fictif de six observations (faible taux de rejets, trafic modéré) permet de démarrer le modèle.
- **Données réelles** : chaque observation jugée normale est ajoutée à une base glissante (240 observations au maximum). Toutes les 24 observations nominales (environ 2 minutes), le modèle est **ré-entraîné** sur cette base, donc il s'adapte au trafic réel du laboratoire.
- **Protection contre la contamination** : une observation jugée anormale n'est jamais ajoutée à la base : une attaque ne devient pas le « nouveau normal ».
- **Garde de magnitude** : le verdict du modèle n'est retenu que si l'observation dépasse nettement le profil nominal vers le haut (plus de 0,5 rejet par seconde au-dessus du nominal, ou un taux de requêtes supérieur à deux fois le maximum nominal). Sans elle, un trafic très régulier faisait basculer le verdict sur de simples fluctuations (une dizaine de faux positifs en 10 minutes à 0 rejet par seconde) ; avec elle : 0 faux positif sur 24 échantillons en 2 minutes de calme, et une rafale à 25 rejets par seconde reste détectée en moins de 4 secondes.
- Une remise à zéro des compteurs (redémarrage de l'API) est gérée : le delta est recalculé à partir de zéro.

## Modèle retenu

`IsolationForest(contamination=0.05, random_state=42)`. Choix : non supervisé (aucune donnée d'attaque étiquetée n'existe), léger, interprétable par un score. Un point est anormal quand il est facile à isoler du trafic nominal, ce qui est le cas d'une rafale de rejets.

## Métriques exposées (port 8000)

| Métrique | Signification |
|---|---|
| `resilience_anomaly_score` | Score de décision (négatif = anormal) |
| `resilience_anomaly_detected` | `1` si le profil est jugé anormal |
| `resilience_observed_rejections_per_second` | Signal explicatif |
| `resilience_detector_target_up` | `0` quand l'API est injoignable : aucun verdict n'est émis |
| `resilience_detector_baseline_samples` | Taille de la base nominale |

Prometheus déclenche `PaymentMlAnomalyDetected` quand le verdict reste à 1 au moins dix secondes. Cette alerte est de catégorie **sécurité** : elle alimente le dashboard SOC et n'entraîne aucun redémarrage. Une panne de disponibilité n'est volontairement pas qualifiée d'anomalie de trafic ; elle relève de `PaymentApiDown`.

## Résultats observés

Sur le laboratoire : un burst de 40 s avec 8 workers fait passer le taux de rejets à environ 12,9 par seconde et le verdict à `1` en moins de 10 secondes ; le trafic nominal (supervision, paiements isolés) reste à `0`.

## Tests

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Les tests (9) couvrent la lecture des compteurs, la remise à zéro après redémarrage, la détection d'une rafale, l'absence de contamination par une attaque, le ré-entraînement borné et la garde de magnitude (bruit régulier jamais classé en anomalie).

## Limites

- Deux signaux seulement : une attaque lente et discrète (faible débit) n'est pas détectée.
- Profil nominal d'amorçage synthétique ; la qualité dépend du trafic réellement observé avant l'attaque.
- Le seuil de contamination est fixé à 5 % ; des faux positifs sont possibles lors d'un pic légitime.
- Pas de versionnage des modèles ni de mesure systématique des faux positifs : à prévoir en production, avec séparation des décisions de disponibilité et de sécurité.
