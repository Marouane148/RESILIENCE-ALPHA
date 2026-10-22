<#
.SYNOPSIS
  Vérifie en une commande que la plateforme est prête pour enregistrer le Clip Chrono (PC Hôte).

.DESCRIPTION
  Contrôle l'état des services, l'API, l'absence d'alerte, le silence du remediator, le calme du détecteur ML
  et le réseau du point d'accès. Affiche PRET A ENREGISTRER ou la liste de ce qui bloque.
  -Cleanup supprime d'abord les paiements de démonstration (destinataire demo-chrono).

.EXAMPLE
  .\security\pre_clip_check.ps1
  .\security\pre_clip_check.ps1 -Cleanup
#>
param(
  [string]$HotspotIp = '192.168.137.1',
  [int]$QuietSeconds = 120,
  [switch]$Cleanup
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$results = New-Object System.Collections.Generic.List[object]

function Check($Name, $Ok, $Detail = '') {
  $results.Add([pscustomobject]@{ Controle = $Name; Etat = $(if ($Ok) { 'OK' } else { 'BLOQUANT' }); Detail = $Detail })
}

if ($Cleanup) {
  docker exec resilience-postgres psql -U resilience -d resilience -q -c "DELETE FROM payments WHERE recipient = 'demo-chrono'" 2>$null | Out-Null
  Write-Host 'Paiements demo-chrono supprimes.'
}

# Services
$services = @(docker compose ps -a --format '{{.Name}}|{{.Status}}')
$bad = @($services | Where-Object { $_ -match 'unhealthy|Exited \((?!0)|Restarting|Created' -and $_ -notmatch 'init' })
$running = @($services | Where-Object { $_ -match '\|Up' }).Count
Check 'Services demarres et sains' ($bad.Count -eq 0 -and $running -ge 14) "$running en marche ; problemes : $($bad -join ', ')"

# API
$health = try { Invoke-RestMethod 'http://localhost:3000/health' -TimeoutSec 3 } catch { $null }
Check 'API et base de donnees ok' ($health -and $health.status -eq 'ok' -and $health.database -eq 'ok')

# Alertes
$alerts = try { @((Invoke-RestMethod 'http://localhost:9090/api/v1/alerts').data.alerts | Where-Object { $_.state -ne 'inactive' }) } catch { @('prometheus injoignable') }
Check 'Aucune alerte active ou en attente' ($alerts.Count -eq 0) $(if ($alerts.Count) { ($alerts | ForEach-Object { if ($_.labels) { "$($_.labels.alertname):$($_.state)" } else { $_ } }) -join ', ' } else { '' })

# Remediator silencieux
$remLines = @(docker logs resilience-remediator --since "${QuietSeconds}s" 2>&1).Count
Check "Remediator silencieux depuis $QuietSeconds s" ($remLines -eq 0) "$remLines ligne(s) recente(s)"

# ML calme
$mlMetrics = docker exec resilience-anomaly-detector python -c "import urllib.request;print('\n'.join(l for l in urllib.request.urlopen('http://localhost:8000/metrics').read().decode().splitlines() if l.startswith('resilience_')))" 2>$null
$detected = (($mlMetrics | Where-Object { $_ -like 'resilience_anomaly_detected*' }) -split ' ')[1]
$targetUp = (($mlMetrics | Where-Object { $_ -like 'resilience_detector_target_up*' }) -split ' ')[1]
Check 'Detecteur ML connecte et a 0' ($detected -eq '0.0' -and $targetUp -eq '1.0') "verdict=$detected cible=$targetUp"
$end = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$hist = try { @((Invoke-RestMethod "http://localhost:9090/api/v1/query_range?query=resilience_anomaly_detected&start=$($end - $QuietSeconds)&end=$end&step=10").data.result[0].values | Where-Object { $_[1] -ne '0' }) } catch { @() }
Check "ML sans verdict a 1 depuis $QuietSeconds s" ($hist.Count -eq 0) "$($hist.Count) point(s) a 1"

# Réseau
$ipOk = [bool](ipconfig | Select-String ([regex]::Escape($HotspotIp)))
Check "Point d'acces actif ($HotspotIp)" $ipOk
if ($ipOk) {
  $viaHotspot = try { (Invoke-RestMethod "http://${HotspotIp}:3000/health" -TimeoutSec 3).status } catch { 'injoignable' }
  Check "API joignable via $HotspotIp" ($viaHotspot -eq 'ok') $viaHotspot
}
Check 'Regle de pare-feu Resilience-Lab' ([bool](Get-NetFirewallRule -DisplayName 'Resilience-Lab' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' }))

# Interfaces
$dash = try { (Invoke-WebRequest 'http://localhost:8080' -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 0 }
$graf = try { (Invoke-WebRequest 'http://localhost:3001/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 0 }
Check 'Dashboard (8080) et Grafana (3001) accessibles' ($dash -eq 200 -and $graf -eq 200) "dashboard=$dash grafana=$graf"

# Données de démonstration
$leftover = (docker exec resilience-postgres psql -U resilience -d resilience -t -A -c "SELECT count(*) FROM payments WHERE recipient = 'demo-chrono'" 2>$null)
Check 'Aucun paiement demo-chrono restant' ($leftover -eq '0') "restants=$leftover (utiliser -Cleanup)"

$results | Format-Table -AutoSize -Wrap
$blocking = @($results | Where-Object { $_.Etat -eq 'BLOQUANT' }).Count
if ($blocking -eq 0) {
  Write-Host 'PRET A ENREGISTRER' -ForegroundColor Green
  Write-Host 'Rappels manuels : F5 sur le dashboard, reconnexion Face ID (session de 15 min), champs demo-chrono / 5 remplis, Grafana en Last 5 minutes + 5s, commandes pretes sans Entree.'
} else {
  Write-Host "NON PRET : $blocking point(s) bloquant(s). Attendre 2 minutes de calme puis relancer." -ForegroundColor Red
}
exit $(if ($blocking -gt 0) { 1 } else { 0 })
