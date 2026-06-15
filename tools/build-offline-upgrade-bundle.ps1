# 基于当前仓库构建 Compute Tower 离线升级 zip（public/ + server/ + manifest.json）
# 用法：powershell -ExecutionPolicy Bypass -File tools/build-offline-upgrade-bundle.ps1
# 输出：仓库根目录 release/compute-tower-offline-upgrade-<version>-<timestamp>.zip

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$BackendRoot = Join-Path $RepoRoot 'backend'
$FrontendRoot = Join-Path $RepoRoot 'frontend'
$ReleaseDir = Join-Path $RepoRoot 'release'

function Read-JsonVersion($pkgPath) {
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

Write-Host "==> 编译后端 (tsc) ..."
Push-Location $BackendRoot
npm run build
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "后端编译失败 (exit $LASTEXITCODE)，已中止打包"
}
Pop-Location

Write-Host "==> 编译前端 (react-scripts build) ..."
Push-Location $FrontendRoot
$env:NODE_OPTIONS = '--max-old-space-size=4096'
$env:GENERATE_SOURCEMAP = 'false'
if (Get-Command npx -ErrorAction SilentlyContinue) {
  npx react-scripts build
} else {
  npm run build
}
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "前端编译失败 (exit $LASTEXITCODE)，已中止打包"
}
Pop-Location

$version = Read-JsonVersion (Join-Path $BackendRoot 'package.json')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bundleName = "compute-tower-offline-upgrade-$version-$stamp"
$stage = Join-Path $env:TEMP "tower-offline-$stamp"
$stagePublic = Join-Path $stage 'public'
$stageServer = Join-Path $stage 'server'

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stagePublic, $stageServer -Force | Out-Null

Write-Host "==> 组装离线包目录 ..."
Copy-Item -Path (Join-Path $FrontendRoot 'build\*') -Destination $stagePublic -Recurse -Force
Copy-Item -Path (Join-Path $BackendRoot 'dist\*') -Destination $stageServer -Recurse -Force
Copy-Item -Path (Join-Path $BackendRoot 'package.json') -Destination $stage -Force

$gitHash = ''
try {
  Push-Location $RepoRoot
  $gitHash = (git rev-parse --short HEAD 2>$null)
  Pop-Location
} catch { }

$builtAt = (Get-Date).ToUniversalTime().ToString('o')
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$stampJson = (@{
  builtAt = $builtAt
  version = $version
  gitCommit = $gitHash
  features = @('offline-upgrade-bundle')
} | ConvertTo-Json -Depth 4 -Compress)
Write-Utf8NoBom (Join-Path $stagePublic '.tower-build-stamp.json') $stampJson

$manifest = (@{ version = $version } | ConvertTo-Json -Compress)
Write-Utf8NoBom (Join-Path $stage 'manifest.json') $manifest

if (-not (Test-Path $ReleaseDir)) { New-Item -ItemType Directory -Path $ReleaseDir | Out-Null }
$zipPath = Join-Path $ReleaseDir "$bundleName.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

Write-Host ""
Write-Host "离线升级包已生成："
Write-Host "  $zipPath"
Write-Host "版本：$version"
Write-Host "请在「系统设置 → 离线升级」上传该 zip。"
