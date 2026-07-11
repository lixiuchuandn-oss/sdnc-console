const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

module.exports = {
  webBase: process.env.TOWER_WEB_BASE || 'http://127.0.0.1:5000',
  apiBase: process.env.TOWER_API_BASE || 'http://127.0.0.1:5001',
  adminUser: process.env.TOWER_ADMIN_USER || 'admin',
  adminPassword: process.env.TOWER_ADMIN_PASSWORD || 'admin123',
};
