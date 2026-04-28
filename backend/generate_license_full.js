/**
 * 生成「全量能力」离线 License JWT（与 LicenseService.verify 一致）。
 *
 * 用法（在 backend 目录下）：
 *   node generate_license_full.js [instanceId]
 *
 * - instanceId：须与目标机 `GET /api/system/license` 或 `data/install.id` 一致；缺省为下方 DEFAULT_INSTANCE_ID。
 * - 签名密钥：优先 `process.env.LICENSE_SECRET`，否则读 `backend/data/license.secret`，
 *   再否则使用仓库内历史开发密钥（仅本地联调；**生产/远端须用该机 license.secret**）。
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

/** 你提供的安装绑定 ID（与目标机 install.id 一致） */
const DEFAULT_INSTANCE_ID = '2aaf498a-f29f-4c2b-83f7-dfb5b133d6aa';

const DEV_FALLBACK_SECRET = '9g4tZ4mQiekqlyDUe4qOD4EkrN5EAYAmkBGWEXw6YaI';

function readLicenseSecret() {
  const fromEnv = process.env.LICENSE_SECRET && String(process.env.LICENSE_SECRET).trim();
  if (fromEnv) return fromEnv;
  const secretFile = path.join(__dirname, 'data', 'license.secret');
  try {
    if (fs.existsSync(secretFile)) {
      const s = fs.readFileSync(secretFile, 'utf8').trim();
      if (s) return s;
    }
  } catch {
    /* ignore */
  }
  return DEV_FALLBACK_SECRET;
}

/** 与 LicenseSettings FEATURE_MAP + RouteSpec / 池内路由 / 旧脚本能力并集（全量） */
const FULL_FEATURES = Array.from(
  new Set([
    'platform.default',
    'platform.base',
    'platform.multi-cloud',
    'platform.sdn',
    'platform.aisoc',
    'sys.dashboard',
    'sys.tenant-mgmt',
    'sys.rbac-advanced',
    'network.vpc',
    'network.kube-ovn',
    'network.ovn.vpc',
    'sdn.cascade',
    'sdn.interconnect',
    'sdn.traffic',
  ]),
).sort();

const instanceId = (process.argv[2] || process.env.INSTANCE_ID || DEFAULT_INSTANCE_ID).trim();
const secret = readLicenseSecret();

const payload = {
  iss: 'ComputeTower System',
  sub: 'Full Authorization',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 365 * 10 * 24 * 60 * 60,
  type: 'enterprise',
  features: FULL_FEATURES,
  limits: {
    maxNodes: 999999,
    maxVms: 9999999,
    maxCloudAccounts: 999999,
  },
  instanceId,
};

const token = jwt.sign(payload, secret);

console.error('[generate_license_full] instanceId:', instanceId);
console.error('[generate_license_full] features count:', FULL_FEATURES.length);
console.error('[generate_license_full] secret: env > data/license.secret > dev fallback');

console.log('--- BEGIN LICENSE KEY ---');
console.log(token);
console.log('--- END LICENSE KEY ---');
