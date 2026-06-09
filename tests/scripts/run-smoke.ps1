# 公共测试机定时/手动跑全量 smoke。要求：Tower 前后端已启动，tests/.env 已配置。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tests\scripts\run-smoke.ps1

$ErrorActionPreference = 'Stop'
$TestsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RepoRoot = (Resolve-Path (Join-Path $TestsRoot '..')).Path
$LogDir = Join-Path $TestsRoot 'logs'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogFile = Join-Path $LogDir "smoke-$stamp.log"
$PlaywrightLog = Join-Path $LogDir "smoke-$stamp-playwright.log"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log($msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Write-Host $line
  [System.IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine, $Utf8NoBom)
}

function Append-PlaywrightLog($msg) {
  [System.IO.File]::AppendAllText($PlaywrightLog, $msg + [Environment]::NewLine, $Utf8NoBom)
}

Write-Log "repo: $RepoRoot"
Write-Log "tests: $TestsRoot"
Write-Log "playwright log: $PlaywrightLog"

$webBase = $env:TOWER_WEB_BASE
if (-not $webBase) { $webBase = 'http://127.0.0.1:5000' }
$apiBase = $env:TOWER_API_BASE
if (-not $apiBase) { $apiBase = 'http://127.0.0.1:5001' }

try {
  $health = Invoke-WebRequest -Uri "$apiBase/health" -UseBasicParsing -TimeoutSec 10
  Write-Log "backend health: $($health.StatusCode)"
} catch {
  Write-Log "ERROR: backend not reachable at $apiBase/health — start backend first"
  exit 2
}

try {
  $front = Invoke-WebRequest -Uri $webBase -UseBasicParsing -TimeoutSec 15
  Write-Log "frontend: $($front.StatusCode) $webBase"
} catch {
  Write-Log "ERROR: frontend not reachable at $webBase — start frontend first"
  exit 2
}

$env:HEADLESS = '1'
Push-Location $TestsRoot
try {
  Write-Log "running: npm run test:smoke"
  npm run test:smoke 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Write-Host $line
    Append-PlaywrightLog $line
  }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Log "FAILED exit code $code (see playwright log)"
    exit $code
  }
  Write-Log "PASSED (12 passed + pool-wizard may skip without Cloudmap creds)"
  exit 0
} finally {
  Pop-Location
}
