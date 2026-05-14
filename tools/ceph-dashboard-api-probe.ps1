# Ceph mgr Dashboard REST probe
#
# Mode A - kube token only (summary often 401 if Dashboard requires login):
#   powershell -ExecutionPolicy Bypass -File .\tools\ceph-dashboard-api-probe.ps1 -Token "KUBE_OR_RANCHER_TOKEN"
#
# Mode B - Dashboard user/password (recommended behind k8s service proxy):
#   powershell -ExecutionPolicy Bypass -File .\tools\ceph-dashboard-api-probe.ps1 `
#     -Token "KUBE_OR_RANCHER_TOKEN" -DashboardUser "admin" -DashboardPassword "secret"
# Prefer env for password (avoids shell history):
#   $env:CEPH_PROBE_TOKEN="..."; $env:CEPH_DASHBOARD_USER="admin"; $env:CEPH_DASHBOARD_PASSWORD="..."
#   powershell -ExecutionPolicy Bypass -File .\tools\ceph-dashboard-api-probe.ps1
#
# Requires curl.exe (Windows 10+).

param(
  [string]$BaseUrl = "https://10.2.200.101",
  [string]$Namespace = "rook-ceph",
  [string]$ServiceTriplet = "http:rook-ceph-mgr-dashboard:7000",
  [string]$Token = "",
  [string]$DashboardUser = "",
  [string]$DashboardPassword = "",
  [switch]$PrintJwt
)

if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = $env:CEPH_PROBE_TOKEN
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = Read-Host "Kube/Rancher Bearer token for API proxy (empty = exit)"
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  Write-Host "No kube token. Exit." -ForegroundColor Yellow
  exit 1
}

if ([string]::IsNullOrWhiteSpace($DashboardUser)) {
  $DashboardUser = $env:CEPH_DASHBOARD_USER
}
if ([string]::IsNullOrWhiteSpace($DashboardPassword)) {
  $DashboardPassword = $env:CEPH_DASHBOARD_PASSWORD
}

$kubeBearer = if ($Token -match '^\s*Bearer\s+') { $Token.Trim() } else { "Bearer $($Token.Trim())" }

$base = $BaseUrl.TrimEnd('/')
$proxyPrefix = "/k8s/clusters/local/api/v1/namespaces/$Namespace/services/$ServiceTriplet/proxy"
$authUrl = "$base$proxyPrefix/api/auth"
$summaryUrl = "$base$proxyPrefix/api/summary"

Write-Host "Auth URL:  $authUrl" -ForegroundColor Gray
Write-Host "Summary:   $summaryUrl" -ForegroundColor Gray
Write-Host ""

$accepts = @(
  "application/vnd.ceph.api.v1.0+json",
  "application/vnd.ceph.api.v1.1+json"
)

# POST /api/auth: many clusters only expose v1.0; v1.1 returns 415 (endpoint is 1.0).
$acceptsAuth = @(
  "application/vnd.ceph.api.v1.0+json"
)

function Get-DashboardJwtFromJson {
  param([string]$JsonText)
  if ([string]::IsNullOrWhiteSpace($JsonText)) { return $null }
  try {
    $j = $JsonText | ConvertFrom-Json
  }
  catch {
    return $null
  }
  if ($null -ne $j.token) { return [string]$j.token }
  if ($j.PSObject.Properties.Name -contains 'data' -and $null -ne $j.data) {
    if ($null -ne $j.data.token) { return [string]$j.data.token }
  }
  return $null
}

function Invoke-SummaryProbe {
  param(
    [string]$Label,
    [string[]]$ExtraCurlArgs
  )
  foreach ($accept in $accepts) {
    Write-Host "=== $Label | Accept: $accept ===" -ForegroundColor Cyan
    $tmp = New-TemporaryFile
    try {
      $curlArgs = @(
        '-sS',
        '-o', $tmp.FullName,
        '-w', '%{http_code}',
        '-k'
      ) + $ExtraCurlArgs + @(
        '-H', "Accept: $accept",
        $summaryUrl
      )
      $code = & curl.exe @curlArgs
      $body = Get-Content -Raw -Path $tmp.FullName -ErrorAction SilentlyContinue
      Write-Host "HTTP: $code"
      if ($body) { Write-Host $body }
      if ($code -eq "200") {
        Write-Host ""
        Write-Host "OK: summary returned 200." -ForegroundColor Green
        return $true
      }
    }
    finally {
      Remove-Item -Force -ErrorAction SilentlyContinue $tmp.FullName
    }
    Write-Host ""
  }
  return $false
}

# --- Optional: login to obtain session cookie + JWT in body ---
$dashboardJwt = $null
$cookieJar = $null

if (-not [string]::IsNullOrWhiteSpace($DashboardUser)) {
  if ([string]::IsNullOrWhiteSpace($DashboardPassword)) {
    $secure = Read-Host "Dashboard password" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $DashboardPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }

  $cookieJar = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), "ceph_cookies.txt")
  $authTmp = New-TemporaryFile
  $payloadPath = $null
  try {
    # PS -> curl -d string often breaks JSON; Ceph also rejects UTF-8 BOM. Use file + --data-binary.
    $loginObj = [ordered]@{ username = $DashboardUser; password = $DashboardPassword }
    $loginJson = ($loginObj | ConvertTo-Json -Compress)
    $payloadPath = [System.IO.Path]::GetTempFileName()
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($payloadPath, $loginJson, $utf8NoBom)

    $authOk = $false
    $authBody = $null
    $authCode = $null
    # Plain application/json first: charset=utf-8 has triggered 500 on some mgr versions while plain returns clear invalid_credentials.
    $ctVariants = @(
      'application/json',
      'application/json; charset=utf-8'
    )
    foreach ($ct in $ctVariants) {
      foreach ($authAccept in $acceptsAuth) {
        Write-Host "POST /api/auth (Accept=$authAccept, Content-Type=$ct) ..." -ForegroundColor Gray
        Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar
        $authCode = & curl.exe -sS -o $authTmp.FullName -w '%{http_code}' -k `
          -c $cookieJar `
          -H "Authorization: $kubeBearer" `
          -H "Accept: $authAccept" `
          -H "Content-Type: $ct" `
          '--data-binary', "@$payloadPath" `
          $authUrl
        $authBody = Get-Content -Raw -Path $authTmp.FullName -ErrorAction SilentlyContinue
        Write-Host "  -> HTTP: $authCode" -ForegroundColor Gray
        if ($authBody) { Write-Host $authBody }
        Write-Host ""
        if ($authCode -eq "200" -or $authCode -eq "201") {
          $authOk = $true
          break
        }
        # Definitive: do not retry Content-Type (charset often yields 500 on same Quincy builds).
        if ($authCode -eq "400" -and $authBody -match 'invalid_credentials') {
          Write-Host "invalid_credentials: REST password does not match this Dashboard user." -ForegroundColor Red
          Write-Host "  Use LOCAL Dashboard admin/password (browser SSO password may differ)." -ForegroundColor Yellow
          Write-Host "  Ops can reset: ceph dashboard ac-user-set-password <user>" -ForegroundColor Yellow
          Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar
          exit 3
        }
      }
      if ($authOk) { break }
    }

    if (-not $authOk) {
      Write-Host "POST /api/auth failed after all tries (API v1.0 only for login)." -ForegroundColor Red
      Write-Host "  Kubernetes kind:Status / Unauthorized -> fix -Token (kube/Rancher)." -ForegroundColor Yellow
      Write-Host "  HTTP 500 on charset=utf-8 -> skip that; plain application/json already tried first." -ForegroundColor Yellow
      Write-Host "  Other HTTP 500 -> search request_id in rook-ceph mgr pod logs." -ForegroundColor Yellow
      Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar
      exit 3
    }

    $dashboardJwt = Get-DashboardJwtFromJson -JsonText $authBody
    if ($PrintJwt -and $dashboardJwt) {
      Write-Host "JWT (from auth JSON):" -ForegroundColor Gray
      Write-Host $dashboardJwt
      Write-Host ""
    }
    elseif ($dashboardJwt) {
      Write-Host "JWT received (length $($dashboardJwt.Length)); use -PrintJwt to print full string." -ForegroundColor Gray
      Write-Host ""
    }
  }
  finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $authTmp.FullName
    if ($payloadPath) { Remove-Item -Force -ErrorAction SilentlyContinue $payloadPath }
  }
}

# --- 1) After login: kube Authorization + session cookie (works with many apiserver+Dashboard setups) ---
if ($cookieJar -and (Test-Path -LiteralPath $cookieJar)) {
  $ok = Invoke-SummaryProbe -Label "kube Bearer + Dashboard session cookie" -ExtraCurlArgs @(
    '-b', $cookieJar,
    '-H', "Authorization: $kubeBearer"
  )
  if ($ok) {
    Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar
    exit 0
  }
}

# --- 2) JWT-only (often fails behind k8s proxy because apiserver expects kube token; useful if you port-forward Dashboard) ---
if ($dashboardJwt) {
  $jwtHdr = "Bearer $dashboardJwt"
  $ok = Invoke-SummaryProbe -Label "Dashboard JWT only (may fail behind kube proxy)" -ExtraCurlArgs @(
    '-H', "Authorization: $jwtHdr"
  )
  if ($ok) {
    if ($cookieJar) { Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar }
    exit 0
  }
}

# --- 3) kube only (fallback / no Dashboard login) ---
$ok = Invoke-SummaryProbe -Label "kube Bearer only" -ExtraCurlArgs @(
  '-H', "Authorization: $kubeBearer"
)
if ($ok) {
  if ($cookieJar) { Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar }
  exit 0
}

if ($cookieJar) { Remove-Item -Force -ErrorAction SilentlyContinue $cookieJar }

Write-Host "No HTTP 200 on /api/summary." -ForegroundColor Yellow
Write-Host "If JWT-only failed but login succeeded: apiserver proxy usually still needs kube Bearer; cookie+kube should be tried first." -ForegroundColor Yellow
Write-Host "You can port-forward svc/rook-ceph-mgr-dashboard and call https://127.0.0.1:7000/api/summary with JWT only." -ForegroundColor Yellow
exit 2
