param(
    [string]$RefPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "templates\reference.docx")
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $RefPath)) { Write-Error "Missing: $RefPath" }
$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $doc = $word.Documents.Open((Resolve-Path $RefPath).Path, $false, $false)
    function Set-ParagraphStyle {
        param([string]$Name,[double]$FontSize,[int]$Bold=0,[double]$SpaceBefore=0,[double]$SpaceAfter=6,[int]$OutlineLevel=10)
        try {
            $s = $doc.Styles.Item($Name)
        } catch { return }
        $s.Font.Name = "微软雅黑"
        $s.Font.NameFarEast = "微软雅黑"
        $s.Font.Size = $FontSize
        $s.Font.Bold = $Bold
        $s.ParagraphFormat.SpaceBefore = $SpaceBefore
        $s.ParagraphFormat.SpaceAfter = $SpaceAfter
        $s.ParagraphFormat.OutlineLevel = $OutlineLevel
        $s.ParagraphFormat.Borders(3).LineStyle = 0
        $s.ParagraphFormat.Borders(1).LineStyle = 0
    }
    Set-ParagraphStyle -Name "Normal" -FontSize 10.5
    Set-ParagraphStyle -Name "Body Text" -FontSize 10.5
    Set-ParagraphStyle -Name "Heading 1" -FontSize 18 -Bold -1 -SpaceBefore 18 -SpaceAfter 10 -OutlineLevel 1
    Set-ParagraphStyle -Name "Heading 2" -FontSize 14 -Bold -1 -SpaceBefore 14 -SpaceAfter 8 -OutlineLevel 2
    Set-ParagraphStyle -Name "Heading 3" -FontSize 12 -Bold -1 -SpaceBefore 10 -SpaceAfter 6 -OutlineLevel 3
    Set-ParagraphStyle -Name "Heading 4" -FontSize 11 -Bold -1 -SpaceBefore 8 -SpaceAfter 4 -OutlineLevel 4
    $doc.Save()
    Write-Host "Styled reference: $RefPath" -ForegroundColor Green
} finally {
    if ($doc) { try { $doc.Close($false) } catch {} }
    if ($word) { try { $word.Quit() } catch {} }
}