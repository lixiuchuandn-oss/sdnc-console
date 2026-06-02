import fs from 'fs';
import path from 'path';

/** 平台 License JWT 验签算法（部署侧仅持公钥，禁止 HS256 回退） */
export const LICENSE_JWT_ALGORITHM = 'RS256' as const;

/**
 * 与 `backend/keys/license-signing-public.pem` 一致；随产品发布内置，部署环境无需 license.secret。
 * 轮换密钥时须同步更新本常量、公钥文件，并由授权中心使用新私钥签发。
 */
const EMBEDDED_LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQE8wxy0ks86AeHzyTEt
GC7ppDaW1hoE4WtETfBke8CuXHEz0t/eKd0uTMCXDvTPswmhZ8ppv9Ck8xrtSb9Y
9zyj8b3VKSRtoVqQHTpUrTqjGhGkp1/HkQYuLx+IdzFHtu+9moaphqZFFmWiIpHn
CuBEtIdaWU2pnM1EZlIFPRkLI8gBVyhKsuz8QPgJb5jEnotJsOR7wRYRhAW/Gx1M
QEK/q+uGwWDQc4EGR4YJtjyUVOHGFpGJEfKz72nZrYZvRYlhpfANSkr3Y8PtPTs6
7/4YXJlTDsUTbezQyxYKMdYUiDq2vZfqHcSRYTmdaMfzRkUJinroAk++nN8nwEWM
BwIDAQAB
-----END PUBLIC KEY-----`;

function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n').trim();
}

function readPemIfExists(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const s = fs.readFileSync(filePath, 'utf-8').trim();
    return s || undefined;
  } catch {
    return undefined;
  }
}

/** 部署侧验签公钥（内置 + 可选环境变量/文件覆盖，仅用于运维调试） */
export function getLicenseVerifyPublicKey(): string {
  const fromEnv = process.env.LICENSE_PUBLIC_KEY_PEM?.trim();
  if (fromEnv) return normalizePem(fromEnv);

  const configured = process.env.LICENSE_PUBLIC_KEY_PATH?.trim();
  if (configured) {
    const abs = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
    const fromFile = readPemIfExists(abs);
    if (fromFile) return fromFile;
  }

  const candidates = [
    path.join(process.cwd(), 'keys', 'license-signing-public.pem'),
    path.resolve(__dirname, '../../keys/license-signing-public.pem'),
    path.resolve(__dirname, '../../../keys/license-signing-public.pem'),
  ];
  for (const p of candidates) {
    const fromFile = readPemIfExists(p);
    if (fromFile) return fromFile;
  }

  return EMBEDDED_LICENSE_PUBLIC_KEY_PEM;
}

/** 授权中心/离线签发脚本用私钥（勿部署到客户环境） */
export function getLicenseSigningPrivateKey(overridePath?: string): string {
  const fromEnv = process.env.LICENSE_SIGNING_PRIVATE_KEY_PEM?.trim();
  if (fromEnv) return normalizePem(fromEnv);

  const configured =
    overridePath?.trim() ||
    process.env.LICENSE_SIGNING_PRIVATE_KEY_PATH?.trim() ||
    path.join(process.cwd(), 'keys', 'license-signing-private.pem');

  const abs = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);

  const pem = readPemIfExists(abs);
  if (!pem) {
    throw new Error(
      `未找到 License 签发私钥：${abs}。请放置 keys/license-signing-private.pem 或设置 LICENSE_SIGNING_PRIVATE_KEY_PATH / LICENSE_SIGNING_PRIVATE_KEY_PEM`,
    );
  }
  return pem;
}
