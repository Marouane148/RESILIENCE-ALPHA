# Sécurité et gouvernance - Resilience-Alpha

## Périmètre

Le système est fictif et n'utilise aucune donnée bancaire réelle. Les tests offensifs doivent rester limités au réseau du groupe et à l'API du PC Hôte.

## EBIOS RM simplifié

| Objet | Valeur |
|---|---|
| Bien essentiel | Disponibilité et intégrité des transactions fictives |
| Événement redouté | API de paiement indisponible ou trafic anormal |
| Sources de risque | PC Attaquant du laboratoire, erreur de déploiement, panne de conteneur |
| Mesures | Healthchecks, Prometheus, Loki, Isolation Forest, Alertmanager, Ansible |
| Risque résiduel | Faux positifs ML, perte du PC Hôte, secret compromis |

## PCA / PRA

- **PCA** : PostgreSQL persistant, healthchecks, métriques et journaux ; aucune donnée réelle.
- **PRA** : Prometheus détecte la panne, Alertmanager appelle le remediator, Ansible redémarre l'API et attend `healthy`, puis une transaction de contrôle est exécutée.
- **RTO de démonstration** : inférieur à une minute dans les essais locaux.
- **RPO de démonstration** : les transactions validées avant la panne restent dans le volume PostgreSQL.

## Accès et secrets

Les routes métier exigent `Authorization: Bearer <PAYMENT_API_TOKEN>`. Les secrets locaux sont dans `.env`, ignoré par Git ; `.env.example` documente les variables sans fournir de secret utilisable.

En production, le token serait fourni par Vault ou SOPS avec rotation, audit et séparation des privilèges. Le socket Docker n'est monté que dans le remediator, qui ne cible que `resilience-payment-api`.

## WAF léger

Le frontal Nginx applique une limitation de débit, des en-têtes de durcissement et bloque quelques motifs d'injection évidents. Ce filtre est adapté à la démonstration et doit être remplacé par ModSecurity/OWASP CRS ou un WAF managé en contexte industriel.

## NIS2 / DORA - limites du prototype

Le démonstrateur couvre partiellement la continuité, la journalisation, la détection et la réponse automatisée. Il ne prétend pas démontrer la conformité réglementaire complète : il manque notamment gestion formelle des tiers, tests de résilience indépendants, gouvernance des changements, notification d'incidents et contrôle d'accès industriel.

## Preuves de recette

1. Transaction `POST /payments` persistée puis relue par `GET /payments`.
2. `docker stop resilience-payment-api` avec `restart: no`.
3. Alerte Prometheus `PaymentApiDown` puis appel Alertmanager/remediator.
4. Retour `running/healthy` et transaction `recovery-proof` acceptée après reprise.
5. Burst local contrôlé détecté par `PaymentInvalidRequestBurst` et par `resilience_anomaly_detected`.
