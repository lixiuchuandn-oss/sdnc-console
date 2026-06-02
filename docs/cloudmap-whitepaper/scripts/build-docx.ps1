# Cloudmap 白皮书：Markdown 源稿 -> Word
param(
    [string]$Output = "",
    [switch]$CopyToDeployment
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_pandoc.ps1")
$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root "source"
$OutputDir = Join-Path $Root "output"
$Manifest = Join-Path $Source "manifest.txt"

if (-not (Test-Path $Manifest)) {
    Write-Error "缺少 $Manifest，请先维护章节清单。"
}

$pandocExe = Resolve-PandocExecutable
if (-not $pandocExe) {
    Write-Host @"

未检测到 pandoc。请先安装：
  winget install --id JohnMacFarlane.Pandoc
或 https://pandoc.org/installing.html

安装后重新运行本脚本。

"@ -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$files = Get-Content $Manifest -Encoding UTF8 | Where-Object { $_ -and -not $_.StartsWith("#") }
$inputs = @()
foreach ($rel in $files) {
    $p = Join-Path $Source $rel.Trim()
    if (-not (Test-Path $p)) { Write-Error "找不到源文件: $p" }
    $inputs += $p
}

if (-not $Output) {
    $Output = Join-Path $OutputDir "cloudmap-whitepaper.docx"
}

$refDoc = Join-Path (Join-Path $Root "templates") "reference.docx"
$pandocArgs = @(
    $inputs
    "-o", $Output
    "--from", "markdown"
    "--to", "docx"
    "--toc"
    "--toc-depth=3"
    "--resource-path=$Source"
)
if (Test-Path $refDoc) {
    $pandocArgs += @("--reference-doc=$refDoc")
}

& $pandocExe @pandocArgs
Write-Host "已生成: $Output" -ForegroundColor Green

if ($CopyToDeployment) {
    $deploy = Join-Path (Split-Path -Parent (Split-Path -Parent $Root)) "deployment"
    if (-not (Test-Path $deploy)) { New-Item -ItemType Directory -Path $deploy | Out-Null }
    $dest = Join-Path $deploy "Cloudmap_超融合平台技术白皮书.docx"
    Copy-Item -Force $Output $dest
    Write-Host "已复制到: $dest" -ForegroundColor Green
}
