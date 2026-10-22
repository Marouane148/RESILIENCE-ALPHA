# Project Resilience-Alpha

Démonstrateur EPSI de cyber-résilience et de reprise autonome sur une plateforme de paiement fictive. Aucune donnée bancaire réelle ne doit être utilisée. Toutes les actions offensives restent limitées au réseau privé du groupe.

La plateforme encaisse un incident (panne d'un service, attaque applicative) et retrouve un état utilisable **sans intervention humaine** : la reprise automatique est mesurée à environ 30 secondes et prouvée par une nouvelle transaction acceptée.

## Sommaire

1. [Architecture](#architecture)
2. [Démarrage rapide](#démarrage-rapide)
3. [Authentification](#authentification)
4. [Vérifier le système](#vérifier-le-système)
5. [Scénarios d'attaque (PC Attaquant)](#scénarios-dattaque-pc-attaquant)
6. [Démonstration de reprise autonome](#démonstration-de-reprise-autonome)
7. [Observabilité et SOC](#observabilité-et-soc)
8. [Assistant opérateur](#assistant-opérateur)
9. [Test entre ordinateurs](#test-entre-ordinateurs)
10. [Documentation](#documentation)
11. [Arrêter la plateforme](#arrêter-la-plateforme)
12. [Limites assumées](#limites-assumées)

## Architecture

| Domaine | Composants |
|---|---|
| Développement | API Node.js/Express, PostgreSQL, frontend React/Tailwind/Nginx, authentification WebAuthn, remediator |
| Infrastructure | Docker Compose, Ansible, Prometheus, Grafana, Loki, Promtail, Alertmanager |
| IA / Data | Isolation Forest (scikit-learn), assistant Ollama + LangChain + RAG |
| Cybersécurité | WAF ModSecurity + OWASP CRS, HashiCorp Vault, durcissement des conteneurs, dashboard SOC |
| Gouvernance | EBIOS RM, PCA/PRA, NIS2/DORA, runbook |

Schémas et flux détaillés : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Chaîne de reprise : `Panne → Prometheus → Alertmanager → remediator → Ansible → healthcheck → /health ok`. Les alertes de **sécurité** n'entraînent aucun redémarrage : rétablir un service ne neutralise pas un attaquant.

## Démarrage rapide

### Prérequis

- Git ;
- Docker Desktop démarré (WSL 2 sous Windows) ;
- au moins 4 cœurs CPU, 16 Go de RAM et 50 Go libres recommandés (l'assistant local utilise environ 3 à 4 Go de RAM).

### 1. Cloner le dépôt

```bash
git clone https://github.com/ilyaslahfaouti/RESILIENCE-ALPHA.git
cd RESILIENCE-ALPHA
```

### 2. Créer la configuration locale

```bash
cp .env.example .env
```

Remplacer **toutes** les valeurs `replace-with-...` par des secrets longs et aléatoires. Génération d'un secret :

```bash
openssl rand -hex 24
```

```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

Variables obligatoires :

| Variable | Rôle |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe de la base (injecté dans Vault) |
| `PAYMENT_API_TOKEN` | Jeton de laboratoire : scripts de test et code d'enrôlement Face ID |
| `SESSION_SECRET` | Signature des sessions Face ID |
| `VAULT_ROOT_TOKEN`, `VAULT_APP_TOKEN` | Jetons Vault (administration du coffre, lecture seule pour l'API) |
| `REMEDIATOR_TOKEN` | Secret qu'Alertmanager présente au remediator |
| `GRAFANA_ADMIN_PASSWORD` | Mot de passe Grafana |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` | Domaine et URL exacts utilisés dans le navigateur pour Face ID |

Ne jamais publier `.env` (ignoré par Git). Si le volume PostgreSQL ou Grafana existe déjà, **conserver les mots de passe utilisés à leur première initialisation** : ces services ne les relisent pas ensuite.

### 3. Démarrer toute la plateforme

```bash
docker compose up -d --build
docker compose ps
```

Au premier démarrage, l'assistant télécharge ses modèles locaux (environ 2 Go, quelques minutes) ; le reste de la plateforme est utilisable immédiatement. Les services doivent être `healthy` ou `running`.

### Interfaces

| Interface | URL |
|---|---|
| Dashboard de paiement | http://localhost:8080 |
| API (derrière le WAF) | http://localhost:3000/health |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |

PostgreSQL, Vault, Loki, l'assistant, Ollama, le remediator et les proxys Docker ne sont **pas** exposés au réseau.

## Authentification

Le mode de connexion se règle avec `AUTH_MODE` dans `.env` :

| Mode | Fonctionnement |
|---|---|
| `password` (**défaut**) | Identifiant et mot de passe (`DASHBOARD_USER`, `DASHBOARD_PASSWORD`, stockés dans Vault). Session signée de 15 minutes. Après 5 échecs en une minute, la source est bloquée une minute (réponse 429) et l'événement est journalisé. |
| `webauthn` | Passkey de plateforme : Face ID, Touch ID, Windows Hello. Vérification utilisateur obligatoire, challenge à usage unique, compteur de signature. Seule une clé publique est stockée. |

En mode `password`, les routes Face ID répondent 404. Le jeton `PAYMENT_API_TOKEN` reste accepté pour les scripts et les `curl`.

### Mode mot de passe

1. Renseigner `DASHBOARD_USER` et `DASHBOARD_PASSWORD` dans `.env` (mot de passe long et aléatoire).
2. `docker compose up -d` (Vault reçoit les identifiants au démarrage).
3. Ouvrir http://localhost:8080 et se connecter.

### Mode Face ID (facultatif)

Mettre `AUTH_MODE=webauthn`, puis `docker compose up -d`. Enrôlement : « Première connexion ? Enrôler cet appareil », nom d'utilisateur, code d'enrôlement (valeur de `PAYMENT_API_TOKEN`), puis Windows Hello ou Face ID.

- WebAuthn exige HTTPS ou `localhost`. Depuis un autre poste en `http://192.168.x.x`, la connexion biométrique est indisponible : voir [HTTPS et Face ID](docs/HTTPS-FACE-ID.md).
- `WEBAUTHN_RP_ID` (nom d'hôte, sans port) et `WEBAUTHN_ORIGIN` (URL exacte du frontend) doivent correspondre à l'adresse du navigateur.
- Sous Windows, si la reconnaissance faciale reste bloquée sur « Préparation… », utiliser le code PIN (Options de connexion).

L'interface propose trois thèmes (clair, sombre, automatique) via le sélecteur en haut à droite.

## Vérifier le système

### Tests automatisés

```bash
cd backend && npm install && npm test          # authentification mot de passe et WebAuthn, secrets (21 tests)
```

```bash
cd ai-detector && pip install -r requirements.txt && python -m unittest discover -s tests -v   # détecteur ML
```

La CI GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) exécute ces tests, le build du frontend et la validation du compose.

### Recette de bout en bout (PC Hôte)

```powershell
.\security\e2e_test.ps1                    # contrôles de sécurité + pannes API et PostgreSQL
.\security\e2e_test.ps1 -SkipDisruptive    # sans provoquer de panne
```

Le script vérifie l'authentification, le blocage WAF, le durcissement des conteneurs, l'isolation du remediator, puis mesure la reprise autonome après l'arrêt de l'API et de PostgreSQL. Résultats consignés dans [docs/TESTS.md](docs/TESTS.md).

### Paiement manuel

```bash
TOKEN=$(grep '^PAYMENT_API_TOKEN=' .env | cut -d= -f2-)
curl -X POST http://localhost:3000/payments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"recipient":"oussama","amount":1000}'
curl http://localhost:3000/payments -H "Authorization: Bearer $TOKEN"
```

Une requête sans jeton répond `401`. Documentation de l'API : [docs/openapi.yaml](docs/openapi.yaml).

## Scénarios d'attaque (PC Attaquant)

Le PC Attaquant doit être sur le **même réseau privé que le PC Hôte** (point d'accès mobile Windows, `192.168.137.1`), jamais sur le réseau du campus.

Sur le PC Hôte, autoriser les ports de la plateforme pour ce seul réseau (PowerShell administrateur) :

```powershell
New-NetFirewallRule -DisplayName "Resilience-Lab" -Direction Inbound -Protocol TCP -LocalPort 8080,3000,9090,3001,9093 -RemoteAddress 192.168.137.0/24 -Action Allow -Profile Any
```

Sur le PC Attaquant :

```powershell
$hostIp = "192.168.137.1"
Test-NetConnection $hostIp -Port 3000
curl.exe "http://${hostIp}:3000/health"

.\security\attack_from_attacker_pc.ps1 -HostIp $hostIp -Scenario burst -Count 1000
.\security\attack_from_attacker_pc.ps1 -HostIp $hostIp -Scenario injection
.\security\attack_from_attacker_pc.ps1 -HostIp $hostIp -Scenario auth
```

Le script refuse toute adresse non privée. Équivalent bash : `LAB_HOST_IP=192.168.137.1 DURATION_SECONDS=20 CONCURRENCY=6 bash security/controlled_payment_burst.sh`.

| Scénario | Effet observable | Détection / réponse |
|---|---|---|
| `burst` : rafale de paiements invalides | Hausse des rejets, anomalie ML | `PaymentInvalidRequestBurst`, `PaymentMlAnomalyDetected` (sécurité, pas de redémarrage) |
| `injection` : SQL et script | Réponse 403 | Blocage par le WAF, journal ModSecurity dans le dashboard SOC |
| `auth` : connexions biométriques invalides | Réponses 401 | `PaymentBiometricAuthFailures` |

Ces scénarios produisent des requêtes observables ; l'API n'est pas vulnérable à l'injection SQL (requêtes paramétrées), et le WAF bloque en amont les motifs connus.

## Démonstration de reprise autonome

1. Vérifier l'état initial : `curl http://localhost:3000/health` et un paiement depuis le dashboard.
2. Injecter une panne contrôlée, strictement limitée aux conteneurs du projet :
   ```bash
   docker stop resilience-payment-api      # ou : docker stop resilience-postgres
   ```
   Les services utilisent `restart: "no"` pour l'API : la reprise est assurée par le remediator, pas par Docker.
3. Observer : le dashboard affiche « Panne détectée » puis « Service rétabli, reprise automatique en N s » ; Grafana montre l'API à 0 puis à 1 ; `docker compose logs -f remediator` affiche `returncode: 0`.
4. Prouver la reprise métier : `/health` répond `ok` avec `database: ok`, **et** un nouveau paiement est accepté.

La reprise n'est considérée comme réussie que si ces deux conditions sont réunies.

## Observabilité et SOC

Grafana est provisionné avec Prometheus, Loki et deux dashboards (dossier **Resilience Alpha**) :

- **Resilience Alpha - Incident & Recovery** : disponibilité de l'API, taux de rejets, anomalie ML, logs.
- **Resilience Alpha - SOC** : alertes de sécurité et de disponibilité, authentification, blocages WAF, détection ML, actions du remediator.

Connexion avec `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (valeur de la première initialisation du volume). Régler l'actualisation sur 5 s pour la démonstration.

Séquence de captures recommandée : avant incident, pendant le burst, pendant la panne (API à 0), remédiation (`returncode: 0`, API à 1), après reprise (paiement accepté).

## Assistant opérateur

Un assistant local (Ollama + LangChain, recherche documentaire RAG) répond aux questions des opérateurs à partir de [docs/RUNBOOK-INCIDENT.md](docs/RUNBOOK-INCIDENT.md) et de la documentation. Modèle par défaut : `qwen2.5:1.5b` (moins de 8 milliards de paramètres) ; embeddings `nomic-embed-text`. Il est accessible depuis le dashboard, via un relais authentifié de l'API.

Il n'exécute **aucune action** : lecture seule, sans accès Docker ni base de données, sur le réseau interne uniquement. Il se distingue ainsi de l'automate de remédiation.

## Test entre ordinateurs

Le PC Hôte exécute Docker. Le PC Attaquant (et un éventuel PC IA) sont sur le même réseau privé du groupe. Aucun test ne vise le réseau du campus ou Internet.

1. Sur le PC Hôte, activer le point d'accès mobile Windows, relever l'adresse IP (`ipconfig`, en général `192.168.137.1`) et ouvrir les ports (commande de pare-feu ci-dessus).
2. Renseigner `VITE_API_URL=http://ADRESSE_IP_DU_PC_HOTE:3000` dans `.env`, puis reconstruire : `docker compose up -d --build frontend`.
3. Depuis le PC Attaquant : vérifier `/health`, puis lancer les scénarios ci-dessus.

Le PC IA ne doit accéder qu'aux interfaces nécessaires : frontend 8080, API 3000, Prometheus 9090, Grafana 3001, Alertmanager 9093. En cas d'échec : même réseau privé, pare-feu du PC Hôte, Docker Desktop démarré, absence de VPN isolant les machines.

## Documentation

| Document | Contenu |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Composants, réseaux, flux, décisions |
| [Sécurité et gouvernance](docs/SECURITY-GOVERNANCE.md) | Synthèse sécurité, accès, secrets, WAF |
| [EBIOS RM](docs/EBIOS-RM.md) | Analyse de risques en cinq ateliers |
| [PCA / PRA](docs/PCA-PRA.md) | Objectifs RTO/RPO, scénarios couverts, risques résiduels |
| [NIS2 / DORA](docs/NIS2-DORA.md) | Exigences démontrées, hors de portée, arbitrages |
| [Runbook opérateur](docs/RUNBOOK-INCIDENT.md) | Procédures par alerte (source de l'assistant) |
| [Résultats des essais](docs/TESTS.md) | Mesures de reprise et recette |
| [API](docs/openapi.yaml) | Contrat OpenAPI |
| [Détection ML](ai-detector/README.md) | Données, modèle, limites |
| [Remédiation Ansible](ansible/README.md) | Playbooks et périmètre |
| [Clip Chrono](docs/CLIP-CHRONO.md) | Scénario de la vidéo de 60 secondes |
| [Guide de démonstration](docs/GUIDE-DEMO.md) | Préparation, déroulé minuté, tests, dépannage, questions du jury |
| [HTTPS et Face ID](docs/HTTPS-FACE-ID.md) | Face ID depuis un autre poste |

## Arrêter la plateforme

Conserver les données :

```bash
docker compose down
```

Supprimer aussi les volumes (transactions, utilisateurs Face ID, modèles Ollama) — réinitialisation complète du laboratoire uniquement :

```bash
docker compose down -v
```

## Limites assumées

Ce prototype ne constitue pas une certification NIS2/DORA ni un système bancaire.

- Vault tourne en mode développement (stockage en mémoire, secrets réinjectés à chaque démarrage) ; la production exigerait un stockage persistant, la rotation et l'audit.
- Le proxy Docker restreint les routes accessibles au remediator mais ne filtre pas le contenu des requêtes.
- Le WAF est réglé en niveau de paranoïa 1 ; une limitation de débit par source reste à ajouter.
- Le modèle ML s'appuie sur deux signaux (taux de requêtes et de rejets) ; faux positifs possibles.
- Une seule machine hôte : pas de réplication ni de bascule entre sites.
- Face ID depuis un autre poste nécessite HTTPS et un nom de domaine.
