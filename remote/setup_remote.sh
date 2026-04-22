#!/bin/bash

# This script is intended to be run on the REMOTE SERVER to prepare the environment.
# Supported OS: Ubuntu/Debian

set -e

echo "Updating system..."
sudo apt-get update

echo "Installing Node.js 18..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "Node.js is already installed."
fi

echo "Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo "PM2 is already installed."
fi

echo "Creating application directory..."
sudo mkdir -p /opt/compute-tower
sudo chown -R $USER:$USER /opt/compute-tower

echo "----------------------------------------------------------------"
echo "Server setup complete!"
echo "You can now run the deployment script from your local machine."
echo "----------------------------------------------------------------"
 