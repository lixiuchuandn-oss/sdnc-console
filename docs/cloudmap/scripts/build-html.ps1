# Cloudmap whitepaper: Markdown -> HTML preview
param(
    [ValidateSet('whitepaper', 'manual')]
    [string]$Variant = 'whitepaper',
    [string]$Output = "",
    [switch]$Open
)

& (Join-Path $PSScriptRoot "_build-doc.ps1") -Variant $Variant -Format html -Output $Output -Open:$Open
