# Cloudmap whitepaper: Markdown -> HTML preview
param(
    [string]$Output = "",
    [switch]$Open
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_pandoc.ps1")
$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root "source"
$OutputDir = Join-Path $Root "output"
$Manifest = Join-Path $Source "manifest.txt"

if (-not (Test-Path $Manifest)) {
    Write-Error "Missing manifest: $Manifest"
}

$pandocExe = Resolve-PandocExecutable
if (-not $pandocExe) {
    Write-Host "Pandoc not found. Install: winget install --id JohnMacFarlane.Pandoc" -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$files = Get-Content $Manifest -Encoding UTF8 | Where-Object { $_ -and -not $_.StartsWith("#") }
$inputs = @()
foreach ($rel in $files) {
    $p = Join-Path $Source $rel.Trim()
    if (-not (Test-Path $p)) { Write-Error "Missing source file: $p" }
    $inputs += $p
}

if (-not $Output) {
    $Output = Join-Path $OutputDir "cloudmap-whitepaper.html"
}

$css = Join-Path (Join-Path $Root "templates") "preview.css"
$pandocArgs = @(
    $inputs
    "-o", $Output
    "--from", "markdown"
    "--to", "html5"
    "--standalone"
    "--toc"
    "--toc-depth=3"
    "--metadata", "title=Cloudmap Whitepaper"
    "--resource-path=$Source"
)
if (Test-Path $css) {
    $pandocArgs += @("--css=../templates/preview.css")
}

& $pandocExe @pandocArgs

$assetsSrc = Join-Path $Source "assets"
$assetsOut = Join-Path $OutputDir "assets"
if (Test-Path $assetsSrc) {
    New-Item -ItemType Directory -Force -Path $assetsOut | Out-Null
    Copy-Item -Force (Join-Path $assetsSrc "*") $assetsOut
}

Write-Host "Generated: $Output" -ForegroundColor Green

if ($Open) {
    Start-Process $Output
}
