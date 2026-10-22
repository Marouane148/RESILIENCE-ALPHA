# Analyse de risques EBIOS Risk Manager - Resilience-Alpha

Périmètre : plateforme de paiement fictive du démonstrateur (frontend, WAF, API, PostgreSQL, Vault, remédiation, supervision, assistant opérateur). Les niveaux de gravité (G) et de vraisemblance (V) vont de 1 (faible) à 4 (critique). Chaque scénario opérationnel renvoie à un essai documenté dans [TESTS.md](TESTS.md).

## Atelier 1 - Cadrage et socle de sécurité

### Valeurs métier

| Id | Valeur métier | Pourquoi elle est critique |
|---|---|---|
| VM1 | Exécution des paiements | Chaque minute d'arrêt retarde les partenaires et fait perdre la confiance des utilisateurs |
| VM2 | Intégrité et traçabilité des transactions | Une transaction perdue ou altérée est un incident financier |
| VM3 | Contrôle d'accès à l'interface de paiement | Un accès frauduleux permet d'émettre des paiements |

### Biens supports

API Node.js, PostgreSQL (volume `postgres-data`), WAF ModSecurity, Vault, remediator et proxy Docker, Prometheus/Alertmanager/Loki/Grafana, détecteur ML, assistant Ollama/RAG, poste hôte Docker Desktop.

### Événements redoutés

| Id | Événement redouté | Valeur | G |
|---|---|---|---|
| ER1 | Service de paiement indisponible | VM1 | 4 |
| ER2 | Transactions perdues ou altérées | VM2 | 4 |
| ER3 | Accès non autorisé à l'interface de paiement | VM3 | 3 |
| ER4 | Prise de contrôle du moteur de remédiation (droits sur Docker) | VM1, VM2 | 4 |
| ER5 | Fuite des secrets applicatifs | VM2, VM3 | 3 |

### Socle de sécurité

Conteneurs sans privilèges Linux, système de fichiers en lecture seule, réseau interne isolé, healthchecks, secrets dans Vault, journaux centralisés, sauvegarde implicite des transactions par le volume PostgreSQL.

## Atelier 2 - Sources de risque et objectifs visés

| Id | Source de risque | Objectif visé | Pertinence |
|---|---|---|---|
| SR1 | Attaquant externe opportuniste | Saturer ou perturber le service | Forte |
| SR2 | Attaquant ciblé | Usurper un opérateur, détourner la remédiation | Moyenne |
| SR3 | Erreur d'exploitation interne | Mauvaise manipulation, secret exposé | Moyenne |
| SR4 | Défaillance technique | Panne d'un conteneur ou de la base | Forte |

## Atelier 3 - Scénarios stratégiques

| Id | Chemin d'attaque | Événement | G | V |
|---|---|---|---|---|
| SS1 | SR1 sature l'API avec des requêtes invalides | ER1 | 3 | 4 |
| SS2 | SR1 tente une injection (SQL, script) via l'API | ER2, ER5 | 4 | 3 |
| SS3 | SR2 usurpe l'identité d'un opérateur (rejeu, clé volée) | ER3 | 3 | 2 |
| SS4 | SR2 appelle directement le remediator pour agir sur Docker | ER4 | 4 | 2 |
| SS5 | SR4 : arrêt du conteneur API ou de PostgreSQL | ER1 | 4 | 3 |
| SS6 | SR3 : secret commité ou lisible dans l'environnement | ER5 | 3 | 3 |

## Atelier 4 - Scénarios opérationnels et essais

| Id | Scénario | Reproduction | Détection | Réponse |
|---|---|---|---|---|
| SO1 | Rafale de `POST /payments` invalides depuis le PC Attaquant | Script PowerShell ou `controlled_payment_burst.sh` | `PaymentInvalidRequestBurst`, `PaymentMlAnomalyDetected` | Alertes SOC, pas de redémarrage ; analyse opérateur |
| SO2 | Injection SQL et script dans une requête | `curl` avec motif d'injection | Journal WAF `Access denied` | Blocage 403 avant l'API |
| SO3 | Arrêt du conteneur API | `docker stop resilience-payment-api` | `PaymentApiDown` | Reprise automatique en environ 30 s |
| SO4 | Arrêt de PostgreSQL | `docker stop resilience-postgres` | `PaymentDatabaseDown` | Reprise automatique, transactions conservées |
| SO5 | Rejeu d'une assertion, compteur non croissant, absence de vérification utilisateur | Tests automatisés `backend/test` | `PaymentBiometricAuthFailures` | Connexion refusée |
| SO6 | Appel du remediator sans jeton | `curl -X POST` depuis le réseau interne | Journal `remediation_refused` | Refus 401, aucune action |
| SO7 | Lecture des secrets dans l'environnement du conteneur API | `docker inspect` | Néant | Aucun secret applicatif dans l'environnement |

## Atelier 5 - Traitement du risque

| Scénario | Risque initial (G×V) | Mesures | Risque résiduel | Décision |
|---|---|---|---|---|
| SS1 | 12 | Détection ML + alerte de rafale, WAF, limitation du corps de requête, supervision SOC | 6 | Accepter ; ajouter une limitation de débit par source en production |
| SS2 | 12 | WAF OWASP CRS, requêtes SQL paramétrées, validation stricte des entrées | 4 | Accepter |
| SS3 | 6 | Passkey avec vérification utilisateur obligatoire, challenge à usage unique, compteur de signature, sessions de 15 minutes | 3 | Accepter |
| SS4 | 8 | Jeton obligatoire, réseau interne, proxy Docker restreint aux conteneurs, deux conteneurs ciblés | 4 | Accepter ; durcir par un proxy filtrant le contenu des requêtes |
| SS5 | 12 | Healthchecks, Prometheus 5 s, remédiation Ansible ordonnée, vérification métier, volume persistant | 4 | Accepter ; ajouter la réplication en production |
| SS6 | 9 | Vault, token applicatif en lecture seule, `.env` ignoré par Git | 6 | Réduire : Vault persistant avec rotation en production |

## Risques résiduels majeurs

Perte du PC Hôte (point de défaillance unique), faux positifs ou faux négatifs du modèle ML, Vault en mode développement, requêtes de création de conteneur non filtrées par le proxy Docker, absence de journalisation immuable.
