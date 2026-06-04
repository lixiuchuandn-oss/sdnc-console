# Shared Pandoc build for whitepaper / user-manual
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('whitepaper', 'manual')]
    [string]$Variant,

    [Parameter(Mandatory = $true)]
    [ValidateSet('docx', 'html')]
    [string]$Format,

    [string]$Output = "",
    [switch]$CopyToDeployment,
    [switch]$Open
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_pandoc.ps1")

$Root = Split-Path -Parent $PSScriptRoot
$DocRoot = if ($Variant -eq 'manual') { Join-Path $Root "user-manual" } else { $Root }
$Source = Join-Path $DocRoot "source"
$OutputDir = Join-Path $DocRoot "output"
$Manifest = Join-Path $Source "manifest.txt"

if (-not (Test-Path $Manifest)) {
    Write-Error "Missing manifest: $Manifest"
}

$pandocExe = Resolve-PandocExecutable
if (-not $pandocExe) {
    Write-Host "pandoc not found. Install: winget install --id JohnMacFarlane.Pandoc" -ForegroundColor Yellow
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

$defaultName = if ($Variant -eq 'manual') { "cloudmap-user-manual" } else { "cloudmap-whitepaper" }
$ext = if ($Format -eq 'html') { "html" } else { "docx" }
if (-not $Output) {
    $Output = Join-Path $OutputDir "$defaultName.$ext"
}

$refDoc = Join-Path (Join-Path $Root "templates") "reference.docx"
$whitepaperAssets = Join-Path (Join-Path $Root "source") "assets"

if ($Format -eq 'docx') {
    $pandocArgs = @(
        $inputs
        "-o", $Output
        "--from", "markdown"
        "--to", "docx"
        "--toc"
        "--toc-depth=3"
        "--resource-path=$Source;$whitepaperAssets"
    )
    if (Test-Path $refDoc) {
        $pandocArgs += @("--reference-doc=$refDoc")
    }
} else {
    $css = Join-Path (Join-Path $Root "templates") "preview.css"
    $title = if ($Variant -eq 'manual') { "Cloudmap 使用手册" } else { "Cloudmap Whitepaper" }
    $pandocArgs = @(
        $inputs
        "-o", $Output
        "--from", "markdown"
        "--to", "html5"
        "--standalone"
        "--toc"
        "--toc-depth=3"
        "--metadata", "title=$title"
        "--resource-path=$Source;$whitepaperAssets"
    )
    if (Test-Path $css) {
        $pandocArgs += @("--css=../templates/preview.css")
    }
}

& $pandocExe @pandocArgs
Write-Host "Generated: $Output" -ForegroundColor Green

function Copy-AssetTree {
    param(
        [Parameter(Mandatory = $true)][string]$AssetsSrc,
        [Parameter(Mandatory = $true)][string]$AssetsOut
    )
    if (-not (Test-Path $AssetsSrc)) { return }
    New-Item -ItemType Directory -Force -Path $AssetsOut | Out-Null
    # 目录须复制到 $AssetsOut 父级；若目标已存在空目录，Copy-Item -Destination $子路径 不会写入文件
    Get-ChildItem -LiteralPath $AssetsSrc -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $AssetsOut -Recurse -Force
    }
}

if ($Format -eq 'html') {
    $assetsOut = Join-Path $OutputDir "assets"
    if (Test-Path $assetsOut) {
        Remove-Item -LiteralPath $assetsOut -Recurse -Force
    }
    foreach ($assetsSrc in @((Join-Path $Source "assets"), $whitepaperAssets)) {
        Copy-AssetTree -AssetsSrc $assetsSrc -AssetsOut $assetsOut
    }
    if ($Open) {
        Start-Process $Output
    }
}

if ($CopyToDeployment) {
    $deploy = Join-Path (Split-Path -Parent (Split-Path -Parent $Root)) "deployment"
    if (-not (Test-Path $deploy)) { New-Item -ItemType Directory -Path $deploy | Out-Null }
    $destName = if ($Variant -eq 'manual') { "Cloudmap_user_manual.docx" } else { "Cloudmap_whitepaper.docx" }
    $dest = Join-Path $deploy $destName
    Copy-Item -Force $Output $dest
    Write-Host "Copied to: $dest" -ForegroundColor Green
}
