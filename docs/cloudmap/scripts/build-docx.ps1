# Cloudmap whitepaper: Markdown -> Word
param(
    [ValidateSet('whitepaper', 'manual')]
    [string]$Variant = 'whitepaper',
    [string]$Output = "",
    [switch]$CopyToDeployment
)

& (Join-Path $PSScriptRoot "_build-doc.ps1") -Variant $Variant -Format docx -Output $Output -CopyToDeployment:$CopyToDeployment
