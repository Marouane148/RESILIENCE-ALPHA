# Project Resilience-Alpha

Démonstrateur EPSI de cyber-résilience et reprise autonome sur une plateforme de paiement fictive. Aucune donnée bancaire réelle ne doit être utilisée.

## Démarrage

```bash
cp .env.example .env
# Remplacer les valeurs par des secrets de laboratoire locaux
# Pour un volume PostgreSQL déjà initialisé, conserver son mot de passe existant.
docker compose up -d --build
```

Interfaces locales :

- Frontend : http://localhost:8080
- API : http://localhost:3000/health
- Prometheus : http://localhost:9090
- Alertmanager : http://localhost:9093
- Grafana : http://localhost:3001

Le frontend utilise `VITE_API_TOKEN` pour appeler l'API. Les routes métier exigent le même token dans `PAYMENT_API_TOKEN`.

## Démonstration de reprise autonome

1. Vérifier une transaction authentifiée :

```bash
TOKEN=$(grep '^PAYMENT_API_TOKEN=' .env | cut -d= -f2-)
curl -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"recipient":"before-incident","amount":10}'
```

2. Injecter un incident contrôlé depuis le PC Hôte de laboratoire :

```bash
docker stop resilience-payment-api
```

3. Observer `PaymentApiDown` dans Prometheus/Alertmanager. Le remediator lance Ansible, qui redémarre uniquement `resilience-payment-api` et attend son état `healthy`.

4. Vérifier le retour métier :

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"recipient":"after-recovery","amount":1}'
```

Le script d’attaque applicative contrôlée est `security/controlled_payment_burst.sh`. Il refuse toute cible autre que l’API locale.

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
