# Guide de démonstration de A à Z - Resilience-Alpha

Ce guide sert à **tester**, **répéter** et **expliquer** la démonstration. Pour chaque étape : ce qu'on fait, ce qu'on doit voir, et ce qu'on dit au jury.

Format du jury local : 10 minutes par équipe, dont **5 minutes de présentation et démonstration** puis 5 minutes de questions. Point décisif : si la reprise n'est pas automatique pendant le direct, l'axe « remédiation » vaut 0 sur 5.

## Partie 1 - Préparation (la veille, puis 15 minutes avant)

### 1.1 Matériel et réseau

| Poste | Rôle | À vérifier |
|---|---|---|
| PC Hôte | Exécute Docker Desktop et toute la plateforme | Docker Desktop démarré, `Engine running`, 16 Go de RAM dont au moins 6 Go libres (fermer les navigateurs et applications inutiles) |
| PC Attaquant | Lance l'attaque | Connecté au **point d'accès mobile du PC Hôte** (jamais le Wi-Fi du campus), PowerShell disponible |

Sur le PC Hôte, activer le point d'accès mobile (Paramètres, Réseau et Internet, Point d'accès sans fil mobile), relever l'adresse (en général `192.168.137.1`) avec `ipconfig`, puis autoriser les ports pour ce réseau uniquement, dans un PowerShell administrateur :

```powershell
New-NetFirewallRule -DisplayName "Resilience-Lab" -Direction Inbound -Protocol TCP -LocalPort 8080,3000,9090,3001,9093 -RemoteAddress 192.168.137.0/24 -Action Allow -Profile Any
```

### 1.2 Démarrage de la plateforme

```powershell
cd C:\RESILIENCE-ALPHA
docker compose up -d
docker compose ps
```

Attendre que les 16 services soient `healthy` ou `running` (environ 1 à 2 minutes).

**L'assistant met plus longtemps :** il charge son modèle en mémoire après avoir construit son index. Vérifier :

```powershell
docker logs resilience-assistant --tail 5
```

Attendre la ligne `model qwen2.5:1.5b loaded`. Sans ce préchauffage, la première question prend plus d'une minute.

### 1.3 Contrôle de santé avant le passage

```powershell
curl.exe http://localhost:3000/health
.\security\e2e_test.ps1 -SkipDisruptive
```

Attendu : `{"status":"ok","service":"payment-api","database":"ok"}` puis des PASS partout (24 contrôles sans panne). La recette complète, pannes comprises, dure environ 10 minutes : la lancer la veille, pas juste avant le passage.

### 1.4 Disposition d'écran du PC Hôte

À gauche, le dashboard de paiement (http://localhost:8080), connecté avec l'identifiant et le mot de passe. À droite, Grafana (http://localhost:3001), dashboard « Resilience Alpha - Incident & Recovery », période 15 minutes, actualisation 5 s. Un terminal réduit avec `docker compose logs -f remediator`. Un deuxième onglet Grafana prêt sur « Resilience Alpha - SOC ».

Identifiants Grafana : `admin` et la valeur de `GRAFANA_ADMIN_PASSWORD` à la **première** initialisation du volume (par défaut, la valeur du modèle `.env.example`).

### 1.5 Remise à zéro entre deux répétitions

Attendre que Prometheus n'ait plus d'alerte active (http://localhost:9090/alerts), puis éventuellement supprimer les transactions de test :

```powershell
docker exec resilience-postgres psql -U resilience -d resilience -c "DELETE FROM payments WHERE recipient LIKE 'test-%'"
```

Ne jamais faire `docker compose down -v` avant le passage : cela supprime les modèles de l'assistant et les données (et les passkeys en mode `webauthn`).

---

## Partie 2 - Déroulé de la démonstration (5 minutes)

### Étape 0 - Le contexte en 20 secondes (à dire)

> « Une plateforme de paiement fictive subit des incidents que les équipes réparent à la main. Notre objectif : prouver qu'elle détecte l'anomalie, décide et se répare **sans opérateur**, puis le prouve par une nouvelle transaction acceptée. Cinq domaines : développement, infrastructure, IA, cybersécurité, gouvernance. »

### Étape 1 - État nominal et connexion (30 s)

**Faire** : montrer le dashboard de paiement connecté (connexion faite 5 minutes avant : la session dure 15 minutes). Faire un paiement (`test-nominal`, 10 €) avec le raccourci « 10,00 € ». Basculer rapidement le thème (clair, sombre, auto).

**Voir** : bandeau « API disponible » en vert, la transaction apparaît dans « Dernières transactions », la latence mesurée (quelques millisecondes), Grafana avec API à `1` et anomalie ML à `0`.

**Dire** : « L'accès se fait par passkey : Face ID, Touch ID ou Windows Hello, avec vérification utilisateur obligatoire. On ne stocke qu'une clé publique, la biométrie ne quitte jamais l'appareil. Le dashboard lit l'état réel du service toutes les 3 secondes, rien n'est simulé. »

### Étape 2 - L'attaque depuis le PC Attaquant (60 s)

**Faire** sur le PC Attaquant :

```powershell
$hostIp = "192.168.137.1"
.\security\attack_from_attacker_pc.ps1 -HostIp $hostIp -Scenario burst -Count 1000
.\security\attack_from_attacker_pc.ps1 -HostIp $hostIp -Scenario injection
```

Le PC Attaquant n'a pas besoin de la plateforme, seulement du fichier `security/attack_from_attacker_pc.ps1` (le copier par clé USB ou cloner le dépôt). Si PowerShell refuse d'exécuter le script, le lancer ainsi : `powershell -ExecutionPolicy Bypass -File .\attack_from_attacker_pc.ps1 -HostIp 192.168.137.1 -Scenario burst -Count 1000`.

**Voir** (Grafana, PC Hôte) :
- le panneau « Requêtes rejetées / seconde » monte ;
- l'anomalie ML passe à `1` en moins de 10 secondes ;
- dans Prometheus (`/alerts`) : `PaymentInvalidRequestBurst` et `PaymentMlAnomalyDetected` passent à `firing` ;
- dans le dashboard SOC : les blocages WAF (injections SQL, script) avec le journal ModSecurity.

**Dire** : « Trois couches : le WAF ModSecurity avec les règles OWASP bloque les injections avant l'API (réponse 403). Le modèle Isolation Forest repère la rafale sur deux signaux, le taux de requêtes et le taux de rejets. Prometheus lève les alertes. **Aucun redémarrage n'est déclenché** : relancer un service ne neutralise pas un attaquant, la réponse est humaine. C'est un choix d'architecture volontaire. »

### Étape 3 - La panne et la reprise autonome (90 s) : le moment décisif

**Faire** sur le PC Hôte :

```powershell
docker stop resilience-payment-api
```

Ne **rien** toucher ensuite. Laisser le jury regarder.

**Voir, dans l'ordre** (environ 30 secondes au total) :
1. le dashboard de paiement : bandeau rouge « Service de paiement indisponible », pastille « API indisponible », bouton de paiement désactivé, entrée « Panne détectée » dans le journal de reprise ;
2. Grafana : « API paiement disponible » passe à `0` ;
3. dans le terminal du remediator : la sortie Ansible puis `{"event": "remediation", "returncode": 0}` ;
4. le dashboard : bandeau vert « Service rétabli, reprise automatique en N s », Grafana revient à `1`.

**Dire pendant l'attente** : « Prometheus interroge l'API toutes les 5 secondes. Après 5 secondes de panne, l'alerte part chez Alertmanager, qui n'appelle le remediator que pour les alertes de **disponibilité**, avec un jeton. Le remediator lance un playbook Ansible : il inspecte les conteneurs, redémarre ce qui est arrêté, attend l'état healthy, puis vérifie que `/health` répond avec la base de données `ok`. »

**Dire à la fin** : « Un conteneur qui redémarre ne prouve rien. Preuve de reprise : un nouveau paiement. »

### Étape 4 - La preuve métier (20 s)

**Faire** : refaire un paiement (`test-apres-reprise`, 5 €).

**Voir** : « transaction enregistrée » et la ligne dans l'historique, **en plus** de celles d'avant la panne.

**Dire** : « Le service répond et aucune donnée n'a été perdue : les transactions sont dans un volume PostgreSQL persistant. RPO nul sur les transactions validées. Reprise mesurée : environ 25 secondes en moyenne sur 6 essais pour l'API (de 19 à 33 s), environ 24 secondes pour la base. »

### Étape 5 - Supervision, SOC et assistant (40 s)

**Faire** : ouvrir le dashboard SOC, puis poser une question à l'assistant dans le dashboard de paiement : « Que faire si l'alerte PaymentApiDown se déclenche ? »

**Voir** : alertes, authentification, blocages WAF, actions du remediator ; l'assistant répond en environ 35 secondes en citant ses sources (`docs/RUNBOOK-INCIDENT.md`).

**Dire** : « L'assistant est un modèle local de 1,5 milliard de paramètres avec Ollama, LangChain et une recherche documentaire. Il est en lecture seule : pas d'accès Docker ni base, aucun outil. Il explique, il n'agit pas. Il ne peut pas être confondu avec l'automate de remédiation. S'il reçoit un ordre d'action ou une question hors sujet, il refuse. »

Astuce : poser la question de l'assistant **pendant** l'étape 3 (l'attente de la reprise) pour ne pas perdre de temps ; le dashboard reste utilisable.

### Étape 6 (optionnelle) - Panne de la base

```powershell
docker stop resilience-postgres
```

Le remediator répare d'abord PostgreSQL, puis vérifie l'API. Reprise en environ 27 secondes, transactions conservées. À montrer s'il reste du temps ou si le jury le demande.

---

## Partie 3 - Tests de A à Z (pour vous entraîner et vérifier)

| Quoi | Commande | Résultat attendu |
|---|---|---|
| Tests unitaires backend | `cd backend; npm install; npm test` | 21 tests, 0 échec |
| Tests unitaires détecteur | `cd ai-detector; python -m unittest discover -s tests -v` | 9 tests |
| Tests unitaires remediator | `python -m unittest discover -s ansible/tests -v` | 6 tests |
| Tests unitaires assistant | `python -m unittest discover -s assistant/tests -v` | 6 tests |
| Recette complète | `.\security\e2e_test.ps1` | 29 contrôles, 0 échec (environ 10 minutes) |
| Recette sans panne | `.\security\e2e_test.ps1 -SkipDisruptive` | 24 contrôles |
| Parcours de connexion automatisé | voir [TESTS.md](TESTS.md) section 3 | 8 contrôles sur 8 |

Vérifications manuelles utiles pour comprendre :

```powershell
# L'API refuse sans jeton
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/payments            # 401

# Le WAF bloque une injection
$t = ((Get-Content .env | Where-Object { $_ -match '^PAYMENT_API_TOKEN=' }) -replace '^PAYMENT_API_TOKEN=','')
curl.exe -s -o NUL -w "%{http_code}" -X POST -H "Authorization: Bearer $t" -H "Content-Type: application/json" -d '{\"recipient\":\"<script>alert(1)</script>\",\"amount\":1}' http://localhost:3000/payments   # 403

# Le remediator refuse un appel sans jeton
docker exec resilience-payment-api wget -S -O- --post-data='{}' http://remediator:8081/   # HTTP 401

# Aucun secret dans l'environnement de l'API
docker inspect resilience-payment-api --format '{{range .Config.Env}}{{println .}}{{end}}'

# Le remediator n'a pas le socket Docker
docker inspect resilience-remediator --format '{{range .Mounts}}{{.Source}} {{end}}'
```

---

## Partie 4 - Si quelque chose ne va pas

| Symptôme | Cause probable | Action |
|---|---|---|
| `docker compose up` : `dockerDesktopLinuxEngine ... not found` | Docker Desktop non démarré | Lancer Docker Desktop, attendre `Engine running` |
| `required variable ... is missing` | Variable absente de `.env` | Comparer avec `.env.example` |
| L'API ne démarre pas, `auth_failed` dans ses logs | Mot de passe PostgreSQL du `.env` différent de celui de la première initialisation du volume | Remettre l'ancien mot de passe (le volume ne le relit pas) |
| Connexion impossible (mode mot de passe) | Mauvais identifiant ou mot de passe, ou source bloquée une minute après 5 échecs | Relire `DASHBOARD_USER` / `DASHBOARD_PASSWORD` dans `.env`, attendre une minute |
| Connexion Face ID impossible (mode `webauthn`) | Hors `localhost` en HTTP, ou `WEBAUTHN_ORIGIN` incorrect | Utiliser `http://localhost:8080` sur le PC Hôte |
| Enrôlement « Authentification refusée » | Code d'enrôlement incorrect | Utiliser la valeur de `PAYMENT_API_TOKEN` |
| Windows demande une clé USB | Mauvais authentificateur | Annuler, choisir Windows Hello (configurer un code PIN dans Paramètres, Comptes, Options de connexion) |
| Grafana refuse le mot de passe | Le volume a gardé le mot de passe de la première initialisation | `docker exec resilience-grafana grafana cli admin reset-admin-password <nouveau>` |
| Panneaux de logs Grafana vides | Promtail ne lit pas les conteneurs | `docker logs resilience-promtail --tail 5`, redémarrer `docker compose up -d promtail` |
| Assistant : « modèles en cours de téléchargement » | Index ou modèle pas encore prêts | Attendre `model ... loaded` dans `docker logs resilience-assistant` |
| Attaque impossible depuis le PC Attaquant | Pare-feu, mauvais réseau, VPN | Même réseau privé, règle de pare-feu, `Test-NetConnection 192.168.137.1 -Port 3000` |
| La reprise dépasse la minute | Deuxième panne pendant la première reprise | Attendre le retour au calme (plus d'alerte active) entre deux pannes |
| Tout est lent, assistant très lent | Mémoire de l'hôte saturée | Fermer navigateurs et applications, vérifier la RAM libre |

---

## Partie 5 - Questions probables du jury et réponses

**Pourquoi ne pas redémarrer automatiquement après une attaque ?**
Redémarrer rétablit la disponibilité mais ne corrige rien : l'attaquant est toujours là, et une fuite éventuelle n'est pas traitée. Nous séparons les alertes de disponibilité (réparation automatique) des alertes de sécurité (analyse humaine, SOC). Le sujet demande explicitement de ne pas les confondre.

**Comment prouvez-vous que la reprise est réelle ?**
Trois preuves : l'état `healthy` du conteneur, `/health` avec `database: ok` vérifié par le playbook lui-même, et une nouvelle transaction acceptée en direct. Les transactions d'avant la panne sont toujours présentes.

**Le remediator a de gros droits sur Docker : n'est-ce pas un risque ?**
Oui, c'est le point sensible que le sujet signale. Mesures : il n'accepte que les appels portant un jeton, il ne cible que deux conteneurs nommés, il n'a pas le socket Docker mais un proxy qui n'autorise que les appels sur les conteneurs (exec, images, volumes, réseaux et suppression refusés), et son port n'est pas publié. Limite assumée : le proxy ne filtre pas le contenu d'une requête de création de conteneur.

**Pourquoi Isolation Forest ?**
Aucune donnée d'attaque étiquetée n'existe : il faut un modèle non supervisé, léger et explicable par un score. Il utilise le taux de requêtes et de rejets, se ré-entraîne sur le trafic normal et n'apprend jamais d'une attaque. Limite : deux signaux seulement, une attaque lente n'est pas détectée.

**L'assistant peut-il être détourné pour agir sur le système ?**
Non : il n'a ni accès Docker, ni accès base, ni outil. Ses ordres d'action sont refusés de façon déterministe, les questions hors sujet aussi. Il lit des documents et produit du texte.

**Où sont les secrets ?**
Dans Vault : l'API ne reçoit qu'un token en lecture seule, aucun secret dans son environnement. Limite assumée : Vault tourne en mode développement (mémoire), sans rotation ; en production, stockage persistant, descellement et audit.

**Qu'est-ce qui ne marche pas, ou ce que vous feriez autrement ?**
Une seule machine hôte (pas de redondance), Vault de développement, WAF en paranoïa 1 sans limitation de débit par source, deux signaux pour le ML, pas de certification NIS2/DORA. En contexte industriel : réplication et bascule, Vault persistant avec rotation, orchestrateur avec contrôle d'accès, sauvegardes testées, test d'intrusion indépendant.

**Pourquoi 28 secondes de reprise ?**
Détection par Prometheus (scrape 5 s) et condition d'alerte de 5 s, appel du remediator, redémarrage du conteneur et passage à `healthy` (5 à 10 s), vérification métier. On pourrait descendre sous 20 s en réduisant les intervalles, au prix de plus de charge et de faux positifs.

**Que se passe-t-il si deux pannes arrivent ensemble ?**
Le remediator traite un playbook à la fois ; une alerte reçue pendant l'exécution est mise en file et relancée aussitôt. Cas limite connu : une deuxième panne moins d'une minute après la première peut retarder la reprise.

**Quelle part du code est générée par IA ?**
Le sujet autorise ces outils à condition de les maîtriser. Nous avons vérifié et testé : 42 tests automatisés, une recette de 26 contrôles, et des défauts réels découverts puis corrigés pendant les essais (voir TESTS.md).

---

## Partie 6 - Les chiffres à connaître

| Mesure | Valeur |
|---|---|
| Reprise après arrêt de l'API | 6 essais : de 19 à 33 s, moyenne d'environ 25 s |
| Reprise après arrêt de PostgreSQL | 6 essais : de 20 à 32 s, moyenne d'environ 24 s |
| RTO visé | 60 s |
| RPO | 0 pour les transactions validées |
| Scrape Prometheus / alerte | 5 s / 5 s |
| Session de connexion | 15 minutes |
| Tests automatisés | 30 (backend 21, détecteur 9, remediator 6, assistant 6) |
| Recette de bout en bout | 29 contrôles sur 29 |
| Parcours de connexion automatisé | 8 contrôles sur 8 |
| Rafale détectée par le ML | environ 13 rejets/s, verdict en moins de 10 s |
| Modèle de l'assistant | qwen2.5:1.5b (1,5 milliard de paramètres), réponse en environ 35 s |
| Services de la plateforme | 16 conteneurs |

## Partie 7 - Version courte pour la finale nationale (5 minutes)

Minute 1 : démarche et **introduction individuelle en anglais** de chaque membre. Minute 2 : diffusion du Clip Chrono. Minutes 3 à 5 : attaque et reprise en direct, depuis le PC Hôte diffusé sur Teams (étapes 2, 3 et 4 de ce guide). Une démonstration qui fonctionne vaut plus qu'une suite de diapositives.
