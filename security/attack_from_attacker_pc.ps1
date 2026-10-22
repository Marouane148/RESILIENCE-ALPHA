<#
.SYNOPSIS
  Scénarios d'attaque contrôlés, à lancer depuis le PC Attaquant contre l'API fictive du PC Hôte.

.DESCRIPTION
  Périmètre strictement limité : le script refuse toute adresse qui n'est pas privée (10.x, 172.16-31.x, 192.168.x).
  Ne jamais viser le réseau du campus, d'un autre groupe ou un service tiers.

  Scénarios :
    burst      Rafale de paiements invalides (déni de service applicatif)  -> PaymentInvalidRequestBurst / anomalie ML
    injection  Charges d'injection SQL et de script                          -> bloquées par le WAF (403), visibles dans le dashboard SOC
    auth       Tentatives de connexion biométrique invalides                 -> PaymentBiometricAuthFailures
    all        Les trois scénarios à la suite

.EXAMPLE
  .\attack_from_attacker_pc.ps1 -HostIp 192.168.137.1 -Scenario burst -Count 1000
#>
param(
  [Parameter(Mandatory = $true)][string]$HostIp,
  [ValidateSet('burst', 'injection', 'auth', 'all')][string]$Scenario = 'burst',
  [int]$Count = 600,
  [int]$Port = 3000
)

$privatePattern = '^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$'
if ($HostIp -notmatch $privatePattern) {
  Write-Error "Refus : $HostIp n'est pas une adresse privee. Le test doit rester sur le reseau prive du groupe."
  exit 2
}
if ($Count -lt 1 -or $Count -gt 5000) {
  Write-Error 'Count doit etre compris entre 1 et 5000.'
  exit 2
}

$base = "http://${HostIp}:${Port}"

function Send-Request($Path, $Body) {
  try {
    $response = Invoke-WebRequest -Uri "$base$Path" -Method POST -ContentType 'application/json' -Body $Body -TimeoutSec 3 -UseBasicParsing
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Show-Summary($Name, $Codes) {
  Write-Host "== $Name : $($Codes.Count) requetes"
  $Codes | Group-Object | Sort-Object Name | ForEach-Object { Write-Host ("   HTTP {0} : {1}" -f $_.Name, $_.Count) }
}

Write-Host "Cible du laboratoire : $base"
$health = try { (Invoke-RestMethod "$base/health" -TimeoutSec 3).status } catch { 'injoignable' }
Write-Host "Etat avant attaque   : $health"

if ($Scenario -in 'burst', 'all') {
  $codes = 1..$Count | ForEach-Object { Send-Request '/payments' '{"recipient":"lab-attack","amount":0}' }
  Show-Summary 'Rafale de paiements invalides (401 sans jeton, 400 invalide)' $codes
}

if ($Scenario -in 'injection', 'all') {
  $payloads = @(
    '{"recipient":"x'' OR ''1''=''1","amount":1}',
    '{"recipient":"1; DROP TABLE payments;--","amount":1}',
    '{"recipient":"<script>alert(1)</script>","amount":1}',
    '{"recipient":"../../etc/passwd","amount":1}'
  )
  $codes = $payloads | ForEach-Object { Send-Request '/payments' $_ }
  Show-Summary 'Injections SQL/script (403 = bloque par le WAF)' $codes
}

if ($Scenario -in 'auth', 'all') {
  $codes = 1..12 | ForEach-Object { Send-Request '/auth/login/verify' '{"challengeId":"inconnu","response":{"id":"fausse-cle"}}' }
  Show-Summary 'Connexions biometriques invalides (401 attendu)' $codes
}

$health = try { (Invoke-RestMethod "$base/health" -TimeoutSec 3).status } catch { 'injoignable' }
Write-Host "Etat apres attaque   : $health"
Write-Host 'Observer : Grafana (dashboards Incident & Recovery et SOC), Prometheus /alerts, Alertmanager.'
