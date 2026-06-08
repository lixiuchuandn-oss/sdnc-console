# Cloudmap whitepaper: Markdown -> Word
param(
    [ValidateSet('whitepaper', 'manual')]
    [string]$Variant = 'whitepaper',
    [string]$Output = ""
)

& (Join-Path $PSScriptRoot "_build-doc.ps1") -Variant $Variant -Format docx -Output $Output
