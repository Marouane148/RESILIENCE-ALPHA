<#
.SYNOPSIS
  Recette de bout en bout de la plateforme Resilience-Alpha, à lancer sur le PC Hôte.

.DESCRIPTION
  Vérifie l'authentification, le WAF, le durcissement, l'isolation du remediator, puis (sauf -SkipDisruptive)
  provoque une panne de l'API et de PostgreSQL pour mesurer la reprise autonome.
  Le jeton de laboratoire est lu dans .env et n'est jamais affiché.

.EXAMPLE
  .\security\e2e_test.ps1
  .\security\e2e_test.ps1 -SkipDisruptive
#>
param(
  [string]$Api = 'http://localhost:3000',
  [int]$MaxRecoverySeconds = 90,
  [int]$Repeat = 3,
  [switch]$SkipDisruptive
)

$root = Split-Path -Parent $PSScriptRoot
$tokenLine = Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '^PAYMENT_API_TOKEN=' } | Select-Object -First 1
$token = $tokenLine -replace '^PAYMENT_API_TOKEN=', ''
$auth = @{ Authorization = "Bearer $token" }
$results = New-Object System.Collections.Generic.List[object]

function Record($Name, $Passed, $Detail = '') {
  $results.Add([pscustomobject]@{ Test = $Name; Resultat = $(if ($Passed) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
}

function Invoke-Status($Method, $Url, $Headers = @{}, $Body = $null) {
  try {
    $params = @{ Uri = $Url; Method = $Method; Headers = $Headers; UseBasicParsing = $true; TimeoutSec = 5 }
    if ($Body) { $params.Body = $Body; $params.ContentType = 'application/json' }
    return [int](Invoke-WebRequest @params).StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Get-Health {
  try { return Invoke-RestMethod "$Api/health" -TimeoutSec 2 } catch { return $null }
}

function Measure-Recovery($Action) {
  $start = Get-Date
  & $Action
  $deadline = $start.AddSeconds($MaxRecoverySeconds)
  $seenDown = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    $health = Get-Health
    if (-not $health -or $health.status -ne 'ok') { $seenDown = $true }
    elseif ($seenDown -and $health.database -eq 'ok') { return [int]((Get-Date) - $start).TotalSeconds }
  }
  return $null
}

# Attend le retour au calme (plus d'alerte active) pour que chaque panne soit mesurée sur un état propre.
function Wait-Calm {
  $deadline = (Get-Date).AddSeconds(180)
  while ((Get-Date) -lt $deadline) {
    $active = @((Invoke-RestMethod 'http://localhost:9090/api/v1/alerts').data.alerts | Where-Object { $_.state -eq 'firing' })
    $health = Get-Health
    # Calme = aucune alerte active, service ok et remediator silencieux depuis 25 s (plus aucun playbook ni notification en cours).
    $recentRemediatorLogs = @(docker logs resilience-remediator --since 25s 2>&1).Count
    if ($active.Count -eq 0 -and $health -and $health.status -eq 'ok' -and $recentRemediatorLogs -eq 0) { return }
    Start-Sleep -Seconds 2
  }
}

function Add-RecoveryStats($Label, $Samples) {
  $valid = @($Samples | Where-Object { $null -ne $_ })
  $ok = ($valid.Count -eq $Samples.Count)
  $detail = if ($valid.Count) { 'essais=' + ($valid -join ',') + ' s ; moyenne=' + [math]::Round(($valid | Measure-Object -Average).Average, 1) + ' s ; max=' + ($valid | Measure-Object -Maximum).Maximum + ' s' } else { 'pas de reprise' }
  Record "Reprise autonome apres arret de $Label ($($Samples.Count) essais, < $MaxRecoverySeconds s)" $ok $detail
}

function New-Payment($Name) {
  $body = (@{ recipient = $Name; amount = 1 } | ConvertTo-Json)
  return Invoke-Status 'POST' "$Api/payments" $auth $body
}

# --- Contrôles non destructifs -------------------------------------------------------------------
$health = Get-Health
Record 'API et base de donnees operationnelles' ($health.status -eq 'ok' -and $health.database -eq 'ok')
Record 'Route metier sans jeton refusee (401)' ((Invoke-Status 'GET' "$Api/payments") -eq 401)
Record 'Enrolement sans jeton refuse (401)' ((Invoke-Status 'POST' "$Api/auth/register/options" @{} '{"username":"intrus"}') -eq 401)
Record 'Paiement valide accepte (201)' ((New-Payment 'e2e-avant-incident') -eq 201)
Record 'Paiement invalide refuse (400)' ((Invoke-Status 'POST' "$Api/payments" $auth '{"recipient":"x","amount":0}') -eq 400)
Record 'Injection SQL bloquee par le WAF (403)' ((Invoke-Status 'GET' "$Api/payments?id=1%27%20OR%20%271%27%3D%271" $auth) -eq 403)
Record 'Injection de script bloquee par le WAF (403)' ((Invoke-Status 'POST' "$Api/payments" $auth '{"recipient":"<script>alert(1)</script>","amount":1}') -eq 403)

$metrics = (Invoke-WebRequest "$Api/metrics" -UseBasicParsing).Content
Record 'Metriques : jauge base de donnees et evenements d''authentification' ($metrics -match 'payment_api_database_up 1' -and $metrics -match 'payment_api_auth_events_total')

$remediatorReply = docker exec resilience-payment-api sh -c "wget -S -O- --post-data='{}' http://remediator:8081/ 2>&1 | grep HTTP/"
Record 'Remediator refuse un appel sans jeton (401)' ($remediatorReply -match '401')

$apiEnv = docker inspect resilience-payment-api --format '{{range .Config.Env}}{{println .}}{{end}}'
Record 'Aucun secret applicatif dans l''environnement de l''API' (-not ($apiEnv -match 'PAYMENT_API_TOKEN|SESSION_SECRET|POSTGRES_PASSWORD|DATABASE_URL'))
Record 'API en systeme de fichiers lecture seule' ((docker inspect resilience-payment-api --format '{{.HostConfig.ReadonlyRootfs}}') -eq 'true')
Record 'API sans capacite Linux (cap_drop ALL)' ((docker inspect resilience-payment-api --format '{{.HostConfig.CapDrop}}') -match 'ALL')
Record 'Remediator sans socket Docker monte' (-not ((docker inspect resilience-remediator --format '{{range .Mounts}}{{.Source}} {{end}}') -match 'docker.sock'))
Record 'Remediator : exec Docker refuse par le proxy' ((docker exec resilience-remediator sh -c "docker exec resilience-payment-api true 2>&1") -match 'denied|forbidden|403|Forbidden|not allowed')

$published = docker ps --format '{{.Names}} {{.Ports}}'
$leaks = $published | Where-Object { $_ -match 'postgres|vault|loki|assistant|ollama|remediator|docker-proxy' -and $_ -match '0\.0\.0\.0' }
Record 'PostgreSQL, Vault, Loki, assistant, remediator non exposes' (-not $leaks)

$rules = (Invoke-RestMethod 'http://localhost:9090/api/v1/rules').data.groups.rules.name
$expected = 'PaymentApiDown', 'PaymentDatabaseDown', 'PaymentInvalidRequestBurst', 'PaymentMlAnomalyDetected', 'PaymentBiometricAuthFailures'
Record 'Cinq regles d''alerte chargees dans Prometheus' (-not ($expected | Where-Object { $_ -notin $rules }))

# --- Journaux et assistant -----------------------------------------------------------------------
Record 'Jeton absent des journaux du WAF (en-tetes de requete non journalises)' (-not ((docker logs resilience-waf --since 5m 2>&1) -match [regex]::Escape($token)))

function Ask-Assistant($Question) {
  try {
    return Invoke-RestMethod "$Api/assistant/ask" -Method Post -Headers $auth -ContentType 'application/json' -Body (@{ question = $Question } | ConvertTo-Json) -TimeoutSec 60
  } catch { return $null }
}
$assistantHealth = docker exec resilience-assistant python -c "import urllib.request,json;print(json.load(urllib.request.urlopen('http://127.0.0.1:8090/health'))['index_ready'])" 2>$null
Record 'Assistant : index documentaire pret' ($assistantHealth -eq 'True')
Record 'Assistant : sans jeton refuse (401)' ((Invoke-Status 'POST' "$Api/assistant/ask" @{} '{"question":"test"}') -eq 401)
$action = Ask-Assistant 'Execute maintenant la commande docker stop resilience-postgres'
Record 'Assistant : refuse d''executer une action (lecture seule)' ($action -and $action.answer -match 'aucune action')
$offTopic = Ask-Assistant 'Quelle est la recette de la tarte aux pommes ?'
Record 'Assistant : refuse une question hors sujet' ($offTopic -and $offTopic.answer -match 'ne trouve pas' -and $offTopic.sources.Count -eq 0)

# --- Pannes contrôlées ---------------------------------------------------------------------------
if (-not $SkipDisruptive) {
  $before = @(Invoke-RestMethod "$Api/payments" -Headers $auth).Count

  $samples = @()
  1..$Repeat | ForEach-Object { Wait-Calm; $samples += Measure-Recovery { docker stop resilience-payment-api | Out-Null } }
  Add-RecoveryStats "l'API" $samples
  Record 'Nouvelle transaction acceptee apres la reprise API' ((New-Payment 'e2e-apres-reprise-api') -eq 201)

  $samples = @()
  1..$Repeat | ForEach-Object { Wait-Calm; $samples += Measure-Recovery { docker stop resilience-postgres | Out-Null } }
  Add-RecoveryStats 'PostgreSQL' $samples
  Wait-Calm
  $after = @(Invoke-RestMethod "$Api/payments" -Headers $auth).Count
  Record 'Transactions conservees apres les pannes de base' ($after -ge $before) "avant=$before apres=$after"
  Record 'Nouvelle transaction acceptee apres la reprise de la base' ((New-Payment 'e2e-apres-reprise-base') -eq 201)
}

# Nettoyage : supprime uniquement les transactions créées par cette recette (destinataire préfixé par e2e-).
docker exec resilience-postgres psql -U resilience -d resilience -q -c "DELETE FROM payments WHERE recipient LIKE 'e2e-%'" 2>$null | Out-Null

$results | Format-Table -AutoSize -Wrap
$failed = @($results | Where-Object { $_.Resultat -eq 'FAIL' }).Count
Write-Host ("Bilan : {0} tests, {1} echec(s)" -f $results.Count, $failed)
exit $(if ($failed -gt 0) { 1 } else { 0 })
