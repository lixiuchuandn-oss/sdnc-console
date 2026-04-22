# Compute Tower Remote Deployment

This directory contains scripts to deploy the Compute Tower application to a remote Linux server (Ubuntu/Debian recommended) via SSH.

## Prerequisites

### Local Machine
- **Node.js & npm**: Required to build the project.
- **SSH Client**: `ssh` and `scp` commands.
- **PowerShell** (for Windows) or **Terminal** (for Linux/Mac).

### Remote Server
- **Ubuntu/Debian** server.
- SSH access with `sudo` privileges.

## Usage

### Option A: Windows (PowerShell)

Run the PowerShell script:

```powershell
.\deploy.ps1
```

### Option B: Cross-Platform (Node.js)

Run the Node.js deployment tool (works on Windows/Mac/Linux):

```bash
npm install # Install dependencies first (ssh2, etc.)
node deploy_tool.js
```

## Configuration

- **`ecosystem.config.js`**: PM2 configuration used by the remote server.
- **`setup_remote.sh`**: Script used to initialize the remote server (Node.js, PM2, Nginx).
