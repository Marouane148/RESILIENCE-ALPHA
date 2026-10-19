# Project Resilience-Alpha

Démonstrateur EPSI de cyber-résilience et reprise autonome sur une plateforme de paiement fictive. Aucune donnée bancaire réelle ne doit être utilisée.

## Démarrage rapide

### Prérequis

- Git ;
- Docker Desktop démarré ;
- au moins 4 cœurs CPU, 16 Go de RAM et 50 Go libres recommandés.

Cloner le dépôt :

```bash
git clone https://github.com/ilyaslahfaouti/RESILIENCE-ALPHA.git
cd RESILIENCE-ALPHA
```

Créer la configuration locale :

```bash
cp .env.example .env
```

Modifier `.env` et remplacer les placeholders. Les deux tokens doivent être identiques :

```env
POSTGRES_DB=resilience
POSTGRES_USER=resilience
POSTGRES_PASSWORD=un-secret-local
PAYMENT_API_TOKEN=un-token-de-laboratoire
VITE_API_TOKEN=un-token-de-laboratoire
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=un-secret-grafana
```

Ne jamais publier `.env`. Il est ignoré par Git. Si le volume PostgreSQL existe déjà, conserver le mot de passe utilisé lors de sa première initialisation.

Démarrer toute la plateforme :

```bash
docker compose up -d --build
```

Vérifier l'état des services :

```bash
docker compose ps
```

Les services doivent être `healthy` ou `running`.

Interfaces locales :

- Frontend : http://localhost:8080
- API : http://localhost:3000/health
- Prometheus : http://localhost:9090
- Alertmanager : http://localhost:9093
- Grafana : http://localhost:3001

Identifiants Grafana : `GRAFANA_ADMIN_USER` et `GRAFANA_ADMIN_PASSWORD` définis dans `.env`.

Le frontend utilise `VITE_API_TOKEN` pour appeler l'API. Les routes métier exigent le même token dans `PAYMENT_API_TOKEN`.

Vérifier l'API :

```bash
curl http://localhost:3000/health
```

Résultat attendu : un statut `ok` avec `database: ok`.

## Effectuer un paiement fictif

Depuis le dashboard, ouvrir http://localhost:8080, saisir un destinataire et un montant, puis cliquer sur **Valider le paiement**.

Le paiement est écrit dans PostgreSQL uniquement après validation par l'API. Pour tester en ligne de commande :

```bash
TOKEN=$(grep '^PAYMENT_API_TOKEN=' .env | cut -d= -f2-)

curl -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"recipient":"oussama","amount":1000}'
```

Lire les transactions persistées :

```bash
curl http://localhost:3000/payments \
  -H "Authorization: Bearer $TOKEN"
```

Une requête sans token doit répondre `401`.

## Démonstration de reprise autonome

### 1. Vérifier une transaction avant incident

```bash
TOKEN=$(grep '^PAYMENT_API_TOKEN=' .env | cut -d= -f2-)
curl -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"recipient":"before-incident","amount":10}'
```

### 2. Injecter une panne contrôlée

```bash
docker stop resilience-payment-api
```

Cette commande est strictement limitée au conteneur fictif du projet. Le service utilise `restart: no` afin que la reprise soit effectuée par le remediator et non par Docker.

### 3. Observer la détection et la remédiation

La chaîne automatique est :

```text
Panne API → Prometheus → Alertmanager → remediator → Ansible → healthcheck healthy
```

Observer les interfaces :

- Prometheus : http://localhost:9090, alerte `PaymentApiDown` ;
- Alertmanager : http://localhost:9093 ;
- Grafana : http://localhost:3001 ;
- logs du remediator :

```bash
docker compose logs -f remediator
```

### 4. Vérifier le retour du service

4. Vérifier le retour métier :

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"recipient":"after-recovery","amount":1}'
```

La reprise n'est considérée comme réussie que si le healthcheck est `healthy` et que cette nouvelle transaction est acceptée.

## Tester la détection d'anomalie

Le script d'attaque applicative contrôlée est `security/controlled_payment_burst.sh`. Il refuse toute cible autre que l'API locale :

```bash
DURATION_SECONDS=10 CONCURRENCY=2 \
  bash security/controlled_payment_burst.sh
```

Le burst alimente les métriques `payment_api_rejected_requests_total` et le détecteur Isolation Forest. Le signal ML est visible sur le port interne du service et l'alerte `PaymentMlAnomalyDetected` est exposée par Prometheus.

## Arrêter la plateforme

Arrêter les conteneurs en conservant les données :

```bash
docker compose down
```

Arrêter les conteneurs et supprimer les volumes, y compris les transactions PostgreSQL :

```bash
docker compose down -v
```

Utiliser cette dernière commande uniquement pour réinitialiser complètement le laboratoire.

## Composants

- Node.js/Express : API métier et métriques Prometheus
- PostgreSQL : persistance des transactions fictives
- React/Tailwind/Nginx : dashboard et filtrage frontal léger
- Prometheus/Grafana/Loki/Promtail : métriques, visualisation et journaux
- Isolation Forest/scikit-learn : détection d’anomalies de trafic
- Alertmanager + Ansible + Docker API : remédiation autonome

## Documentation

- [Sécurité et gouvernance](docs/SECURITY-GOVERNANCE.md)
- [Détection ML](ai-detector/README.md)
- [Remédiation Ansible](ansible/README.md)
- [Variables sans secret](.env.example)

## Limites assumées

Ce prototype ne constitue pas une certification NIS2/DORA ni un système bancaire. Vault/SOPS, un WAF industriel ModSecurity/OWASP CRS, Ollama/LangChain/RAG, l’authentification centralisée et l’exécution depuis un PC Attaquant distinct doivent être ajoutés pour une couverture complète du cahier des charges.
