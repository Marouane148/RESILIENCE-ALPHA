# HTTPS et Face ID entre postes

Face ID, Touch ID et Windows Hello passent par WebAuthn, qui n'est disponible qu'en **contexte sécurisé** : HTTPS ou `localhost`. Depuis un autre PC ou un iPhone, il faut donc HTTPS, avec un certificat approuvé par l'appareil, et un **nom d'hôte** (le RP ID ne peut pas être une adresse IP).

## Mise en place

1. Installer mkcert sur le PC Hôte : `winget install FiloSottile.mkcert`.
2. Choisir le nom d'hôte. Le plus simple est le nom du PC suivi de `.local` (résolution mDNS prise en charge par Windows et iOS), par exemple `DESKTOP-ABC123.local`.
3. Générer le certificat :
   ```powershell
   .\security\make_certs.ps1 -HostName DESKTOP-ABC123.local
   ```
   Les fichiers sont créés dans `certs/` (ignoré par Git).
4. Dans `.env` :
   ```
   WEBAUTHN_RP_ID=DESKTOP-ABC123.local
   WEBAUTHN_ORIGIN=https://DESKTOP-ABC123.local:8443
   VITE_API_URL=https://DESKTOP-ABC123.local:3443
   ```
5. Démarrer avec le profil HTTPS :
   ```powershell
   docker compose --profile https up -d --build
   ```
6. Ouvrir `https://DESKTOP-ABC123.local:8443`. Autoriser les ports 8443 et 3443 dans le pare-feu du PC Hôte pour le réseau du groupe uniquement.

## Approuver l'autorité sur un iPhone

1. Sur le PC Hôte, `mkcert -CAROOT` affiche le dossier contenant `rootCA.pem`. Envoyer ce fichier à l'iPhone (AirDrop, e-mail).
2. Réglages > Général > VPN et gestion de l'appareil : installer le profil.
3. Réglages > Général > Informations > Réglages des certificats : activer la confiance totale pour l'autorité.

Il faut enrôler la passkey **depuis cette origine HTTPS** : une passkey enregistrée en `localhost` n'est pas valable pour un autre nom d'hôte.

## Limites

Le certificat est local : à ne pas utiliser hors laboratoire. Si le nom d'hôte change, les passkeys doivent être réenrôlées.
