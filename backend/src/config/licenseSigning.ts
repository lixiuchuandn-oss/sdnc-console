import fs from 'fs';
import path from 'path';

/** 平台 License JWT 验签算法（部署侧仅持公钥，禁止 HS256 回退） */
export const LICENSE_JWT_ALGORITHM = 'RS256' as const;

/**
 * 与 `backend/keys/license-signing-public.pem` 一致；随产品发布内置，部署环境无需 license.secret。
 * 轮换密钥时须同步更新本常量、公钥文件，并由授权中心使用新私钥签发。
 */
const EMBEDDED_LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA83PM5u/DpgGlpELWu3eK
dsMYFFD6FlLK6F0dg5ViSjx92CKcQKcl3OzZpsA00v1DqiFIQk8X4dGz++HBh5ZK
mSsCXAKHXMjufzAYkRi9DE1Pi8ztyrDK4Gn0LmGAT8hRVuW2vwLsgCqrQlkR30F8
Rz/z6Gfw8eboqzQePcJMwpbLwWN2Epf5g8we94k4jJeGH7wSK5c7cxhprdWP0dJZ
2ASMYNhRtiDAgm/NAy5yUF5jiBd2CzEShy46E/PCNj9D8lBbudTGWuFSqKEL8yrS
H5BWXcUZyySiETB/gGd/RL76VnRYlWbtWkLeuHMgNX1jy9Ck/8KnTU0j7f28+QGJ
2QIDAQAB
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
