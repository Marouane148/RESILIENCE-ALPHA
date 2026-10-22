# Remédiation automatique

Le remediator reçoit les alertes de **disponibilité** d'Alertmanager et exécute le playbook Ansible [remediate_payment.yml](remediate_payment.yml). Aucune intervention humaine n'est nécessaire.

## Chaîne de reprise

`Panne → Prometheus (scrape 5 s) → alerte (5 s) → Alertmanager → remediator → Ansible → healthcheck → /health ok`

1. Alertmanager route uniquement les alertes de catégorie `availability` (`PaymentApiDown`, `PaymentDatabaseDown`) vers le remediator, avec un jeton Bearer. Les alertes de sécurité ne déclenchent aucune action.
2. Le remediator vérifie le jeton (sinon `401`), répond `202` immédiatement puis lance le playbook en arrière-plan. Un verrou garantit un seul playbook à la fois ; les notifications répétées sont ignorées (`remediation_skipped`).
3. Le playbook répare dans l'ordre de dépendance : `resilience-postgres`, puis `resilience-payment-api`. Pour chaque conteneur ([repair_container.yml](repair_container.yml)) : inspection via l'API Docker, redémarrage si arrêté ou non `healthy`, attente de l'état `healthy`.
4. Vérification métier : `GET http://payment-api:3000/health` doit répondre 200 avec `database: ok`. Sinon le playbook échoue (`returncode` différent de 0, sortie dans les logs).

Les conteneurs déjà sains sont laissés intacts. La reprise mesurée est d'environ 30 secondes pour l'API.

## Périmètre et privilèges

- Seuls deux conteneurs sont ciblés, nommés explicitement dans le playbook.
- Le remediator n'a **pas** le socket Docker : il utilise `DOCKER_HOST=tcp://docker-proxy-ctl:2375`, un proxy qui n'autorise que les appels sur les conteneurs (inspection, démarrage, redémarrage). `exec`, images, volumes, réseaux, services et suppression sont refusés.
- Le port du remediator (8081) n'est pas publié, et son accès exige `REMEDIATOR_TOKEN`.
- Limite : le proxy ne filtre pas le contenu des requêtes ; une requête de création de conteneur reste possible. En production, utiliser un proxy filtrant ou un orchestrateur avec RBAC.

## Exécution manuelle

Depuis la racine du projet, avec Ansible et la collection Docker installés :

```bash
ansible-galaxy collection install -r ansible/requirements.yml
ansible-playbook -i localhost, ansible/remediate_payment.yml
```

Dans la plateforme, le playbook s'exécute dans le conteneur `resilience-remediator` ; pour le lancer à la main :

```bash
docker exec resilience-remediator ansible-playbook -i localhost, /workspace/ansible/remediate_payment.yml
```

## Vérifier

```bash
docker stop resilience-payment-api        # ou resilience-postgres
docker compose logs -f remediator         # {"event": "remediation", "returncode": 0}
curl http://localhost:3000/health         # {"status":"ok","database":"ok"}
```

Un appel sans jeton est refusé :

```bash
docker exec resilience-payment-api wget -S -O- --post-data='{}' http://remediator:8081/   # HTTP 401
```
