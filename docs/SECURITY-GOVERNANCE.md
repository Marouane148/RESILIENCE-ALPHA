# Sécurité et gouvernance - Resilience-Alpha

## Périmètre

Le système est fictif et n'utilise aucune donnée bancaire réelle. Les tests offensifs restent limités au réseau privé du groupe et à l'API du PC Hôte. Les réseaux du campus, des autres groupes et les services tiers sont hors périmètre.

Documents associés : [EBIOS RM](EBIOS-RM.md), [PCA / PRA](PCA-PRA.md), [NIS2 / DORA](NIS2-DORA.md), [Architecture](ARCHITECTURE.md), [Runbook](RUNBOOK-INCIDENT.md), [Essais](TESTS.md).

## Synthèse EBIOS RM

| Objet | Valeur |
|---|---|
| Biens essentiels | Exécution des paiements, intégrité des transactions, contrôle d'accès |
| Événements redoutés | API indisponible, transactions altérées, accès frauduleux, détournement du remediator, fuite de secrets |
| Sources de risque | PC Attaquant du laboratoire, attaquant ciblé, erreur d'exploitation, panne technique |
| Mesures | WAF, authentification forte, Vault, durcissement, healthchecks, ML, alertes, remédiation limitée |
| Risque résiduel | Faux positifs ML, perte du PC Hôte, Vault en mode développement, secret compromis |

Analyse complète en cinq ateliers : [EBIOS-RM.md](EBIOS-RM.md).

## PCA / PRA

- **PCA** : PostgreSQL persistant, healthchecks, métriques et journaux conservés, dashboard qui expose l'état réel.
- **PRA** : Prometheus détecte la panne, Alertmanager appelle le remediator, Ansible répare PostgreSQL puis l'API et vérifie `/health` avec `database: ok`.
- **RTO de démonstration** : environ 30 s mesurées pour l'API (détection Prometheus 5 s, alerte après 5 s, redémarrage Ansible, contrôle de santé). Voir [TESTS.md](TESTS.md).
- **RPO de démonstration** : nul pour les transactions validées, conservées dans le volume PostgreSQL.

## Authentification et contrôle d'accès

- **Mode par défaut (`AUTH_MODE=password`)** : identifiant et mot de passe stockés dans Vault, comparaison à temps constant, mêmes messages d'erreur pour un mauvais identifiant et un mauvais mot de passe, **blocage de la source après 5 échecs en une minute** (réponse 429, événement `password_blocked` journalisé), session signée de 15 minutes.
- **Mode optionnel (`AUTH_MODE=webauthn`)** : passkey de plateforme (Face ID, Touch ID, Windows Hello) avec **vérification utilisateur obligatoire** ; seule une clé publique est stockée.
- Challenge à usage unique de 5 minutes, contrôle du compteur de signature (détection de clé clonée), sessions signées de 15 minutes.
- L'enrôlement d'un appareil exige le jeton de laboratoire (`PAYMENT_API_TOKEN`) ou une session ouverte.
- Le jeton de laboratoire reste accepté pour les scripts ; les comparaisons de secrets sont à temps constant.

## Gestion des secrets (Vault)

HashiCorp Vault stocke le jeton de laboratoire, le secret de session et le mot de passe PostgreSQL. L'API reçoit uniquement un token applicatif, limité par une politique à la **lecture** de `secret/data/resilience` ; elle n'a plus aucun secret applicatif dans son environnement. Les secrets sources restent dans `.env`, ignoré par Git, et sont réinjectés dans Vault à chaque démarrage.

Limites : Vault est en mode développement (stockage en mémoire, non descellé). En production : stockage persistant, descellement automatisé, rotation, audit, authentification AppRole.

## WAF

Un WAF ModSecurity avec OWASP Core Rule Set (niveau de paranoïa 1) est placé devant l'API : l'API n'est plus publiée directement. Les injections SQL, scripts et traversées de chemin répondent 403 et laissent une trace exploitable dans les journaux, visible dans le dashboard SOC. Le frontend Nginx conserve ses en-têtes de durcissement et sa limitation de débit.

## Durcissement et privilèges

- Conteneurs applicatifs (API, détecteur, assistant) : système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`.
- Réseau `resilience-net` **interne** (sans Internet) ; seuls les ports nécessaires sont publiés. PostgreSQL, Vault, Loki, assistant, remediator et proxys Docker ne sont pas exposés.
- **Remediator** : il possède des droits élevés, donc il est encadré. Il n'accepte que les appels portant un jeton (Alertmanager), ne cible que deux conteneurs nommés, et n'a pas le socket Docker : il passe par un proxy qui n'autorise que les appels sur les conteneurs (exec, images, volumes, réseaux, suppression refusés).
- **Promtail** passe par un second proxy en lecture seule.
- **Assistant IA** : lecture seule, aucun accès Docker ni base, sans outils : il ne peut pas agir sur le système.

## Supervision, SIEM / SOC

Les journaux de tous les conteneurs sont centralisés dans Loki. Le dashboard « Resilience Alpha - SOC » corrèle alertes de sécurité et de disponibilité, événements d'authentification, blocages WAF, verdicts du modèle ML et actions du remediator. Les alertes sont séparées par catégorie :

- `availability` (API ou base indisponible) : remédiation automatique ;
- `security` (rafale de rejets, anomalie ML, échecs d'authentification) : **aucun redémarrage**, analyse humaine. Rétablir un service n'est pas corriger une compromission.

## NIS2 / DORA - limites du prototype

Le démonstrateur couvre partiellement la continuité, la journalisation, la détection et la réponse automatisée. Il ne prétend pas démontrer la conformité réglementaire complète : gestion formelle des tiers, tests de résilience indépendants, gouvernance des changements, notification d'incidents et contrôle d'accès industriel manquent. Détail dans [NIS2-DORA.md](NIS2-DORA.md).

## Preuves de recette

1. Transaction `POST /payments` persistée puis relue par `GET /payments`.
2. `docker stop resilience-payment-api` : alerte `PaymentApiDown`, appel du remediator, retour `healthy`, transaction acceptée après reprise.
3. `docker stop resilience-postgres` : alerte `PaymentDatabaseDown`, réparation de la base puis de l'API, transactions conservées.
4. Burst applicatif depuis le PC Attaquant détecté par `PaymentInvalidRequestBurst` et `PaymentMlAnomalyDetected`, sans redémarrage.
5. Injection SQL et script bloquées par le WAF (403).
6. Appel du remediator sans jeton refusé (401).

Mesures et résultats détaillés : [TESTS.md](TESTS.md). Recette automatisée : `security/e2e_test.ps1`.
