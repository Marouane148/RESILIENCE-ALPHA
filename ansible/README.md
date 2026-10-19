# Remédiation automatique du paiement

Ce playbook surveille l'état des conteneurs Docker du service `payment-api` et applique une remédiation sans intervention humaine :

- découverte via l'API Docker locale (`/var/run/docker.sock`) ;
- identification des répliques arrêtées, absentes ou dont le healthcheck n'est pas `healthy` ;
- conservation des répliques saines lorsqu'elles existent ;
- redémarrage automatique des répliques anormales ;
- attente du retour à l'état `healthy`, avec échec explicite si le service ne revient pas.

## Prérequis

- Docker démarré et stack Resilience-Alpha lancée depuis la racine du projet ;
- Ansible installé ;
- collection `community.docker` installée ;
- utilisateur courant autorisé à accéder au socket Docker local.

Installer la collection :

```bash
ansible-galaxy collection install -r ansible/requirements.yml
```

## Exécution

Depuis la racine `RESILIENCE-ALPHA` :

```bash
ansible-playbook -i localhost, ansible/remediate_payment.yml
```

Le playbook utilise `DOCKER_HOST` s'il est défini. Pour cibler explicitement un autre endpoint Docker :

```bash
DOCKER_HOST=unix:///var/run/docker.sock \\
  ansible-playbook -i localhost, ansible/remediate_payment.yml
```

L'API Docker doit exposer le label Compose `com.docker.compose.service=payment-api`, fourni automatiquement par le `docker-compose.yml` du projet.

## Intégration avec une alerte

Le playbook peut être appelé par Alertmanager, un ordonnanceur ou un pipeline CI lorsqu'une alerte Prometheus/Loki signale l'indisponibilité du paiement. Il est volontairement idempotent : une exécution sur une réplique déjà saine ne redémarre rien.

Pour effectuer uniquement le contrôle Ansible sans action distante :

```bash
ansible-playbook --check -i localhost, ansible/remediate_payment.yml
```

## Déclenchement automatique

Prometheus envoie l'alerte `PaymentInvalidRequestBurst` à Alertmanager. Alertmanager appelle ensuite le service `remediator`, qui exécute automatiquement `remediate_payment.yml` via l'API Docker locale.

Le remediator est volontairement limité au label Compose `payment-api` ; il ne peut pas redémarrer un autre service avec ce playbook.
