function Resolve-PandocExecutable {
    $cmd = Get-Command pandoc -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [System.Environment]::GetEnvironmentVariable("Path", "User")

    $cmd = Get-Command pandoc -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Pandoc\pandoc.exe"),
        (Join-Path ${env:ProgramFiles} "Pandoc\pandoc.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}
