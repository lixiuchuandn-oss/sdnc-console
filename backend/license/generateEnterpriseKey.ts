import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

type LicenseType = 'trial' | 'standard' | 'enterprise';

const readArgValue = (name: string) => {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
};

const backendRoot = path.resolve(__dirname, '..', '..');
const dataDir = path.join(backendRoot, 'data');

const licenseSecretPath = path.join(dataDir, 'license.secret');
const loadOrCreateSecret = () => {
  if (process.env.LICENSE_SECRET) return process.env.LICENSE_SECRET;
  try {
    if (fs.existsSync(licenseSecretPath)) {
      const s = fs.readFileSync(licenseSecretPath, 'utf-8').trim();
      if (s) return s;
    }
    fs.mkdirSync(path.dirname(licenseSecretPath), { recursive: true });
    const s = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(licenseSecretPath, s, 'utf-8');
    return s;
  } catch (e: any) {
    console.error(e?.message || String(e));
    process.exit(1);
  }
};

const licenseSecret = loadOrCreateSecret();

const customerName = readArgValue('--customer') || 'Compute Tower Enterprise';
const daysRaw = readArgValue('--days') || '3650';
const typeRaw = (readArgValue('--type') || 'enterprise') as LicenseType;
const outPath = readArgValue('--out') || path.join(dataDir, 'enterprise.key');

const days = Number(daysRaw);
if (!Number.isFinite(days) || days <= 0) {
  console.error('Invalid --days');
  process.exit(1);
}

if (typeRaw !== 'trial' && typeRaw !== 'standard' && typeRaw !== 'enterprise') {
  console.error('Invalid --type');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const payload = {
  iss: 'ComputeTower Inc.',
  sub: customerName,
  iat: now,
  exp: now + days * 24 * 60 * 60,
  type: typeRaw,
  features: [
    'platform.default',
    'platform.multi-cloud',
    'platform.sdn',
    'platform.aisoc',
    'sys.tenant-mgmt',
    'sys.rbac-advanced',
    'sys.dashboard',
  ],
  limits: {
    maxNodes: 100,
    maxVms: 1000,
    maxCloudAccounts: 10,
  },
};

const token = jwt.sign(payload, licenseSecret);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, token, 'utf-8');

console.log(outPath);
console.log(licenseSecretPath);
