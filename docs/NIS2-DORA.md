# NIS2 et DORA - lecture pour une plateforme de paiement fictive

Le démonstrateur ne constitue pas une certification. Ce document distingue ce que le prototype **démontre**, ce qu'il **démontre partiellement** et ce qui ne peut pas l'être en quatre jours.

## Exigences démontrées ou partiellement démontrées

| Exigence | Texte de référence | Ce que montre le prototype | Preuve |
|---|---|---|---|
| Gestion des risques TIC | NIS2 art. 21 ; DORA chap. II | Analyse EBIOS RM, mesures proportionnées | [EBIOS-RM.md](EBIOS-RM.md) |
| Continuité et reprise | NIS2 art. 21 (continuité) ; DORA art. 11 | Reprise automatique, RTO mesuré, RPO nul sur les transactions validées | [PCA-PRA.md](PCA-PRA.md), [TESTS.md](TESTS.md) |
| Détection d'événements anormaux | DORA art. 10 | Détection ML, alertes, WAF, dashboard SOC | Dashboards Grafana |
| Journalisation et traçabilité | NIS2 art. 21 ; DORA art. 12 | Journaux applicatifs centralisés dans Loki, événements d'authentification | Logs `payment-api`, `waf`, `remediator` |
| Contrôle d'accès et authentification forte | NIS2 art. 21 (MFA, contrôle d'accès) | Mot de passe stocké dans Vault avec blocage anti-force-brute, sessions courtes ; passkey avec vérification utilisateur en option (biométrie ou code de l'appareil), sessions courtes | Tests d'authentification |
| Gestion des secrets | NIS2 art. 21 (cryptographie, gestion des accès) | Vault, token applicatif en lecture seule | Configuration `docker-compose.yml` |
| Tests de résilience | DORA chap. IV | Essais de panne (API, base), essais d'attaque contrôlés | [TESTS.md](TESTS.md) |
| Sécurité du développement | NIS2 art. 21 | Tests automatisés, requêtes paramétrées, validation des entrées | `backend/test`, `ai-detector/tests` |

## Exigences hors de portée d'un prototype de quatre jours

| Exigence | Raison |
|---|---|
| Notification d'incident aux autorités dans les délais (24 h, 72 h) | Suppose un processus organisationnel et un contact réglementaire ; seul un modèle de fiche d'incident est proposé ci-dessous |
| Gestion des risques liés aux prestataires TIC tiers, registre d'information | Nécessite un inventaire contractuel réel |
| Tests de pénétration fondés sur la menace (TLPT) indépendants | Exigent un prestataire externe qualifié |
| Gouvernance et responsabilité de l'organe de direction | Dimension organisationnelle |
| Gestion formelle des changements et des vulnérabilités | Un pipeline d'intégration continue est fourni, pas un processus complet |
| Résilience géographique (site secondaire) | Une seule machine hôte |

## Arbitrages recommandés à une direction

1. Financer d'abord la **redondance** (deuxième hôte, base répliquée) : c'est le principal risque résiduel de continuité.
2. Passer Vault en production (stockage persistant, rotation, audit) avant toute mise en service.
3. Conserver la séparation entre remédiation de disponibilité (automatique) et réponse à compromission (humaine).
4. Mettre en place la sauvegarde automatisée et un test de restauration trimestriel.
5. Faire réaliser un test d'intrusion indépendant avant toute exposition publique.

## Modèle de fiche d'incident

| Champ | Contenu |
|---|---|
| Date et heure de détection | Alerte et horodatage Prometheus |
| Nature | Disponibilité ou sécurité |
| Services touchés | Conteneurs et fonctions métier |
| Impact | Durée d'indisponibilité, transactions concernées |
| Action menée | Automatique (playbook) ou manuelle |
| Preuve de reprise | `/health` et transaction de contrôle |
| Cause et suites | Analyse après incident, mesure corrective |
