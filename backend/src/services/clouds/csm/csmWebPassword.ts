import crypto from 'crypto';

/** CSM Web 控制台登录页内置 RSA 公钥（与 chunk 5181 customUserlogin 一致） */
const CSM_WEB_RSA_PUBLIC_KEY_BASE64 =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCI6IKC0hJCiD7rPzSx7VJGkNPO4TxUGaWg+lS/0gwfxbsTFZUvioP6OiSXoU9vfOT31T84QOP29ujYpXh06V+w6bfYodqtG+DW35FrECP7NGbzeIjMFU1FmDEw1RSwar5j9OhEeaZpUptIPzwNCeY6mdOqQuRqzXE9Cgm4oUiyrQIDAQAB';

const CSM_WEB_RSA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\n${CSM_WEB_RSA_PUBLIC_KEY_BASE64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;

/** RSA PKCS#1 v1.5 加密控制台密码（与 CSM 前端 JSEncrypt 输出一致，Base64） */
export function encryptCsmWebPassword(plainPassword: string): string {
  const plain = String(plainPassword ?? '');
  if (!plain) {
    throw new Error('CSM 控制台密码不能为空');
  }
  const encrypted = crypto.publicEncrypt(
    { key: CSM_WEB_RSA_PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(plain, 'utf8'),
  );
  return encrypted.toString('base64');
}

/** 判断是否为 RSA 密文（约 172 字符 Base64）；短串多为误填明文或旧 AES 占位 */
export function looksLikeCsmRsaEncryptedPassword(value: string): boolean {
  const s = String(value || '').trim();
  if (s.length < 80) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(s);
}

/** 旧版占位/无效短 Base64（如 +yNpVuicvsiBzpDpeaIq3g==），不能当作 RSA 密文或明文密码 */
function isStaleCsmEncryptedBlob(value: string): boolean {
  const s = String(value || '').trim();
  if (!s || s.length >= 80) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(s) && !/[@!#$%^&*(),.?":{}|<>]/.test(s);
}

export function resolveCsmPasswordEncrypted(config: Record<string, unknown> | undefined): string {
  const cfg = config || {};
  const plain = String(cfg.csmRepairPassword ?? '').trim();
  if (plain) {
    return encryptCsmWebPassword(plain);
  }
  const enc = String(
    cfg.csmRepairPasswordEncrypted ?? cfg.csmApiPasswordEncrypted ?? '',
  ).trim();
  if (!enc) return '';
  if (looksLikeCsmRsaEncryptedPassword(enc)) return enc;
  if (isStaleCsmEncryptedBlob(enc)) return '';
  // 用户把明文填进「密文」框时自动 RSA 加密
  return encryptCsmWebPassword(enc);
}

/** 保存前：明文 → 密文，不落库明文 */
export function normalizeCsmCloudConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config };
  const plain = String(out.csmRepairPassword ?? '').trim();
  if (plain) {
    out.csmRepairPasswordEncrypted = encryptCsmWebPassword(plain);
    delete out.csmRepairPassword;
  } else {
    const enc = String(out.csmRepairPasswordEncrypted ?? '').trim();
    if (enc && isStaleCsmEncryptedBlob(enc)) {
      delete out.csmRepairPasswordEncrypted;
    } else if (enc && !looksLikeCsmRsaEncryptedPassword(enc)) {
      out.csmRepairPasswordEncrypted = encryptCsmWebPassword(enc);
    }
  }
  delete out.csmRepairPassword;
  delete out.csmWebPort;
  delete out.csmRepairWebPort;
  return out;
}
