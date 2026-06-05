# Build Cloudmap manual Word reference template (fonts, heading blue, body, tables, links).
# Run before: .\scripts\build-docx.ps1 -Variant manual
param(
    [string]$RefPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "templates\reference.docx"),
    [switch]$Regenerate
)

$ErrorActionPreference = "Stop"
$BodyFontName = "SimSun"
$HeadingFontName = "Microsoft YaHei"
$HeadingColor = "0070C0"
$TableHeaderFill = "F2F2F2"
$TableBorderColor = "D0D0D0"
# Page margins: 1.9 cm on all sides (OOXML twips: 1 cm = 1440/2.54)
$PageMarginTwips = [string]([int][Math]::Round(1.9 / 2.54 * 1440))
# Body: 五号 (10.5pt), 1.5 line spacing, 0.5 line after
$BodySzHalfPt = "21"
$BodySpacingPr = '<w:spacing w:afterLines="50" w:line="360" w:lineRule="auto" />'

if ($Regenerate -or -not (Test-Path $RefPath)) {
    $pandoc = Get-Command pandoc -ErrorAction SilentlyContinue
    if (-not $pandoc) { Write-Error "pandoc not found" }
    & pandoc -o $RefPath --print-default-data-file reference.docx
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ref-patch-" + [Guid]::NewGuid().ToString("N"))
$docDir = Join-Path $tmp "doc"
New-Item -ItemType Directory -Path $docDir -Force | Out-Null
$zipCopy = Join-Path $tmp "ref.zip"
Copy-Item -LiteralPath $RefPath -Destination $zipCopy -Force
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipCopy, $docDir)

function New-FontTag([string]$Name) {
    return '<w:rFonts w:ascii="' + $Name + '" w:eastAsia="' + $Name + '" w:hAnsi="' + $Name + '" w:cs="' + $Name + '" />'
}
$bodyFontTag = New-FontTag $BodyFontName
$headingFontTag = New-FontTag $HeadingFontName
$bodySz = '<w:sz w:val="' + $BodySzHalfPt + '" /><w:szCs w:val="' + $BodySzHalfPt + '" />'
$headingColorTag = '<w:color w:val="' + $HeadingColor + '" />'

$stylesPath = Join-Path $docDir "word\styles.xml"
$text = [System.IO.File]::ReadAllText($stylesPath, [System.Text.Encoding]::UTF8)

# Fonts + drop theme colors on runs (body font; headings patched below)
$text = [regex]::Replace($text, '<w:rFonts\s+[^>]*/>', $bodyFontTag)
$text = [regex]::Replace($text, '(?s)<w:color\s+w:val="[^"]*"\s+w:themeColor[^/]*/>', '<w:color w:val="000000" />')

# docDefaults: SimSun 五号, 1.5 line, 0.5 line after, no indent (incl. lists)
$bodyInd = '<w:ind w:left="0" w:right="0" w:firstLine="0" w:firstLineChars="0" w:hanging="0" />'
$bodyPPr = '<w:pPr>' + $BodySpacingPr + $bodyInd + '</w:pPr>'
$text = [regex]::Replace(
    $text,
    '(?s)<w:pPrDefault>\s*<w:pPr>.*?</w:pPr>\s*</w:pPrDefault>',
    ('<w:pPrDefault>' + $bodyPPr + '</w:pPrDefault>')
)
$text = [regex]::Replace(
    $text,
    '(?s)<w:rPrDefault>\s*<w:rPr>.*?</w:rPr>\s*</w:rPrDefault>',
    '<w:rPrDefault><w:rPr>' + $bodyFontTag + $bodySz +
    '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA" /></w:rPr></w:rPrDefault>'
)

# Normal paragraph style (replace whole style to avoid duplicate pPr/rPr from re-runs)
$text = [regex]::Replace(
    $text,
    '(?s)<w:style w:type="paragraph" w:default="1" w:styleId="Normal">.*?</w:style>',
    @"
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal" />
    <w:qFormat />
    $bodyPPr
    <w:rPr>$bodyFontTag$bodySz</w:rPr>
  </w:style>
"@.Trim(),
    1
)
# Strip bold from non-heading paragraph/character styles in template
$text = [regex]::Replace($text, '(?s)(<w:style w:type="paragraph"[^>]*w:styleId="(?!Heading)[^"]*"[^>]*>.*?<w:rPr>.*?)<w:b\s*/>(.*?</w:rPr>)', '${1}${2}')
$text = [regex]::Replace($text, '(?s)(<w:style w:type="paragraph"[^>]*w:styleId="(?!Heading)[^"]*"[^>]*>.*?<w:rPr>.*?)<w:bCs\s*/>(.*?</w:rPr>)', '${1}${2}')
$text = [regex]::Replace(
    $text,
    '(?s)<w:rPrDefault>\s*<w:rPr>.*?</w:rPr>\s*</w:rPrDefault>',
    '<w:rPrDefault><w:rPr>' + $bodyFontTag + $bodySz +
    '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA" /></w:rPr></w:rPrDefault>'
)

# Body Text / Compact / list-like styles: same spacing, zero indent
foreach ($sid in @('BodyText', 'Compact', 'FirstParagraph', 'BlockText', 'Quote', 'ListParagraph')) {
    if ($text -match ('w:styleId="' + $sid + '"')) {
        $text = [regex]::Replace(
            $text,
            '(?s)(<w:style w:type="paragraph"[^>]*w:styleId="' + $sid + '"[^>]*>.*?)<w:pPr>.*?</w:pPr>',
            ('${1}' + $bodyPPr),
            1
        )
    }
}

$numberingPath = Join-Path $docDir "word\numbering.xml"
if (Test-Path $numberingPath) {
    $num = [System.IO.File]::ReadAllText($numberingPath, [System.Text.Encoding]::UTF8)
    $num = $num -replace 'w:numFmt w:val="bullet"', 'w:numFmt w:val="decimal"'
    $num = [regex]::Replace($num, '<w:ind w:left="[^"]*"\s+w:hanging="[^"]*"\s*/>', '<w:ind w:left="0" w:hanging="0" w:firstLine="0" />')
    [System.IO.File]::WriteAllText($numberingPath, $num, (New-Object System.Text.UTF8Encoding $false))
}

# Replace pPr/rPr inside a single named style, bounded so the regex never crosses
# into a neighbouring <w:style> (which the older unbounded patterns could do for a
# style that defines no pPr/rPr of its own).
function Set-StylePPrRPr {
    param([string]$Xml, [string]$StyleId, [string]$PPr, [string]$RPr)
    $pattern = '(?s)(<w:style [^>]*w:styleId="' + [regex]::Escape($StyleId) + '"[^>]*>)((?:(?!</w:style>).)*)(</w:style>)'
    $m = [regex]::Match($Xml, $pattern)
    if (-not $m.Success) { return $Xml }
    $inner = $m.Groups[2].Value
    if ($PPr) {
        if ($inner -match '(?s)<w:pPr>.*?</w:pPr>') {
            $inner = [regex]::Replace($inner, '(?s)<w:pPr>.*?</w:pPr>', $PPr, 1)
        } elseif ($inner -match '<w:pPr\s*/>') {
            $inner = [regex]::Replace($inner, '<w:pPr\s*/>', $PPr, 1)
        } elseif ($inner -match '(?s)<w:rPr>') {
            $inner = [regex]::Replace($inner, '(?s)<w:rPr>', ($PPr + '<w:rPr>'), 1)
        } else {
            $inner = $inner + $PPr
        }
    }
    if ($RPr) {
        if ($inner -match '(?s)<w:rPr>.*?</w:rPr>') {
            $inner = [regex]::Replace($inner, '(?s)<w:rPr>.*?</w:rPr>', $RPr, 1)
        } elseif ($inner -match '<w:rPr\s*/>') {
            $inner = [regex]::Replace($inner, '<w:rPr\s*/>', $RPr, 1)
        } else {
            $inner = $inner + $RPr
        }
    }
    return $Xml.Substring(0, $m.Groups[2].Index) + $inner + $Xml.Substring($m.Groups[2].Index + $m.Groups[2].Length)
}

# Headings: Microsoft YaHei, blue bold; single line; Chinese sizes (half-points)
# 小二=18pt/36, 小三=15pt/30, 四号=14pt/28, 小四=12pt/24
# Per-level spacing (twips) gives a clear visual hierarchy; keepNext/keepLines stop
# a heading from being orphaned at the bottom of a page.
function Patch-HeadingStyle {
    param([string]$Xml, [string]$StyleId, [string]$Sz, [string]$SpacingPr)
    $rPrBlock = @"
    <w:rPr>
      $headingFontTag
      $headingColorTag
      <w:b />
      <w:bCs />
      <w:sz w:val="$Sz" />
      <w:szCs w:val="$Sz" />
    </w:rPr>
"@
    $headingPPr = '<w:pPr><w:keepNext /><w:keepLines />' + $SpacingPr + '</w:pPr>'
    if ($Xml -match ('(?s)<w:style w:type="paragraph"[^>]*w:styleId="' + $StyleId + '"[^>]*>.*?<w:pPr>')) {
        $Xml = [regex]::Replace(
            $Xml,
            ('(?s)(<w:style w:type="paragraph"[^>]*w:styleId="' + $StyleId + '"[^>]*>.*?)<w:pPr>.*?</w:pPr>'),
            ('${1}' + $headingPPr),
            1
        )
    } else {
        $Xml = [regex]::Replace(
            $Xml,
            ('(?s)(<w:style w:type="paragraph"[^>]*w:styleId="' + $StyleId + '"[^>]*>.*?<w:qFormat\s*/>)'),
            ('${1}' + $headingPPr),
            1
        )
    }
    $Xml = [regex]::Replace(
        $Xml,
        '(?s)(<w:style w:type="paragraph"[^>]*w:styleId="' + $StyleId + '"[^>]*>.*?)<w:rPr>.*?</w:rPr>',
        ('$1' + $rPrBlock),
        1
    )
    $Xml = $Xml -replace '(<w:style w:type="paragraph"[^>]*w:styleId="' + $StyleId + '"[^>]*>)', {
        param($m)
        $m.Value -replace '<w:semiHidden />', '' -replace '<w:semiHidden/>', ''
    }
    return $Xml
}

# before/after in twips (20 twips = 1pt). H1 starts on a fresh page so it needs no
# space before; lower levels get progressively smaller gaps.
$text = Patch-HeadingStyle $text 'Heading1' '36' '<w:spacing w:before="0" w:after="240" w:line="240" w:lineRule="auto" />'
$text = Patch-HeadingStyle $text 'Heading2' '30' '<w:spacing w:before="360" w:after="120" w:line="240" w:lineRule="auto" />'
$text = Patch-HeadingStyle $text 'Heading3' '28' '<w:spacing w:before="300" w:after="80" w:line="240" w:lineRule="auto" />'
$text = Patch-HeadingStyle $text 'Heading4' '24' '<w:spacing w:before="240" w:after="60" w:line="240" w:lineRule="auto" />'

# Remove orphan w:spacing left by older patches (siblings after </w:pPr>)
foreach ($sid in @('Heading1', 'Heading2', 'Heading3', 'Heading4')) {
    $text = [regex]::Replace(
        $text,
        ('(?s)(<w:style w:type="paragraph"[^>]*w:styleId="' + $sid + '"[^>]*>.*?</w:pPr>)\s*(?:<w:spacing[^>]*/>\s*)+'),
        '$1',
        1
    )
}

# Heading char styles (TOC etc.)
foreach ($pair in @(
    @{ Id = 'Heading1Char'; Sz = '36' },
    @{ Id = 'Heading2Char'; Sz = '30' },
    @{ Id = 'Heading3Char'; Sz = '28' },
    @{ Id = 'Heading4Char'; Sz = '24' }
)) {
    $text = [regex]::Replace(
        $text,
        '(?s)(<w:style w:type="character"[^>]*w:styleId="' + $pair.Id + '"[^>]*>.*?)<w:rPr>.*?</w:rPr>',
        ('$1<w:rPr>' + $headingFontTag + $headingColorTag + '<w:b /><w:bCs /><w:sz w:val="' + $pair.Sz + '" /><w:szCs w:val="' + $pair.Sz + '" /></w:rPr>'),
        1
    )
}

# TOC heading ("目录"): same blue YaHei look as a section title, with space below.
$tocHeadingRPr = '<w:rPr>' + $headingFontTag + $headingColorTag + '<w:b /><w:bCs /><w:sz w:val="30" /><w:szCs w:val="30" /></w:rPr>'
$tocHeadingPPr = '<w:pPr><w:keepNext /><w:keepLines /><w:spacing w:before="0" w:after="240" w:line="240" w:lineRule="auto" /></w:pPr>'
$text = Set-StylePPrRPr -Xml $text -StyleId 'TOCHeading' -PPr $tocHeadingPPr -RPr $tocHeadingRPr

# Captions (figure/table): centered, grey, slightly smaller (小五 = 9pt/18).
# Only the base Caption needs the run props; ImageCaption inherits from it.
$captionRPr = '<w:rPr>' + $bodyFontTag + '<w:color w:val="595959" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr>'
$captionPPr = '<w:pPr><w:keepNext /><w:spacing w:before="60" w:after="120" w:line="240" w:lineRule="auto" /><w:jc w:val="center" /></w:pPr>'
$text = Set-StylePPrRPr -Xml $text -StyleId 'Caption' -PPr $captionPPr -RPr $captionRPr
$text = Set-StylePPrRPr -Xml $text -StyleId 'TableCaption' -PPr $captionPPr -RPr ''

# Inline code / menu paths (`多云管理 > 云主机`): monospace ASCII + light shading box.
$verbatimRPr = '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas" w:eastAsia="' + $BodyFontName + '" />' + $bodySz + '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2" /></w:rPr>'
$text = Set-StylePPrRPr -Xml $text -StyleId 'VerbatimChar' -PPr '' -RPr $verbatimRPr

# Numbered list body (export from manual-body-format.lua): 2-char hang indent
$listInd = '<w:ind w:left="420" w:hanging="420" w:firstLine="0" w:firstLineChars="0" />'
$listPPr = '<w:pPr>' + $BodySpacingPr + $listInd + '</w:pPr>'
$listStyle = @"
  <w:style w:type="paragraph" w:customStyle="1" w:styleId="ManualListItem">
    <w:name w:val="Manual List Item" />
    <w:basedOn w:val="Normal" />
    <w:qFormat />
    $listPPr
    <w:rPr>$bodyFontTag$bodySz</w:rPr>
  </w:style>
"@
if ($text -notmatch 'w:styleId="ManualListItem"') {
    $text = $text -replace '</w:styles>', ($listStyle + '</w:styles>')
}

# Hyperlink: blue + underline (like reference manual cross-refs)
$text = [regex]::Replace(
    $text,
    '(?s)(<w:style w:type="character" w:styleId="Hyperlink">.*?<w:rPr>)',
    '$1' + $bodyFontTag + $headingColorTag + '<w:u w:val="single" />',
    1
)

# Table: grey header row, light grid borders
$tableBorder = @"
<w:top w:val="single" w:sz="4" w:space="0" w:color="$TableBorderColor"/>
<w:left w:val="single" w:sz="4" w:space="0" w:color="$TableBorderColor"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="$TableBorderColor"/>
<w:right w:val="single" w:sz="4" w:space="0" w:color="$TableBorderColor"/>
"@
$tableFirstRow = @"
    <w:tblStylePr w:type="firstRow">
      <w:rPr><w:b/><w:bCs/></w:rPr>
      <w:tcPr>
        <w:shd w:val="clear" w:color="auto" w:fill="$TableHeaderFill"/>
        <w:tcBorders>$tableBorder</w:tcBorders>
        <w:vAlign w:val="center"/>
      </w:tcPr>
    </w:tblStylePr>
    <w:tblStylePr w:type="wholeTable">
      <w:tcPr>
        <w:tcBorders>$tableBorder</w:tcBorders>
        <w:vAlign w:val="top"/>
      </w:tcPr>
      <w:pPr>$BodySpacingPr</w:pPr>
    </w:tblStylePr>
"@
$text = [regex]::Replace(
    $text,
    '(?s)<w:tblStylePr w:type="firstRow">.*?</w:tblStylePr>',
    $tableFirstRow.Trim(),
    1
)

$themePath = Join-Path $docDir "word\theme\theme1.xml"
if (Test-Path $themePath) {
    $theme = [System.IO.File]::ReadAllText($themePath, [System.Text.Encoding]::UTF8)
    $theme = $theme -replace '<a:latin typeface="[^"]*"', ('<a:latin typeface="' + $BodyFontName + '"')
    $theme = $theme -replace '<a:ea typeface="[^"]*"', ('<a:ea typeface="' + $BodyFontName + '"')
    $theme = $theme -replace '<a:cs typeface="[^"]*"', ('<a:cs typeface="' + $BodyFontName + '"')
    [System.IO.File]::WriteAllText($themePath, $theme, (New-Object System.Text.UTF8Encoding $false))
}

[System.IO.File]::WriteAllText($stylesPath, $text, (New-Object System.Text.UTF8Encoding $false))

function Set-OoxmlPageMargins {
    param([string]$Xml, [string]$MarginTwips)
    $pgMar = '<w:pgMar w:top="' + $MarginTwips + '" w:right="' + $MarginTwips + '" w:bottom="' + $MarginTwips + '" w:left="' + $MarginTwips + '" w:header="708" w:footer="708" w:gutter="0"/>'
    if ($Xml -match '<w:pgMar\s') {
        return [regex]::Replace($Xml, '<w:pgMar\s[^>]*/>', $pgMar)
    }
    return [regex]::Replace($Xml, '<w:sectPr>', ('<w:sectPr>' + $pgMar))
}

# Footer with centred page number ("- N -"). Pandoc copies the reference doc's
# footer parts and the sectPr footerReference into the generated document.
$footerRelId = "rIdManualFooter"
$footerXml = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="center" />
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto" />
      <w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun" /><w:color w:val="808080" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr>
    </w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun" /><w:color w:val="808080" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr><w:t xml:space="preserve">- </w:t></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun" /><w:color w:val="808080" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr><w:fldChar w:fldCharType="begin" /></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun" /><w:color w:val="808080" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun" /><w:color w:val="808080" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr><w:fldChar w:fldCharType="end" /></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun" w:cs="SimSun" /><w:color w:val="808080" /><w:sz w:val="18" /><w:szCs w:val="18" /></w:rPr><w:t xml:space="preserve"> -</w:t></w:r>
  </w:p>
</w:ftr>
'@
$footerPath = Join-Path $docDir "word\footer1.xml"
[System.IO.File]::WriteAllText($footerPath, $footerXml, (New-Object System.Text.UTF8Encoding $false))

$ctPath = Join-Path $docDir "[Content_Types].xml"
if (Test-Path -LiteralPath $ctPath) {
    $ct = [System.IO.File]::ReadAllText($ctPath, [System.Text.Encoding]::UTF8)
    if ($ct -notmatch '/word/footer1\.xml') {
        $footerOverride = '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" />'
        $ct = $ct -replace '</Types>', ($footerOverride + '</Types>')
        [System.IO.File]::WriteAllText($ctPath, $ct, (New-Object System.Text.UTF8Encoding $false))
    }
}

$relsPath = Join-Path $docDir "word\_rels\document.xml.rels"
if (Test-Path -LiteralPath $relsPath) {
    $rels = [System.IO.File]::ReadAllText($relsPath, [System.Text.Encoding]::UTF8)
    if ($rels -notmatch [regex]::Escape($footerRelId)) {
        $footerRel = '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Id="' + $footerRelId + '" Target="footer1.xml" />'
        $rels = $rels -replace '</Relationships>', ($footerRel + '</Relationships>')
        [System.IO.File]::WriteAllText($relsPath, $rels, (New-Object System.Text.UTF8Encoding $false))
    }
}

$documentPath = Join-Path $docDir "word\document.xml"
if (Test-Path $documentPath) {
    $docXml = [System.IO.File]::ReadAllText($documentPath, [System.Text.Encoding]::UTF8)
    $docXml = Set-OoxmlPageMargins -Xml $docXml -MarginTwips $PageMarginTwips
    if ($docXml -notmatch '<w:pgSz\s') {
        $docXml = [regex]::Replace($docXml, '<w:sectPr>', ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'), 1)
    }
    # footerReference must precede pgSz/pgMar in the sectPr (schema order)
    if ($docXml -notmatch 'w:footerReference') {
        $footerRef = '<w:footerReference w:type="default" r:id="' + $footerRelId + '" />'
        $docXml = [regex]::Replace($docXml, '<w:sectPr>', ('<w:sectPr>' + $footerRef), 1)
    }
    [System.IO.File]::WriteAllText($documentPath, $docXml, (New-Object System.Text.UTF8Encoding $false))
}

if (Test-Path $RefPath) { Remove-Item -LiteralPath $RefPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($docDir, $RefPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item -LiteralPath $tmp -Recurse -Force
Write-Host "Reference template: body $BodyFontName 五号/1.5倍行距, margins 1.9cm, headings $HeadingFontName #$HeadingColor -> $RefPath" -ForegroundColor Green
