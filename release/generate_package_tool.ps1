# Compute Tower Offline Package Generator
# Generates a zip file containing built frontend, backend, and production node_modules.
# Note: Since this runs on Windows, native modules (sqlite3, ssh2) will be Windows versions.
#       Linux users must rebuild them or have internet access to download binaries.

$ErrorActionPreference = "Stop"

# --- Path Configuration ---
$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir
if ((Split-Path -Leaf $ProjectRoot) -eq "deployment") {
    $ProjectRoot = Split-Path -Parent $ProjectRoot
}

Write-Host "Project Root: $ProjectRoot" -ForegroundColor Gray

# --- 1. Build Frontend ---
Write-Host "`n=== [1/5] Building Frontend ===" -ForegroundColor Cyan
Set-Location "$ProjectRoot\frontend"

try {
    # Clean build artifacts
    if (Test-Path "build") { Remove-Item -Recurse -Force "build" }
    
    # Install dependencies
    Write-Host "Installing frontend dependencies..."
    npm install
    
    # Build
    Write-Host "Building frontend..."
    $env:CI = "false"
    $env:REACT_APP_API_URL = "" 
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} catch {
    Write-Error "Frontend build failed: $_"
    exit 1
}

# --- 2. Build Backend ---
Write-Host "`n=== [2/5] Building Backend ===" -ForegroundColor Cyan
Set-Location "$ProjectRoot\backend"
try {
    # Clean build artifacts
    if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }

    # Install dependencies
    Write-Host "Installing backend dependencies..."
    npm install
    
    # Build
    Write-Host "Building backend..."
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
} catch {
    Write-Error "Backend build failed: $_"
    exit 1
}

# --- 3. Prepare Package Directory ---
Write-Host "`n=== [3/5] Preparing Package Directory ===" -ForegroundColor Cyan
$PackageName = "compute-tower-offline"
$OutputDir = "$ScriptDir\output"
$PackageDir = "$OutputDir\$PackageName"

# Clean and create output dir
if (Test-Path $OutputDir) { Remove-Item -Recurse -Force $OutputDir }
New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

# Create structure
New-Item -ItemType Directory -Force -Path "$PackageDir\backend" | Out-Null

# Copy Backend Files
Write-Host "Copying backend files..."
Copy-Item -Recurse "$ProjectRoot\backend\dist" "$PackageDir\backend\dist"
Copy-Item "$ProjectRoot\backend\package.json" "$PackageDir\backend\"
Copy-Item "$ProjectRoot\backend\package-lock.json" "$PackageDir\backend\"
if (Test-Path "$ProjectRoot\backend\.env") {
    Copy-Item "$ProjectRoot\backend\.env" "$PackageDir\backend\"
}
# Copy ecosystem.config.js if exists
if (Test-Path "$ScriptDir\ecosystem.config.js") {
    Copy-Item "$ScriptDir\ecosystem.config.js" "$PackageDir\backend\"
}

# Copy Frontend Files to Backend Public
Write-Host "Copying frontend files..."
New-Item -ItemType Directory -Force -Path "$PackageDir\backend\public" | Out-Null
Copy-Item -Recurse "$ProjectRoot\frontend\build\*" "$PackageDir\backend\public"

# --- 4. Install Production Dependencies ---
Write-Host "`n=== [4/5] Installing Production Dependencies (node_modules) ===" -ForegroundColor Cyan
Set-Location "$PackageDir\backend"
try {
    Write-Host "Installing production dependencies..."
    npm install --production
} catch {
    Write-Warning "npm install failed. You may need to run 'npm install --production' on the target machine."
}

# --- 5. Generate Helper Scripts ---
Write-Host "`n=== [5/5] Generating Helper Scripts ===" -ForegroundColor Cyan

# Install Script (Linux)
$InstallScript = @'
#!/bin/bash
set -e

# Compute Tower Installer for Ubuntu
TARGET_DIR="/opt/compute-tower"
SOURCE_DIR="$(dirname "$(readlink -f "$0")")"

echo "Installing Compute Tower to $TARGET_DIR..."

# 1. Check Node
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

# 2. Stop old service
if command -v pm2 &> /dev/null; then
    pm2 stop compute-tower || true
    pm2 delete compute-tower || true
fi

# 3. Deploy Files
echo "Copying files..."
sudo mkdir -p $TARGET_DIR
sudo cp -r "$SOURCE_DIR/backend/"* $TARGET_DIR/
sudo chown -R $USER:$USER $TARGET_DIR

# 4. Fix Native Modules (Crucial for Cross-Platform)
echo "Checking native modules..."
cd $TARGET_DIR
if [ -d "node_modules" ]; then
    echo "Rebuilding native modules (sqlite3, etc.)..."
    # Try to rebuild. If offline and missing binaries, this might fail, but it's the best attempt.
    npm rebuild --build-from-source || echo "Warning: Rebuild failed. Ensure build tools are installed or internet is available if binaries are missing."
fi

# 5. Start Service
echo "Starting service..."
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2 globally..."
    sudo npm install -g pm2
fi

pm2 start ecosystem.config.js
pm2 save

echo "---------------------------------------"
echo "✅ Installation Complete!"
echo "Backend URL: http://localhost:5001"
echo "---------------------------------------"
'@

# Normalize line endings to LF for Linux script
$InstallScript = $InstallScript -replace "`r`n", "`n"
[System.IO.File]::WriteAllText("$PackageDir\install.sh", $InstallScript)

# Create Zip Archive
Write-Host "`n=== Finalizing: Creating Zip Archive ===" -ForegroundColor Cyan
$ZipFile = "$OutputDir\$PackageName.zip"
Set-Location "$OutputDir"

try {
    Compress-Archive -Path "$PackageName" -DestinationPath $ZipFile -Force
    Write-Host "✅ Offline Package Generated Successfully!" -ForegroundColor Green
    Write-Host "Location: $ZipFile"
} catch {
    Write-Error "Compression failed: $_"
}
