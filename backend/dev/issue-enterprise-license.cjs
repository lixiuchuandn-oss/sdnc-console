const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const ALL_FEATURES = [
  'platform.default',
  'sys.rbac-advanced',
  'sys.dashboard',
  'sys.tenant-mgmt',
  'platform.multi-cloud',
  'network.ovn.vpc',
  'platform.sdn',
  'sdn.cascade',
  'sdn.interconnect',
  'sdn.traffic',
  'platform.aisoc',
];

const DATA_DIR = path.join(__dirname, '..', 'data');
const INSTALL_ID_FILE = path.join(DATA_DIR, 'install.id');
const LICENSE_FILE = path.join(DATA_DIR, 'license.key');

function readPrivateKey() {
  const candidates = [
    process.env.LICENSE_SIGNING_PRIVATE_KEY_PATH,
    path.join(__dirname, '..', 'keys', 'license-signing-private.pem'),
    path.join(__dirname, '..', 'keys', 'license-signing-private-new.pem'),
  ].filter(Boolean);
  for (const p of candidates) {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8');
  }
  throw new Error('No license signing private key found under backend/keys/');
}

function readPublicKey() {
  return fs.readFileSync(path.join(__dirname, '..', 'keys', 'license-signing-public.pem'), 'utf8');
}

function getInstallId() {
  if (process.env.TOWER_INSTALL_ID) return process.env.TOWER_INSTALL_ID.trim();
  const v = fs.readFileSync(INSTALL_ID_FILE, 'utf8').trim();
  if (!v) throw new Error('empty install.id');
  return v;
}

async function activateViaApi(apiBase, licenseKey) {
  const loginRes = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const login = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !login.token) throw new Error(login.message || `login ${loginRes.status}`);
  const actRes = await fetch(`${apiBase}/api/system/license/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ licenseKey }),
  });
  const act = await actRes.json().catch(() => ({}));
  if (!actRes.ok) throw new Error(act.message || `activate ${actRes.status}`);
  return act;
}

async function main() {
  const instanceId = getInstallId();
  const privateKey = readPrivateKey();
  const publicKey = readPublicKey();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'ComputeTower Dev',
    sub: 'Manual Screenshot Dev',
    iat: now,
    exp: now + 365 * 24 * 60 * 60 * 3,
    type: 'enterprise',
    features: ALL_FEATURES,
    limits: { maxNodes: 9999, maxVms: 999999, maxCloudAccounts: 999 },
    instanceId,
  };
  const licenseKey = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  jwt.verify(licenseKey, publicKey, { algorithms: ['RS256'] });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LICENSE_FILE, licenseKey, 'utf8');
  console.log('installId:', instanceId);
  console.log('wrote', LICENSE_FILE);
  console.log('features:', ALL_FEATURES.length);
  if (process.argv.includes('--activate')) {
    const apiBase = (process.env.TOWER_API_BASE || 'http://127.0.0.1:5001').replace(/\/$/, '');
    const status = await activateViaApi(apiBase, licenseKey);
    console.log('activated:', status.status, status.message);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });