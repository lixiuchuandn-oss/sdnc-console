# Compute Tower Deployment Script (PowerShell)
# Features: Auto-login with password (depends on Posh-SSH)

$ErrorActionPreference = "Stop"

# ================= Configuration Area =================
$ServerIP   = "47.111.13.103"    # <--- Target Server IP
$User       = "root"             # <--- Username
$Password   = "Cloudmap@123"     # <--- Password
$RemotePath = "/opt/compute-tower"
# ==========================================================

# --- Check and Install Posh-SSH Module ---
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Write-Warning "Posh-SSH module not found. Attempting to install (internet required)..."
    try {
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser
        Install-Module -Name Posh-SSH -Force -Scope CurrentUser -SkipPublisherCheck
        Import-Module Posh-SSH
    } catch {
        Write-Error "Failed to install Posh-SSH. Please run PowerShell as Admin and execute: Install-Module Posh-SSH"
        exit 1
    }
} else {
    Import-Module Posh-SSH
}

# --- Path Configuration ---
$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir
if ((Split-Path -Leaf $ProjectRoot) -eq "deployment") {
    $ProjectRoot = Split-Path -Parent $ProjectRoot
}

# --- Build Frontend ---
Write-Host "`n=== [1/5] Building Frontend ===" -ForegroundColor Cyan
Set-Location "$ProjectRoot\frontend"

# DEBUG: Verify source file content
Write-Host "DEBUG: Checking IPsecVPNWizard.tsx content for nat-traversal..."
$CheckFile = "src\pages\InterConnect\IPsecVPN\IPsecVPNWizard.tsx"
if (Test-Path $CheckFile) {
    $content = Get-Content $CheckFile -Raw
    if ($content -match "nat-traversal") {
        Write-Host "SUCCESS: Source file contains 'nat-traversal'" -ForegroundColor Green
    } else {
        Write-Error "CRITICAL ERROR: Source file DOES NOT contain 'nat-traversal'!"
        exit 1
    }
} else {
    Write-Error "CRITICAL ERROR: Source file not found at $CheckFile"
    exit 1
}

try {
    # Force clean build and cache
    if (Test-Path "build") { Remove-Item -Recurse -Force "build" }
    if (Test-Path "node_modules/.cache") { Remove-Item -Recurse -Force "node_modules/.cache" }
    
    npm install
    $env:CI = "false"
    $env:REACT_APP_API_URL = "" 
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} catch {
    Write-Error "Frontend build failed: $_"
    exit 1
}

# --- Build Backend ---
Write-Host "`n=== [2/5] Building Backend ===" -ForegroundColor Cyan
Set-Location "$ProjectRoot\backend"
try {
    npm install
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
} catch {
    Write-Error "Backend build failed: $_"
    exit 1
}

# --- Package ---
Write-Host "`n=== [3/5] Packaging Deployment Files ===" -ForegroundColor Cyan
$DistDir = "$ScriptDir\dist"
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# Prepare backend structure
New-Item -ItemType Directory -Force -Path "$DistDir\backend" | Out-Null
Copy-Item -Recurse "$ProjectRoot\backend\dist" "$DistDir\backend\dist"
Copy-Item "$ProjectRoot\backend\package.json" "$DistDir\backend\"
Copy-Item "$ProjectRoot\backend\package-lock.json" "$DistDir\backend\"
if (Test-Path "$ProjectRoot\backend\.env") {
    Copy-Item "$ProjectRoot\backend\.env" "$DistDir\backend\"
}

# Copy frontend build artifacts to backend public directory (sibling to dist for production structure)
New-Item -ItemType Directory -Force -Path "$DistDir\backend\public" | Out-Null
Copy-Item -Recurse "$ProjectRoot\frontend\build\*" "$DistDir\backend\public"

# CRITICAL FIX: Also copy to dist/public because compiled code might look relative to dist/src/
# If main file is at dist/src/index.js, then ../public resolves to dist/public
New-Item -ItemType Directory -Force -Path "$DistDir\backend\dist\public" | Out-Null
Copy-Item -Recurse "$ProjectRoot\frontend\build\*" "$DistDir\backend\dist\public"


# Copy config files
Copy-Item "$ScriptDir\ecosystem.config.js" "$DistDir\backend\"
Copy-Item "$ScriptDir\setup_remote.sh" "$DistDir\"

# Compress using tar (solves backslash issues on Linux)
Set-Location $DistDir
$PackageFile = "deploy-package.tar.gz"
Write-Host "Creating archive..."
tar -czf $PackageFile *
$LocalPackagePath = "$DistDir\$PackageFile"

# --- Create Remote Execution Script Locally ---
$RemoteExecScript = @"
#!/bin/bash
set -x
set -e
echo "DEBUG: Remote script started"
RemotePath="$RemotePath"
PackageFile="$PackageFile"

# Define sudo command if not root
if [ "`$EUID" -ne 0 ]; then 
  SUDO="sudo"
else
  SUDO=""
fi

# Install tar if missing (unlikely)
if ! command -v tar &> /dev/null; then
    echo 'Installing tar...'
    if command -v apt-get &> /dev/null; then
        `$SUDO apt-get update && `$SUDO apt-get install -y tar
    elif command -v yum &> /dev/null; then
        `$SUDO yum install -y tar
    fi
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Installing..."
    if command -v apt-get &> /dev/null; then
        `$SUDO apt-get update
        `$SUDO apt-get install -y curl
        if [ -n "`$SUDO" ]; then
            curl -fsSL https://deb.nodesource.com/setup_18.x | `$SUDO -E bash -
        else
            curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        fi
        `$SUDO apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | `$SUDO bash -
        `$SUDO yum install -y nodejs
    else
        echo "Unsupported package manager. Please install Node.js manually."
        exit 1
    fi
fi

`$SUDO mkdir -p $RemotePath
echo "Cleaning up old frontend files..."
$SUDO rm -rf $RemotePath/backend/public

echo "Extracting package..."
$SUDO tar -xzf /tmp/$PackageFile -C $RemotePath

# Fix permissions
`$SUDO chown -R ${User}:${User} `$RemotePath
cd `$RemotePath/backend

echo 'Installing dependencies...'
npm install --production

echo 'Starting application...'
if command -v pm2 &> /dev/null; then
    pm2 start ecosystem.config.js
    pm2 save
else
    echo 'PM2 not found. Installing global PM2...'
    `$SUDO npm install -g pm2
    pm2 start ecosystem.config.js
    pm2 save
fi

echo 'Deployment Completed'
"@

# Save script to file (using UTF8NoBOM to avoid BOM but support Chinese)
$ExecScriptPath = "$DistDir\deploy_exec.sh"
$UTF8NoBOM = New-Object System.Text.UTF8Encoding $False
$RemoteExecScriptLF = $RemoteExecScript -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($ExecScriptPath, $RemoteExecScriptLF, $UTF8NoBOM)

# --- Establish Sessions ---
Write-Host "`n=== [4/5] Connecting to remote server $ServerIP ===" -ForegroundColor Cyan
$SecurePassword = ConvertTo-SecureString $Password -AsPlainText -Force
$Cred = New-Object System.Management.Automation.PSCredential($User, $SecurePassword)

# Remove old sessions
Get-SSHSession | Remove-SSHSession
Get-SFTPSession | Remove-SFTPSession

$SSHSessionId = $null
$SFTPSessionId = $null

try {
    # 1. SSH Session (for commands)
    Write-Host "Creating SSH Session..."
    $SSHSession = New-SSHSession -ComputerName $ServerIP -Credential $Cred -AcceptKey
    $SSHSessionId = $SSHSession.SessionId
    Write-Host "SSH Session ID: $SSHSessionId"

    # 2. SFTP Session (for uploads)
    Write-Host "Creating SFTP Session..."
    $SFTPSession = New-SFTPSession -ComputerName $ServerIP -Credential $Cred
    $SFTPSessionId = $SFTPSession.SessionId
    Write-Host "SFTP Session ID: $SFTPSessionId"
    
} catch {
    Write-Error "Connection failed. Check IP, user, and password. Error: $_"
    exit 1
}

# --- Upload and Deploy ---
Write-Host "`n=== [5/5] Uploading and Deploying ===" -ForegroundColor Cyan

# 1. Upload Package
Write-Host "Uploading package via SFTP..."
if (Test-Path $LocalPackagePath) {
    Write-Host "Found local package: $LocalPackagePath"
} else {
    Write-Error "Local package not found!"
    exit 1
}

try {
    # Upload package using SFTP Session
    Write-Host "Uploading package..."
    Set-SFTPItem -SessionId $SFTPSessionId -Path $LocalPackagePath -Destination "/tmp" -Force
    
    # Upload execution script
    Write-Host "Uploading execution script..."
    Set-SFTPItem -SessionId $SFTPSessionId -Path $ExecScriptPath -Destination "/tmp" -Force
} catch {
    Write-Error "File upload failed: $_"
    if ($SSHSessionId) { Remove-SSHSession -SessionId $SSHSessionId }
    if ($SFTPSessionId) { Remove-SFTPSession -SessionId $SFTPSessionId }
    exit 1
}

# 2. Execute Remote Script
Write-Host "Executing remote deployment script..."
# Using sed to remove CR characters
$TriggerScript = "sed -i 's/\r$//' /tmp/deploy_exec.sh; chmod +x /tmp/deploy_exec.sh; bash /tmp/deploy_exec.sh"

$Result = Invoke-SSHCommand -SessionId $SSHSessionId -Command $TriggerScript -TimeOut 600

if ($null -eq $Result) {
    Write-Error "Remote command returned no result (Result is null). SSH session might be disconnected."
    if ($SSHSessionId) { Remove-SSHSession -SessionId $SSHSessionId }
    if ($SFTPSessionId) { Remove-SFTPSession -SessionId $SFTPSessionId }
    exit 1
}

# Output remote logs
if ($Result.Output) {
    $Result.Output | ForEach-Object { Write-Host $_ }
}
if ($Result.Error) { Write-Warning $Result.Error }

# Check output for success message as fallback if ExitCode is unreliable
$OutputStr = $Result.Output -join "`n"
if ($Result.ExitCode -eq 0 -or $OutputStr -match "Deployment Completed") {
    Write-Host "`n✅ SUCCESS: Deployment Completed!" -ForegroundColor Green
    Write-Host "URL: http://${ServerIP}:5001"
}

if (-not ($Result.ExitCode -eq 0 -or $OutputStr -match "Deployment Completed")) {
    Write-Warning "Full Output: $OutputStr"
    Write-Warning "Result Object: $($Result | Out-String)"
    Write-Error "Deployment script failed (Exit Code: $($Result.ExitCode))"
}

if ($SSHSessionId) { Remove-SSHSession -SessionId $SSHSessionId }
if ($SFTPSessionId) { Remove-SFTPSession -SessionId $SFTPSessionId }
