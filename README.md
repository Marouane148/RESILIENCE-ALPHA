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

Modifier `.env` et remplacer les placeholders. Les deux tokens doivent être identiques. Pour un test entre ordinateurs, remplacer `192.168.137.1` par l'adresse IP privée du PC Hôte :

```env
POSTGRES_DB=resilience
POSTGRES_USER=resilience
POSTGRES_PASSWORD=un-secret-local
PAYMENT_API_TOKEN=un-token-de-laboratoire
VITE_API_TOKEN=un-token-de-laboratoire
VITE_API_URL=http://192.168.137.1:3000
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=un-secret-grafana
```

Ne jamais publier `.env`. Il est ignoré par Git. Si le volume PostgreSQL existe déjà, conserver le mot de passe utilisé lors de sa première initialisation.

Démarrer toute la plateforme :

```bash
docker compose up -d --build
```

## Test entre trois ordinateurs

Le PC Hôte exécute Docker. Le PC Attaquant et le PC IA doivent être connectés au même réseau privé du groupe. Aucun test ne doit viser le réseau du campus ou Internet.

Sur le PC Hôte, trouver l'adresse IP privée :

```bash
# macOS
ipconfig getifaddr en0

# Windows PowerShell
ipconfig
```

Renseigner cette adresse dans `.env`, puis reconstruire le frontend :

```env
VITE_API_URL=http://ADRESSE_IP_DU_PC_HOTE:3000
```

```bash
docker compose up -d --build frontend
```

Depuis le PC Attaquant, tester l'API du laboratoire :

```bash
curl http://ADRESSE_IP_DU_PC_HOTE:3000/health
```

Le PC IA peut accéder uniquement aux interfaces publiées nécessaires : frontend `8080`, API `3000`, Prometheus `9090`, Grafana `3001` et Alertmanager `9093`. PostgreSQL, Loki et le socket Docker ne sont pas exposés.

Pour lancer le burst contrôlé depuis le PC Attaquant :

```bash
LAB_HOST_IP=ADRESSE_IP_DU_PC_HOTE \
  DURATION_SECONDS=10 CONCURRENCY=2 \
  bash security/controlled_payment_burst.sh
```

Le script n'accepte que `localhost`, `127.0.0.1` ou l'adresse fournie par `LAB_HOST_IP`. En cas d'échec, vérifier le même réseau privé, le pare-feu du PC Hôte, Docker Desktop et l'absence de VPN isolant les machines.

### Recette depuis Windows PowerShell

Remplacer `192.168.137.23` par l'adresse IP actuelle du PC Hôte :

```powershell
$hostIp = "192.168.137.23"
ping $hostIp
Test-NetConnection $hostIp -Port 8080
Test-NetConnection $hostIp -Port 3000
curl.exe "http://${hostIp}:3000/health"
```

Ouvrir le dashboard dans le navigateur Windows :

```text
http://192.168.137.23:8080
```

Pour simuler le trafic malveillant contrôlé depuis le PC Attaquant, uniquement contre l'API fictive du PC Hôte :

```powershell
$hostIp = "192.168.137.23"
$url = "http://${hostIp}:3000/payments"
$body = '{"recipient":"lab-attack","amount":0}'

1..300 | ForEach-Object {
  try {
    Invoke-WebRequest `
      -Uri $url `
      -Method POST `
      -ContentType "application/json" `
      -Body $body `
      -TimeoutSec 2 `
      -UseBasicParsing | Out-Null
  } catch {}
}

Write-Host "Burst de laboratoire termine"
```

Ce scénario produit des requêtes de paiement invalides et observables. Il ne s'agit pas d'une injection SQL : l'API utilise des requêtes PostgreSQL paramétrées.

Sur le Mac Hôte, observer les preuves pendant le test :

```bash
cd /Users/mac/alpha/RESILIENCE-ALPHA
docker compose logs -f payment-api remediator
```

Dans un autre terminal Mac :

```bash
curl -s http://localhost:3000/metrics | grep payment_api
curl -s http://localhost:9090/api/v1/alerts
```

Les alertes attendues sont `PaymentInvalidRequestBurst` et/ou `PaymentMlAnomalyDetected`.

Pour démontrer ensuite la reprise autonome, arrêter uniquement l'API sur le Mac :

```bash
docker stop resilience-payment-api
```

Depuis Windows, attendre son retour :

```powershell
curl.exe --retry 12 --retry-delay 2 "http://192.168.137.23:3000/health"
```

Le résultat final attendu est un statut `ok` avec `database: ok`. Effectuer ensuite un nouveau paiement depuis le dashboard pour prouver la reprise métier.

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

## Captures Grafana pour la vidéo

Grafana est provisionné automatiquement avec les sources Prometheus et Loki et le dashboard :

```text
Resilience Alpha - Incident & Recovery
```

Ouvrir Grafana :

```text
http://ADRESSE_IP_DU_PC_HOTE:3001
```

Sur le PC Hôte, l'URL locale est `http://localhost:3001`. Se connecter avec les identifiants `GRAFANA_ADMIN_USER` et `GRAFANA_ADMIN_PASSWORD` définis dans `.env`, puis ouvrir le dossier **Resilience Alpha** et le dashboard **Resilience Alpha - Incident & Recovery**.

Le dashboard affiche :

- disponibilité de l'API paiement (`up`) ;
- taux de requêtes rejetées ;
- état de l'anomalie ML ;
- logs de `resilience-payment-api` via Loki.

### Séquence de captures recommandée

1. **Avant incident** : afficher le dashboard avec API disponible, anomalie ML à `0` et logs normaux.
2. **Pendant le burst Windows** : lancer la recette PowerShell ci-dessus, régler la période Grafana sur les quinze dernières minutes et capturer la hausse des rejets ainsi que les logs.
3. **Pendant la panne** : sur le Mac, exécuter `docker stop resilience-payment-api` et capturer l'API à `0` dans le panneau de disponibilité.
4. **Remédiation** : capturer les logs `remediator` avec `returncode: 0` et l'API revenue à `1`.
5. **Après reprise** : exécuter un paiement depuis le dashboard et capturer la transaction acceptée.

Pour actualiser les panneaux pendant la démonstration, choisir une actualisation automatique de cinq secondes dans Grafana. Le dashboard est également accessible depuis Windows avec l'adresse LAN du PC Hôte.

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
