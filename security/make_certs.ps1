<#
.SYNOPSIS
  Génère un certificat local de confiance (mkcert) pour servir le dashboard en HTTPS et activer Face ID entre postes.

.DESCRIPTION
  WebAuthn exige HTTPS et un NOM d'hôte : un RP ID ne peut pas être une adresse IP.
  Utiliser le nom du PC Hôte suivi de .local (résolution mDNS, compatible iPhone et Windows), par exemple DESKTOP-ABC123.local.

.EXAMPLE
  .\security\make_certs.ps1 -HostName DESKTOP-ABC123.local
#>
param([Parameter(Mandatory = $true)][string]$HostName)

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  Write-Error "mkcert est introuvable. Installer avec : winget install FiloSottile.mkcert"
  exit 1
}

$certs = Join-Path (Split-Path -Parent $PSScriptRoot) 'certs'
New-Item -ItemType Directory -Force $certs | Out-Null
mkcert -install
mkcert -cert-file (Join-Path $certs 'lab.pem') -key-file (Join-Path $certs 'lab-key.pem') $HostName localhost 127.0.0.1

Write-Host ''
Write-Host "Certificat genere dans $certs (ignore par Git)."
Write-Host 'Etapes suivantes :'
Write-Host "  1. Dans .env : WEBAUTHN_RP_ID=$HostName"
Write-Host "                 WEBAUTHN_ORIGIN=https://${HostName}:8443"
Write-Host "                 VITE_API_URL=https://${HostName}:3443"
Write-Host '  2. docker compose --profile https up -d --build'
Write-Host "  3. Ouvrir https://${HostName}:8443 ; sur un iPhone, installer et approuver l'autorite : mkcert -CAROOT (fichier rootCA.pem)."
