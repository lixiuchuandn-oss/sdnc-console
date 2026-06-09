# Cloudmap whitepaper: Markdown -> Word
param(
    [ValidateSet('whitepaper', 'manual', 'tender')]
    [string]$Variant = 'whitepaper',
    [string]$Output = "",
    [string]$DocRoot = "",
    [string]$Name = ""
)

& (Join-Path $PSScriptRoot "_build-doc.ps1") -Variant $Variant -Format docx -Output $Output -DocRoot $DocRoot -Name $Name
