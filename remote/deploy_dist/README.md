# Compute Tower Deployment Scripts

This directory contains scripts to deploy the Compute Tower application to a remote Linux server (Ubuntu/Debian recommended).

## Prerequisites

### Local Machine
- **Node.js & npm**: Required to build the project.
- **SSH Client**: `ssh` and `scp` commands must be available in your terminal (OpenSSH Client).
- **PowerShell** (for Windows) or **Bash** (for Linux/Mac/Git Bash).

### Remote Server
- A fresh or existing **Ubuntu/Debian** server.
- SSH access with a user that has `sudo` privileges.

## Usage

### 1. Server Setup (First Time Only)
If your server is fresh (no Node.js/Nginx), run the setup script on the server.
You can copy it manually or let the deploy script upload it (it's included in the package).

To run it manually:
```bash
scp deployment/setup_remote.sh user@server_ip:/tmp/
ssh user@server_ip "bash /tmp/setup_remote.sh"
```

### 2. Deployment

#### Option A: Windows (PowerShell)
Run the PowerShell script from the project root:
```powershell
.\deployment\deploy.ps1
```
Follow the prompts to enter the Server IP and Username.

#### Option B: Linux/Mac/Git Bash
Run the Bash script:
```bash
chmod +x deployment/deploy.sh
./deployment/deploy.sh
```

### 3. Nginx Configuration (First Time Only)
The deployment script uploads the application but **does not** overwrite your Nginx configuration automatically (for safety).

After deployment, log in to your server and configure Nginx:

1. **Copy the config**:
   ```bash
   sudo cp /opt/compute-tower/nginx.conf /etc/nginx/sites-available/compute-tower
   ```

2. **Enable the site**:
   ```bash
   sudo ln -s /etc/nginx/sites-available/compute-tower /etc/nginx/sites-enabled/
   ```

3. **Remove default site (optional)**:
   ```bash
   sudo rm /etc/nginx/sites-enabled/default
   ```

4. **Test and Reload**:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

## Configuration Files

- **`ecosystem.config.js`**: PM2 configuration for the backend process management.
- **`nginx.conf`**: Nginx configuration file. Modify this if you have a custom domain or SSL certificate.

## Troubleshooting

- **Permission Denied**: Ensure your SSH user has write access to `/opt/compute-tower` or use `sudo` in the scripts (the scripts try to handle this).
- **Build Errors**: Ensure you can build the project locally (`npm run build` in both frontend and backend) before deploying.
