# Remote deploy entry (Windows PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..')
$ConfigPath = Join-Path $ScriptDir 'deploy.config'
$ExamplePath = Join-Path $ScriptDir 'deploy.config.example'

if (-not (Test-Path $ExamplePath)) {
	Write-Error "Missing $ExamplePath"
	exit 1
}

if (-not (Test-Path $ConfigPath)) {
	Copy-Item $ExamplePath $ConfigPath
	Write-Host ''
	Write-Host "Created scripts/deploy.config"
	Write-Host "Edit DEPLOY_USER and DEPLOY_SSH_PASSWORD (or DEPLOY_SSH_KEY), then rerun."
	Write-Host ''
	exit 0
}

function Test-DeployConfigReady {
	$text = Get-Content -Raw -Path $ConfigPath
	$cfg = @{}
	foreach ($line in ($text -split "`n")) {
		$t = $line.Trim()
		if (-not $t -or $t.StartsWith('#')) { continue }
		$eq = $t.IndexOf('=')
		if ($eq -lt 1) { continue }
		$cfg[$t.Substring(0, $eq).Trim()] = $t.Substring($eq + 1).Trim()
	}

	if (-not $cfg['DEPLOY_HOST']) { return 'Missing DEPLOY_HOST' }
	if (-not $cfg['DEPLOY_USER']) { return 'Missing DEPLOY_USER' }
	if (-not $cfg['DEPLOY_REMOTE_DIR']) { return 'Missing DEPLOY_REMOTE_DIR' }

	$hasPassword = [bool]$cfg['DEPLOY_SSH_PASSWORD']
	$hasKey = [bool]$cfg['DEPLOY_SSH_KEY']
	if (-not $hasPassword -and -not $hasKey) {
		return 'Set DEPLOY_SSH_PASSWORD or DEPLOY_SSH_KEY (one only)'
	}
	if ($hasPassword -and $hasKey) {
		return 'Use only one of DEPLOY_SSH_PASSWORD or DEPLOY_SSH_KEY'
	}
	return $null
}

$cfgError = Test-DeployConfigReady
if ($cfgError) {
	Write-Host ''
	Write-Host "deploy.config not ready: $cfgError"
	Write-Host "Edit $ConfigPath and retry."
	Write-Host ''
	exit 1
}

Push-Location $RepoRoot
try {
	if (-not (Test-Path 'node_modules')) {
		Write-Host '>>> npm install'
		npm install
	}

	Write-Host '>>> npm run deploy:remote'
	npm run deploy:remote
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
	Pop-Location
}
