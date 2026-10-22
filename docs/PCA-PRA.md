# PCA / PRA - Resilience-Alpha

Plans adaptés au démonstrateur livré. Les valeurs de reprise sont **mesurées** sur la plateforme (voir [TESTS.md](TESTS.md)).

## Objectifs de continuité et de reprise

| Fonction | Criticité | RTO visé | RTO mesuré | RPO |
|---|---|---|---|---|
| Exécution des paiements (API) | Critique | 60 s | 28,7 s en moyenne (25 à 33 s) | 0 (transactions validées dans PostgreSQL) |
| Base de données PostgreSQL | Critique | 60 s | 27,3 s en moyenne (24 à 32 s) | 0 (volume persistant) |
| Supervision et alertes | Importante | 5 min | n/a | 15 jours de métriques |
| Assistant opérateur | Secondaire | 30 min | n/a | n/a (index reconstruit au démarrage) |

Coût d'arrêt estimé pour le métier : chaque minute d'indisponibilité retarde les paiements des partenaires ; d'où une reprise automatique plutôt qu'une astreinte humaine.

## Plan de continuité d'activité (PCA)

- **Redémarrage supervisé** : healthchecks toutes les 3 s sur l'API, 5 s sur PostgreSQL.
- **Données** : volume `postgres-data` persistant ; une panne de conteneur ne perd aucune transaction validée.
- **Détection** : Prometheus scrape toutes les 5 s ; alertes `PaymentApiDown` et `PaymentDatabaseDown` après 5 s.
- **Observabilité** : Grafana et Loki conservent métriques et journaux pour l'analyse après incident.
- **Dégradation maîtrisée** : pendant une panne, le dashboard affiche l'état réel, désactive le paiement et journalise la reprise.

## Plan de reprise d'activité (PRA)

| Scénario couvert | Déclencheur | Action automatique | Preuve de reprise |
|---|---|---|---|
| Arrêt ou crash du conteneur API | `PaymentApiDown` | Ansible redémarre l'API, attend `healthy` | `/health` ok avec `database: ok`, nouvelle transaction acceptée |
| Arrêt ou crash de PostgreSQL | `PaymentDatabaseDown` | Ansible répare PostgreSQL puis l'API | Transactions précédentes relues, nouvelle transaction acceptée |
| Anomalie ou attaque applicative | Alertes de sécurité | Aucune (volontaire) | Analyse opérateur, voir runbook |

Responsabilités :

| Rôle | Responsabilité |
|---|---|
| Remediator (automate) | Exécuter la réparation des deux conteneurs du périmètre |
| Opérateur | Vérifier la reprise, analyser les alertes de sécurité, décider du blocage d'une source |
| Responsable plateforme | Maintenir playbooks, seuils d'alerte et runbook ; revue après chaque incident |

### Procédure de rétablissement manuel (si l'automate échoue)

1. `docker compose ps` pour identifier le service défaillant.
2. `docker compose logs remediator` pour lire la sortie Ansible.
3. `docker compose up -d` pour relancer la pile.
4. Vérifier `/health`, puis un paiement de contrôle.

### Restauration

- Données : volume `postgres-data`. Une sauvegarde logique se réalise avec `docker exec resilience-postgres pg_dump -U resilience resilience > sauvegarde.sql` ; restauration par `psql`.
- Réinitialisation complète du laboratoire : `docker compose down -v` (supprime les données).

## Risques subsistant après la reprise

- Point de défaillance unique : une seule machine hôte ; en production, réplication et bascule entre sites.
- Vault en mode développement : secrets réinjectés à chaque démarrage ; en production, stockage persistant et descellement automatisé.
- Une attaque qui persiste après redémarrage n'est pas neutralisée par la remédiation de disponibilité.
- Pas de sauvegarde automatisée ni de test de restauration régulier.
