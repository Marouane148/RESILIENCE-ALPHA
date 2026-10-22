# Runbook opérateur - Resilience-Alpha

Ce document décrit les procédures à suivre pour diagnostiquer et traiter un incident sur la plateforme de paiement fictive. L'assistant opérateur s'appuie sur ce texte pour répondre.

## Principe général

La plateforme se rétablit seule pour les pannes de **disponibilité**. L'opérateur observe, vérifie et décide ; il n'a pas à relancer le service à la main. Les alertes de **sécurité** ne déclenchent aucun redémarrage : elles demandent une analyse humaine.

Chaîne de reprise automatique : Prometheus détecte la panne, Alertmanager appelle le remediator (avec un jeton), le remediator exécute le playbook Ansible, qui relance le conteneur concerné, attend son état `healthy` puis vérifie que `/health` répond `ok` avec `database: ok`.

## Où observer

- Grafana, http://localhost:3001 : dashboard « Resilience Alpha - Incident & Recovery » (disponibilité, rejets, anomalie ML, logs) et dashboard « Resilience Alpha - SOC » (alertes, authentification, WAF, remédiation).
- Prometheus, http://localhost:9090/alerts : état des alertes.
- Alertmanager, http://localhost:9093 : alertes reçues et routage.
- Dashboard de paiement, http://localhost:8080 : état de l'API en direct et journal de reprise.

## Alerte PaymentApiDown (disponibilité, critique)

Signification : Prometheus ne parvient plus à lire les métriques de l'API de paiement.

Action automatique : le remediator redémarre `resilience-payment-api`, attend `healthy`, vérifie `/health`.

Vérifications de l'opérateur :
1. Dans Grafana, le panneau « API paiement disponible » passe à 0 puis revient à 1 en environ 30 secondes.
2. `docker compose logs remediator` affiche `{"event": "remediation", "returncode": 0}`.
3. `curl http://localhost:3000/health` répond `"status":"ok"` et `"database":"ok"`.
4. Un nouveau paiement depuis le dashboard est accepté : c'est la preuve de reprise métier.

Si la reprise échoue (returncode différent de 0) : lire la sortie Ansible dans les logs du remediator, vérifier que Docker fonctionne et que le conteneur existe (`docker compose ps`), puis relancer `docker compose up -d`.

## Alerte PaymentDatabaseDown (disponibilité, critique)

Signification : l'API ne joint plus PostgreSQL (`payment_api_database_up` à 0). L'API répond 503 sur `/health` et sur les paiements.

Action automatique : le playbook répare d'abord `resilience-postgres` puis `resilience-payment-api`, dans cet ordre.

Vérifications : `docker compose ps` doit montrer postgres `healthy` ; les transactions précédentes restent présentes car elles sont dans le volume `postgres-data` (RPO nul pour les transactions validées).

## Alerte PaymentInvalidRequestBurst (sécurité, avertissement)

Signification : plus de 5 requêtes rejetées par seconde sur l'API, typique d'un déni de service applicatif ou d'un scan.

Aucune remédiation automatique : redémarrer l'API ne neutralise pas l'attaquant. Actions de l'opérateur :
1. Identifier la source dans les logs : `docker compose logs payment-api` (événements `auth_rejected`, `payment_request_rejected`) et dans le dashboard SOC.
2. Vérifier que le service reste disponible : `curl http://localhost:3000/health`.
3. Si l'attaque persiste, bloquer la source au niveau du pare-feu du PC Hôte ou du réseau du laboratoire et consigner l'incident.

## Alerte PaymentMlAnomalyDetected (sécurité, avertissement)

Signification : le modèle Isolation Forest juge le profil de trafic inhabituel (taux de requêtes et de rejets). Une panne de l'API n'est pas considérée comme une anomalie de trafic.

Vérifier le score (`resilience_anomaly_score`) et le taux de rejets dans Grafana. Une anomalie sans burst d'erreurs peut être un faux positif ; la comparer avec les logs avant toute décision.

## Alerte PaymentBiometricAuthFailures (sécurité, avertissement)

Signification : plus de 5 échecs d'authentification en 2 minutes (mauvais mot de passe, blocage de la source, ou en mode passkey : assertion invalide, clé inconnue, challenge rejoué, compteur de signature non croissant).

Actions : consulter les événements `password_failed`, `password_blocked`, `webauthn_*` et `auth_rejected` dans le dashboard SOC ; un compteur non croissant peut indiquer une clé clonée, à traiter comme une compromission potentielle (supprimer le credential concerné et réenrôler l'appareil).

## Attaque bloquée par le WAF

Le WAF ModSecurity avec OWASP Core Rule Set filtre les requêtes avant l'API. Une tentative d'injection SQL ou de script répond 403 et laisse une trace `ModSecurity: Access denied` dans les logs du conteneur `resilience-waf`, visible dans le dashboard SOC. Ces requêtes n'atteignent jamais l'API.

## Connexion impossible

- Mode mot de passe (défaut) : vérifier l'identifiant et le mot de passe (`DASHBOARD_USER`, `DASHBOARD_PASSWORD` dans `.env`). Après 5 échecs en une minute, la source est bloquée une minute (message « Trop de tentatives »).
- Mode passkey (`AUTH_MODE=webauthn`) :

- WebAuthn exige HTTPS ou `localhost`. Depuis une autre machine en `http://IP`, la connexion biométrique est indisponible.
- Vérifier `WEBAUTHN_RP_ID` et `WEBAUTHN_ORIGIN` : ils doivent correspondre exactement à l'adresse du navigateur.
- Enrôlement refusé : le code d'enrôlement est la valeur de `PAYMENT_API_TOKEN`.

## Assistant opérateur

L'assistant répond à partir de ce runbook et de la documentation du dépôt. Il ne peut exécuter aucune action. Au premier démarrage, il attend le téléchargement des modèles Ollama (quelques minutes).

## Commandes utiles

- État des services : `docker compose ps`
- Logs d'un service : `docker compose logs -f <service>`
- Panne contrôlée pour la démonstration : `docker stop resilience-payment-api`
- Redémarrer toute la plateforme : `docker compose up -d`
- Réinitialiser entièrement le laboratoire (supprime les données) : `docker compose down -v`
