import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET || 'your-secret-key';
  return crypto.createHash('sha256').update(secret).digest();
}

/** 对称加密敏感配置（如云桌面网关服务账号密码） */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(cipherB64: string): string {
  const buf = Buffer.from(cipherB64, 'base64');
  if (buf.length < IV_LEN + 16 + 1) {
    throw new Error('invalid cipher');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
