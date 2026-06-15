# Shared Pandoc build for whitepaper / user-manual
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('whitepaper', 'manual', 'tender')]
    [string]$Variant,

    [Parameter(Mandatory = $true)]
    [ValidateSet('docx', 'html')]
    [string]$Format,

    [string]$Output = "",
    [switch]$Open,

    # 文档根覆盖（泛化）：指向 docs/cloudmap 之外的独立文档树时仍复用本目录 templates。
    # 绝对路径或相对仓库根，如 -DocRoot docs/multicloud/whitepaper -Name multicloud-whitepaper
    [string]$DocRoot = "",
    [string]$Name = "",
    [string]$Title = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_pandoc.ps1")

$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Root)
$externalDoc = -not [string]::IsNullOrWhiteSpace($DocRoot)
if ($externalDoc) {
    if (-not [System.IO.Path]::IsPathRooted($DocRoot)) {
        $DocRoot = Join-Path $RepoRoot $DocRoot
    }
} else {
    $DocRoot = switch ($Variant) {
        'manual' { Join-Path $Root "user-manual" }
        'tender' { Join-Path $Root "tender-parameters" }
        default  { Join-Path $Root "whitepaper" }
    }
}
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

$files = @(Get-Content $Manifest -Encoding UTF8 | Where-Object { $_ -and -not $_.StartsWith("#") } | ForEach-Object { $_.Trim() })
$inputs = @()
$tmpBuildDir = $null

function Get-ManualChapterEndSet {
    param([string[]]$ManifestRelPaths)
    $ends = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    for ($i = 0; $i -lt $ManifestRelPaths.Count; $i++) {
        $rel = $ManifestRelPaths[$i]
        $next = if ($i + 1 -lt $ManifestRelPaths.Count) { $ManifestRelPaths[$i + 1] } else { $null }
        if ($rel -match '^\d{2}-[^/]+\.md$') {
            if (-not $next -or $next -match '^(ch03/|\d{2}-)') {
                [void]$ends.Add($rel)
            }
        }
        if ($rel -match '^ch03/' -and $next -and $next -match '^\d{2}-[^/]+\.md$') {
            [void]$ends.Add($rel)
        }
    }
    return $ends
}

function Add-ChapterTrailingBlankLine {
    param([string]$Content)
    return $Content.TrimEnd("`r", "`n", " ", "`t") + "`n`n"
}

$chapterEnds = $null
if ($Variant -eq 'manual') {
    $chapterEnds = Get-ManualChapterEndSet -ManifestRelPaths $files
    $tmpBuildDir = Join-Path ([IO.Path]::GetTempPath()) ("cloudmap-manual-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tmpBuildDir | Out-Null
}

foreach ($rel in $files) {
    $p = Join-Path $Source $rel
    if (-not (Test-Path $p)) { Write-Error "Missing source file: $p" }
    if ($chapterEnds -and $chapterEnds.Contains($rel)) {
        $raw = [System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false))
        $patched = Add-ChapterTrailingBlankLine $raw
        $tmpName = ($rel -replace '[/\\:]', '_')
        $tmpPath = Join-Path $tmpBuildDir $tmpName
        [System.IO.File]::WriteAllText($tmpPath, $patched, (New-Object System.Text.UTF8Encoding $false))
        $inputs += $tmpPath
    } else {
        $inputs += $p
    }
}

$defaultName = if ($Name) {
    $Name
} elseif ($externalDoc) {
    Split-Path -Leaf $DocRoot
} else {
    switch ($Variant) {
        'manual'  { "cloudmap-user-manual" }
        'tender'  { "cloudmap-tender-parameters" }
        default   { "cloudmap-whitepaper" }
    }
}
$ext = if ($Format -eq 'html') { "html" } else { "docx" }
if (-not $Output) {
    $Output = Join-Path $OutputDir "$defaultName.$ext"
}

function Resolve-WritableOutputPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return $Path
    }
    try {
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $stream.Close()
        return $Path
    } catch {
        $dir = [System.IO.Path]::GetDirectoryName($Path)
        $base = [System.IO.Path]::GetFileNameWithoutExtension($Path)
        $ext = [System.IO.Path]::GetExtension($Path)
        $alt = Join-Path $dir ($base + '-new' + $ext)
        Write-Host "WARN: output file is locked (close Word if open):" -ForegroundColor Yellow
        Write-Host "      $Path" -ForegroundColor Yellow
        Write-Host "      -> $alt" -ForegroundColor Yellow
        return $alt
    }
}

if ($Format -eq 'docx') {
    $Output = Resolve-WritableOutputPath -Path $Output
}

$templatesDir = Join-Path $Root "templates"
$refDoc = Join-Path $templatesDir "reference.docx"
$whitepaperAssets = Join-Path (Join-Path (Join-Path $Root "whitepaper") "source") "assets"

$prepareRef = Join-Path $PSScriptRoot "prepare-reference-docx.ps1"
if ($Format -eq 'docx' -and (Test-Path $prepareRef)) {
    & $prepareRef -RefPath $refDoc
}

if ($Format -eq 'docx') {
    $luaFilter = Join-Path (Join-Path $Root "templates") "filters\docx-cleanup.lua"
    $chapterBreakFilter = Join-Path (Join-Path $Root "templates") "filters\manual-chapter-break.lua"
    $tocDepth = if ($Variant -eq 'manual') { "2" } else { "3" } # tender: 3
    $pandocArgs = @(
        $inputs
        "-o", $Output
        "--from", "markdown"
        "--to", "docx"
        "--data-dir=$templatesDir"
        "--toc"
        "--toc-depth=$tocDepth"
        "--resource-path=$Source;$whitepaperAssets"
    )
    $bodyFormatFilter = Join-Path (Join-Path $Root "templates") "filters\manual-body-format.lua"
    if (($Variant -eq 'manual' -or $Variant -eq 'tender') -and (Test-Path $bodyFormatFilter)) {
        $pandocArgs += @("--lua-filter=$bodyFormatFilter")
    }
    if (Test-Path $luaFilter) {
        $pandocArgs += @("--lua-filter=$luaFilter")
    }
    if ($Variant -eq 'manual' -and (Test-Path $chapterBreakFilter)) {
        $pandocArgs += @("--lua-filter=$chapterBreakFilter")
    }
    $pandocArgs += @("--metadata", "lang=zh-CN")
    if (Test-Path $refDoc) {
        $pandocArgs += @("--reference-doc=$refDoc")
    } else {
        Write-Host "Tip: run scripts/customize-reference-docx.ps1 after generating templates/reference.docx" -ForegroundColor Yellow
    }
} else {
    $css = Join-Path (Join-Path $Root "templates") "preview.css"
    $title = if ($Title) {
        $Title
    } else {
        switch ($Variant) {
            'manual' { "Cloudmap 使用手册" }
            'tender' { "Cloudmap 招标参数" }
            default  { "Cloudmap Whitepaper" }
        }
    }
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
        Copy-Item -LiteralPath $css -Destination (Join-Path $OutputDir "preview.css") -Force
        $pandocArgs += @("--css=preview.css")
    }
    $chapterBreakFilter = Join-Path (Join-Path $Root "templates") "filters\manual-chapter-break.lua"
    if ($Variant -eq 'manual' -and (Test-Path $chapterBreakFilter)) {
        $pandocArgs += @("--lua-filter=$chapterBreakFilter")
    }
}

function Set-HtmlSidebarLayout {
    param([Parameter(Mandatory = $true)][string]$HtmlPath)
    if (-not (Test-Path $HtmlPath)) { return }
    $enc = New-Object System.Text.UTF8Encoding $false
    $html = [System.IO.File]::ReadAllText($HtmlPath, $enc)
    if ($html -match 'class="doc-layout"') { return }
    $pattern = '(?s)(<body>\s*)(<header id="title-block-header">.*?</header>\s*)(<nav id="TOC"[^>]*>.*?</nav>\s*)(.*?)(\s*</body>)'
    $m = [regex]::Match($html, $pattern)
    if (-not $m.Success) {
        Write-Host "WARN: HTML sidebar layout skipped (unexpected structure): $HtmlPath" -ForegroundColor Yellow
        return
    }
    $wrapped = $m.Groups[1].Value +
        '<div class="doc-layout">' +
        '<aside class="doc-sidebar">' + $m.Groups[2].Value + $m.Groups[3].Value + '</aside>' +
        '<main class="doc-content">' + $m.Groups[4].Value + '</main>' +
        '</div>' + $m.Groups[5].Value
    $html = $html.Substring(0, $m.Index) + $wrapped + $html.Substring($m.Index + $m.Length)
    [System.IO.File]::WriteAllText($HtmlPath, $html, $enc)
}

function Clear-DocxBodyIndent {
    param([Parameter(Mandatory = $true)][string]$DocxPath)
    if (-not (Test-Path $DocxPath)) { return }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("docx-ind-" + [Guid]::NewGuid().ToString("N"))
    $docDir = Join-Path $tmp "doc"
    New-Item -ItemType Directory -Path $docDir -Force | Out-Null
    $zip = Join-Path $tmp "d.zip"
    Copy-Item -LiteralPath $DocxPath -Destination $zip -Force
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $docDir)
    $noInd = '<w:ind w:left="0" w:right="0" w:firstLine="0" w:firstLineChars="0" w:hanging="0"/>'
    foreach ($rel in @('word\document.xml')) {
        $partPath = Join-Path $docDir $rel
        if (-not (Test-Path $partPath)) { continue }
        $xml = [System.IO.File]::ReadAllText($partPath, [System.Text.UTF8Encoding]::new($false))
        $xml = [regex]::Replace($xml, '<w:ind\s+[^>]*/>', $noInd)
        [System.IO.File]::WriteAllText($partPath, $xml, (New-Object System.Text.UTF8Encoding $false))
    }
    Remove-Item -LiteralPath $DocxPath -Force
    [System.IO.Compression.ZipFile]::CreateFromDirectory($docDir, $DocxPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item -LiteralPath $tmp -Recurse -Force
}

function Set-DocxPageMargins {
    param(
        [Parameter(Mandatory = $true)][string]$DocxPath,
        [double]$MarginCm = 1.9
    )
    if (-not (Test-Path $DocxPath)) { return }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $marginTwips = [string]([int][Math]::Round($MarginCm / 2.54 * 1440))
    $pgMar = '<w:pgMar w:top="' + $marginTwips + '" w:right="' + $marginTwips + '" w:bottom="' + $marginTwips + '" w:left="' + $marginTwips + '" w:header="708" w:footer="708" w:gutter="0"/>'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("docx-mar-" + [Guid]::NewGuid().ToString("N"))
    $docDir = Join-Path $tmp "doc"
    New-Item -ItemType Directory -Path $docDir -Force | Out-Null
    $zip = Join-Path $tmp "d.zip"
    Copy-Item -LiteralPath $DocxPath -Destination $zip -Force
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $docDir)
    $partPath = Join-Path $docDir "word\document.xml"
    if (Test-Path $partPath) {
        $xml = [System.IO.File]::ReadAllText($partPath, [System.Text.UTF8Encoding]::new($false))
        if ($xml -match '<w:pgMar\s') {
            $xml = [regex]::Replace($xml, '<w:pgMar\s[^>]*/>', $pgMar)
        } else {
            $xml = [regex]::Replace($xml, '<w:sectPr>', ('<w:sectPr>' + $pgMar))
        }
        [System.IO.File]::WriteAllText($partPath, $xml, (New-Object System.Text.UTF8Encoding $false))
    }
    Remove-Item -LiteralPath $DocxPath -Force
    [System.IO.Compression.ZipFile]::CreateFromDirectory($docDir, $DocxPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item -LiteralPath $tmp -Recurse -Force
}

function Set-DocxTableLayout {
    param([Parameter(Mandatory = $true)][string]$DocxPath)
    if (-not (Test-Path $DocxPath)) { return }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("docx-tbl-" + [Guid]::NewGuid().ToString("N"))
    $docDir = Join-Path $tmp "doc"
    New-Item -ItemType Directory -Path $docDir -Force | Out-Null
    $zip = Join-Path $tmp "d.zip"
    Copy-Item -LiteralPath $DocxPath -Destination $zip -Force
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $docDir)
    $partPath = Join-Path $docDir "word\document.xml"
    if (Test-Path $partPath) {
        $xml = [System.IO.File]::ReadAllText($partPath, [System.Text.UTF8Encoding]::new($false))
        $tblPr = '<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/></w:tblPr>'
        $xml = [regex]::Replace($xml, '<w:tbl>(?!\s*<w:tblPr>)', ('<w:tbl>' + $tblPr))
        # Repeat the header row at the top of each page a table spans. Newer pandoc
        # emits <w:tblHeader/> itself; for older output that only marks the first row
        # via cnfStyle, add it (guarded so we never duplicate the element).
        $xml = [regex]::Replace($xml, '(<w:trPr>)(?![^<]*<w:tblHeader)((?:(?!</w:trPr>).)*<w:cnfStyle w:firstRow="1"[^>]*/>)', '$1<w:tblHeader/>$2')
        [System.IO.File]::WriteAllText($partPath, $xml, (New-Object System.Text.UTF8Encoding $false))
    }
    Remove-Item -LiteralPath $DocxPath -Force
    [System.IO.Compression.ZipFile]::CreateFromDirectory($docDir, $DocxPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item -LiteralPath $tmp -Recurse -Force
}

function Set-DocxThemeFontLang {
    param([Parameter(Mandatory = $true)][string]$DocxPath)
    if (-not (Test-Path $DocxPath)) { return }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("docx-lang-" + [Guid]::NewGuid().ToString("N"))
    $docDir = Join-Path $tmp "doc"
    New-Item -ItemType Directory -Path $docDir -Force | Out-Null
    $zip = Join-Path $tmp "d.zip"
    Copy-Item -LiteralPath $DocxPath -Destination $zip -Force
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $docDir)
    $partPath = Join-Path $docDir "word\settings.xml"
    if (Test-Path $partPath) {
        $xml = [System.IO.File]::ReadAllText($partPath, [System.Text.UTF8Encoding]::new($false))
        if ($xml -match '<w:themeFontLang\s[^>]*/>') {
            $xml = [regex]::Replace(
                $xml,
                '<w:themeFontLang\s[^>]*/>',
                '<w:themeFontLang w:val="en-US" w:eastAsia="zh-CN" />'
            )
        } else {
            $xml = $xml -replace '</w:settings>', '<w:themeFontLang w:val="en-US" w:eastAsia="zh-CN" /></w:settings>'
        }
        [System.IO.File]::WriteAllText($partPath, $xml, (New-Object System.Text.UTF8Encoding $false))
    }
    Remove-Item -LiteralPath $DocxPath -Force
    [System.IO.Compression.ZipFile]::CreateFromDirectory($docDir, $DocxPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item -LiteralPath $tmp -Recurse -Force
}

function Set-DocxTocHeadingText {
    param(
        [Parameter(Mandatory = $true)][string]$DocxPath,
        [string]$Text = "目录"
    )
    if (-not (Test-Path $DocxPath)) { return }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("docx-toc-" + [Guid]::NewGuid().ToString("N"))
    $docDir = Join-Path $tmp "doc"
    New-Item -ItemType Directory -Path $docDir -Force | Out-Null
    $zip = Join-Path $tmp "d.zip"
    Copy-Item -LiteralPath $DocxPath -Destination $zip -Force
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $docDir)
    $partPath = Join-Path $docDir "word\document.xml"
    if (Test-Path $partPath) {
        $xml = [System.IO.File]::ReadAllText($partPath, [System.Text.UTF8Encoding]::new($false))
        $tocRPr = (
            '<w:rPr>' +
            '<w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:cs="Microsoft YaHei" w:hint="eastAsia" />' +
            '<w:b /><w:bCs /><w:color w:val="0070C0" /><w:sz w:val="30" /><w:szCs w:val="30" />' +
            '<w:lang w:val="en-US" w:eastAsia="zh-CN" />' +
            '</w:rPr>'
        )
        $tocPara = (
            '<w:p><w:pPr><w:pStyle w:val="TOCHeading" /></w:pPr><w:r>' +
            $tocRPr +
            '<w:t xml:space="preserve">' + $Text + '</w:t></w:r></w:p>'
        )
        if ($xml -match '(?s)<w:p><w:pPr><w:pStyle w:val="TOCHeading" /></w:pPr>.*?</w:p>') {
            $xml = [regex]::Replace(
                $xml,
                '(?s)<w:p><w:pPr><w:pStyle w:val="TOCHeading" /></w:pPr>.*?</w:p>',
                $tocPara,
                1
            )
        } else {
            foreach ($variant in @('Table of Contents', '目錄', 'Contents', 'TABLE OF CONTENTS')) {
                $escaped = [regex]::Escape($variant)
                $xml = $xml -replace ('(<w:t[^>]*>)' + $escaped + '(</w:t>)'), ('${1}' + $Text + '${2}')
            }
        }
        [System.IO.File]::WriteAllText($partPath, $xml, (New-Object System.Text.UTF8Encoding $false))
    }
    Remove-Item -LiteralPath $DocxPath -Force
    [System.IO.Compression.ZipFile]::CreateFromDirectory($docDir, $DocxPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item -LiteralPath $tmp -Recurse -Force
}

try {
    & $pandocExe @pandocArgs
    if ($LASTEXITCODE -ne 0) { throw "pandoc failed with exit code $LASTEXITCODE" }
    if (($Variant -eq 'manual' -or $Variant -eq 'tender') -and $Format -eq 'docx' -and (Test-Path $Output)) {
        Clear-DocxBodyIndent -DocxPath $Output
        Set-DocxTableLayout -DocxPath $Output
        Set-DocxPageMargins -DocxPath $Output -MarginCm 1.9
        Set-DocxThemeFontLang -DocxPath $Output
        Set-DocxTocHeadingText -DocxPath $Output -Text "目录"
    }
} finally {
    if ($tmpBuildDir -and (Test-Path $tmpBuildDir)) {
        Remove-Item -LiteralPath $tmpBuildDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
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
    Set-HtmlSidebarLayout -HtmlPath $Output
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
