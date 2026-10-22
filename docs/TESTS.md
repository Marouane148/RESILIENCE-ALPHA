# Résultats des essais - Resilience-Alpha

Essais réalisés le 22 octobre 2026 sur le PC Hôte (Windows 11, Docker Desktop, 8 cœurs, 16 Go de RAM partagés avec le poste de travail). Aucune donnée réelle. Les essais sont reproductibles.

## 1. Tests automatisés (33 tests)

| Suite | Commande | Tests | Couverture |
|---|---|---|---|
| Backend | `cd backend && npm test` | 12 | Passkey WebAuthn : enrôlement, connexion, session falsifiée, rejeu de challenge, vérification utilisateur absente, compteur non croissant ; chargement des secrets Vault |
| Détecteur ML | `cd ai-detector && python -m unittest discover -s tests -v` | 9 | Lecture des compteurs, remise à zéro après redémarrage, rafale détectée, absence de contamination par une attaque, ré-entraînement borné |
| Remediator | `python -m unittest discover -s ansible/tests -v` | 6 | Contrôle du jeton, mise en file d'une alerte pendant une exécution, relance après échec, limite de tentatives |
| Assistant | `python -m unittest discover -s assistant/tests -v` | 6 | Refus des demandes d'action, filtrage hors sujet, modèle sous 8 milliards de paramètres |

Ces suites sont exécutées par la CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)), avec le build du frontend et la validation du compose.

## 2. Recette de bout en bout : 26 contrôles, 0 échec

Commande : `.\security\e2e_test.ps1` (3 essais par panne, retour au calme attendu entre chaque essai).

| Contrôle | Résultat |
|---|---|
| API et base de données opérationnelles | PASS |
| Route métier sans jeton refusée (401) | PASS |
| Enrôlement sans jeton refusé (401) | PASS |
| Paiement valide accepté (201) | PASS |
| Paiement invalide refusé (400) | PASS |
| Injection SQL bloquée par le WAF (403) | PASS |
| Injection de script bloquée par le WAF (403) | PASS |
| Métriques : jauge base de données et événements d'authentification | PASS |
| Remediator refuse un appel sans jeton (401) | PASS |
| Aucun secret applicatif dans l'environnement de l'API | PASS |
| API en système de fichiers lecture seule | PASS |
| API sans capacité Linux (`cap_drop: ALL`) | PASS |
| Remediator sans socket Docker monté | PASS |
| Remediator : `exec` Docker refusé par le proxy | PASS |
| PostgreSQL, Vault, Loki, assistant, remediator non exposés | PASS |
| Cinq règles d'alerte chargées dans Prometheus | PASS |
| Jeton absent des journaux du WAF | PASS |
| Assistant : index documentaire prêt | PASS |
| Assistant : appel sans jeton refusé (401) | PASS |
| Assistant : refuse d'exécuter une action | PASS |
| Assistant : refuse une question hors sujet | PASS |
| Reprise autonome après arrêt de l'API | PASS : 33, 28, 25 s (moyenne 28,7 s) |
| Nouvelle transaction acceptée après la reprise de l'API | PASS |
| Reprise autonome après arrêt de PostgreSQL | PASS : 24, 26, 32 s (moyenne 27,3 s) |
| Transactions conservées après les pannes de base | PASS |
| Nouvelle transaction acceptée après la reprise de la base | PASS |

### Décomposition d'une reprise (environ 28 s)

| Étape | Durée approximative |
|---|---|
| Scrape Prometheus (5 s) et évaluation de la règle | jusqu'à 5 à 10 s |
| Condition `for` de l'alerte | 5 s |
| Alertmanager (`group_wait` 1 s) et appel du remediator | 1 s |
| Redémarrage du conteneur et passage à `healthy` | 5 à 10 s |
| Vérification de `/health` avec `database: ok` | 1 à 3 s |

## 3. Parcours Face ID de bout en bout (navigateur piloté)

Chrome avec un authentificateur de plateforme virtuel (vérification utilisateur activée), à travers le WAF : 8 contrôles sur 8 réussis.

| Contrôle | Résultat |
|---|---|
| Écran de connexion affiché | PASS |
| Enrôlement de la passkey puis arrivée sur le dashboard | PASS |
| Credential enregistré avec clé résidente | PASS |
| Paiement depuis l'interface accepté | PASS |
| Déconnexion puis retour à l'écran de connexion | PASS |
| Connexion par passkey | PASS |
| Compteur de signature incrémenté (1 puis 2) | PASS |
| Aucune requête bloquée à tort par le WAF (403) | PASS |

Cet essai n'a pas été réalisé avec un iPhone ou un Mac réels : il valide le protocole et l'intégration, pas la biométrie matérielle. Le profil HTTPS ([HTTPS-FACE-ID.md](HTTPS-FACE-ID.md)) n'a pas été testé de bout en bout.

## 4. Scénarios d'attaque

| Scénario | Résultat observé |
|---|---|
| Rafale de requêtes invalides (40 s, 8 workers) | Taux de rejets d'environ 13 par seconde ; `PaymentInvalidRequestBurst` et `PaymentMlAnomalyDetected` actives ; aucun redémarrage déclenché |
| Injections SQL, script et traversée de chemin | Réponse 403 du WAF, journal ModSecurity visible dans le dashboard SOC |
| 12 connexions biométriques invalides | `PaymentBiometricAuthFailures` active ; 290 échecs d'authentification cumulés sur le dashboard |

## 4 bis. Essai à deux postes (PC Hôte Windows + Mac attaquant)

Réalisé le 22 octobre 2026. PC Hôte sur `192.168.137.1` (point d'accès mobile Windows, pare-feu ouvert pour `192.168.137.0/24`), Mac attaquant sur `192.168.137.23`, même réseau privé, hors réseau du campus.

| Étape | Résultat observé |
|---|---|
| Connectivité depuis le Mac | `/health` répond `ok` avec `database: ok` à travers le WAF |
| Rafale de requêtes invalides depuis le Mac (45 s, 12 requêtes parallèles) | Rejets jusqu'à environ 50 par seconde ; anomalie ML à 1 ; `PaymentInvalidRequestBurst` et `PaymentMlAnomalyDetected` en `firing` ; API restée disponible ; aucune alerte de disponibilité, aucun redémarrage |
| Retour au calme | Alertes de sécurité repassées à `inactive`, anomalie ML revenue à 0 |
| Panne de l'API vue depuis le Mac (boucle `curl` à 1 s) | `ok` à 17:55:05, `INDISPONIBLE` dès 17:55:06, puis retour à `ok` sans intervention |
| Durée d'indisponibilité mesurée par Prometheus (`up == 0`) | Panne 1 : environ 24 s (17:53:48 à 17:54:07) ; panne 2 : environ 29 s (17:55:08 à 17:55:32) |
| Remédiation | `{"event": "remediation", "returncode": 0}` pour chacune |
| Preuve métier | Paiement `test-apres-reprise` (5,00 €) accepté depuis le dashboard après la reprise ; transactions antérieures conservées |

Ces mesures confirment les chiffres de la recette automatisée (24 à 33 s) depuis un second poste.

## 5. Défauts découverts et corrigés pendant les essais

| Défaut | Effet | Correction |
|---|---|---|
| `/health` bloqué quand la base est arrêtée (aucun délai sur le pool) | Vérification de reprise bloquée jusqu'à 30 s par essai | Délais de connexion et de requête de 2 à 3 s |
| Alerte reçue pendant une exécution ignorée | Reprise retardée jusqu'à 90 s en cas de pannes enchaînées | Mise en file et relance immédiate ; relance automatique après un échec |
| Conteneur en démarrage jugé « à réparer » | Double redémarrage, reprise repoussée | Un conteneur en `starting` est attendu, jamais redémarré |
| Attente de santé non interruptible | Panne suivante détectée tardivement | L'attente s'interrompt si le conteneur cesse de tourner |
| API ignorant `SIGTERM` | 10 s perdues à chaque redémarrage | Arrêt propre |
| Module Ansible inspectant les images (refusé par le proxy) | Réparation impossible | `docker restart` (droits sur les conteneurs seulement) |
| WAF résolvant l'adresse de l'API une seule fois | Trafic perdu si l'API change d'adresse | Résolution dynamique par le résolveur Docker |
| Promtail refusé par le proxy en lecture seule | Plus aucun journal dans Loki | Autorisation de `GET /networks` en lecture seule |
| Journal d'audit du WAF contenant `Authorization` | Jeton en clair dans Loki et Grafana | Parties d'audit sans en-têtes de requête ; volume Loki purgé |
| Détecteur ML : faux positifs au calme (verdict à 1 une dizaine de fois en 10 minutes avec 0 rejet par seconde) | Alerte `PaymentMlAnomalyDetected` possible sans attaque, gênante en démonstration | Garde de magnitude : verdict retenu seulement si l'observation dépasse le profil nominal ; 0 faux positif sur 24 échantillons, rafale toujours détectée en moins de 4 s |
| Assistant répondant hors sujet et affirmant exécuter une commande | Réponses trompeuses | Refus déterministe des actions, seuil de pertinence combiné à un critère de domaine |
| Retour au mode « enrôlement » après déconnexion | Parcours de connexion cassé | Réinitialisation du mode |

## 6. Limites connues des essais

- **Pannes enchaînées sans retour au calme** : si une deuxième panne survient moins d'une minute après la première, la reprise peut dépasser 60 s avant la ré-évaluation. La recette mesure donc chaque panne après retour au calme.
- **Assistant** : sur ce poste, le modèle de 1,5 milliard de paramètres répond en environ 35 s après préchauffage (premier chargement : plus d'une minute). Un modèle de 3 milliards de paramètres a été écarté : 0,3 token par seconde, la RAM libre de l'hôte étant inférieure à 1 Go.
- **Détecteur ML** : validé sur des rafales de rejets ; une attaque lente à faible débit n'est pas détectée.
- **Réseau** : validé avec un Mac attaquant (section 4 bis). L'attaque a été lancée avec le script bash `controlled_payment_burst.sh` ; le script PowerShell `attack_from_attacker_pc.ps1` n'a pas été exécuté depuis un second PC Windows.
- **Mesure vue du Mac** : l'heure exacte du premier `ok` après la panne n'a pas été relevée côté Mac ; la durée provient de Prometheus (échantillonnage de 5 s, donc précision d'environ 5 s).
