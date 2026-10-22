# Clip Chrono - scénario de 60 secondes

Livrable : `Workshop2026-M2-G<n>-VidChrono.mp4`, 60 secondes maximum, **sans coupe** : une séquence continue avec lancement de l'attaque depuis le PC Attaquant, apparition de l'anomalie, réaction du système et vérification du service rétabli. Des titres et sous-titres peuvent être ajoutés.

La vidéo ne se génère pas automatiquement : elle doit être filmée sur les vrais postes. Ce document fournit le déroulé, la préparation et la liste de contrôle.

## Préparation (avant d'enregistrer)

1. PC Hôte : plateforme démarrée (`docker compose ps` tout `healthy`), connecté au dashboard par Face ID, Grafana ouvert sur « Resilience Alpha - Incident & Recovery », période 15 minutes, actualisation 5 s.
2. Disposition d'écran du PC Hôte, côte à côte : à gauche le dashboard de paiement (http://localhost:8080), à droite Grafana. Un terminal `docker compose logs -f remediator` réduit en bas.
3. PC Attaquant : fenêtre PowerShell prête avec la commande d'attaque saisie, sans l'avoir lancée.
4. Enregistrement : OBS Studio (une seule scène, capture de la fenêtre ou de l'écran) ou capture d'écran Windows (Win+Maj+S, mode vidéo). Résolution 1920x1080, 30 images/s.
5. Faire une répétition complète pour caler le chronomètre ; la reprise dure environ 30 secondes.

## Déroulé minuté

| Temps | Action filmée | Titre à afficher |
|---|---|---|
| 0:00 - 0:05 | Dashboard : API disponible, journal vide, Grafana à 1 et anomalie ML à 0 | « État nominal » |
| 0:05 - 0:10 | PC Attaquant : lancement du scénario `burst` (`attack_from_attacker_pc.ps1 -HostIp 192.168.137.1 -Scenario burst -Count 1000`) | « Attaque depuis le PC Attaquant » |
| 0:10 - 0:20 | Grafana : le taux de rejets monte, l'anomalie ML passe à 1 ; alerte visible dans Alertmanager | « Anomalie détectée par le modèle ML » |
| 0:20 - 0:25 | Panne contrôlée : `docker stop resilience-payment-api` ; le dashboard affiche « API indisponible » et le panneau Grafana passe à 0 | « Panne injectée » |
| 0:25 - 0:50 | Sans intervention : le remediator affiche `returncode: 0`, l'API revient à 1, le dashboard affiche « Service rétabli, reprise automatique en N s » | « Remédiation autonome » |
| 0:50 - 0:60 | Nouveau paiement depuis le dashboard : transaction acceptée et visible dans la liste | « Service rétabli : transaction acceptée » |

Si 30 secondes de reprise ne tiennent pas dans la fenêtre, accélérer l'attaque (réduire la phase 0:05-0:20) plutôt que de couper la vidéo.

## Liste de contrôle avant remise

- [ ] Aucune coupe ni action manuelle masquée entre l'attaque et la vérification.
- [ ] L'attaque part visiblement du PC Attaquant (fenêtre et adresse IP lisibles).
- [ ] Les trois états sont lisibles : avant, pendant, après.
- [ ] Le résultat final est une transaction acceptée, pas seulement un conteneur relancé.
- [ ] Durée inférieure ou égale à 60 secondes ; format MP4.
- [ ] Aucun secret visible à l'écran (`.env`, jeton, mot de passe Grafana).
