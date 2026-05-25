import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const KEY_ID = 'login-v1';
const DATA_DIR = path.join(process.cwd(), 'data');
const DEFAULT_PRIVATE_PATH = path.join(DATA_DIR, 'login-private.pem');
const DEFAULT_PUBLIC_PATH = path.join(DATA_DIR, 'login-public.pem');

/** 密文有效窗口（毫秒） */
const CIPHER_MAX_AGE_MS = 2 * 60 * 1000;
/** nonce 去重保留时间（毫秒） */
const NONCE_TTL_MS = 5 * 60 * 1000;

type LoginCipherPayload = {
  password: string;
  ts: number;
  nonce: string;
};

let privateKeyPem: string | null = null;
let publicKeyPem: string | null = null;
let loadAttempted = false;

const usedNonces = new Map<string, number>();

function resolveKeyPath(envPath: string | undefined, fallback: string): string {
  if (!envPath?.trim()) return fallback;
  return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
}

function loadKeysOnce(): void {
  if (loadAttempted) return;
  loadAttempted = true;

  const privatePath = resolveKeyPath(process.env.LOGIN_RSA_PRIVATE_KEY_PATH, DEFAULT_PRIVATE_PATH);
  const publicPath = resolveKeyPath(process.env.LOGIN_RSA_PUBLIC_KEY_PATH, DEFAULT_PUBLIC_PATH);

  try {
    if (fs.existsSync(privatePath)) {
      privateKeyPem = fs.readFileSync(privatePath, 'utf8');
    }
  } catch {
    privateKeyPem = null;
  }

  if (process.env.LOGIN_RSA_PRIVATE_KEY?.trim()) {
    privateKeyPem = process.env.LOGIN_RSA_PRIVATE_KEY.trim();
  }

  try {
    if (fs.existsSync(publicPath)) {
      publicKeyPem = fs.readFileSync(publicPath, 'utf8');
    }
  } catch {
    publicKeyPem = null;
  }

  if (process.env.LOGIN_RSA_PUBLIC_KEY?.trim()) {
    publicKeyPem = process.env.LOGIN_RSA_PUBLIC_KEY.trim();
  }
}

export function isLoginCipherConfigured(): boolean {
  loadKeysOnce();
  return Boolean(privateKeyPem && publicKeyPem);
}

/** 开发/兼容：配置了密钥时默认仍拒绝明文；设 LOGIN_ALLOW_PLAINT_PASSWORD=1 可放开 */
export function isPlaintextLoginAllowed(): boolean {
  if (process.env.LOGIN_ALLOW_PLAINT_PASSWORD === '1') return true;
  return !isLoginCipherConfigured();
}

export function getLoginPublicKey(): { keyId: string; publicKey: string } | null {
  loadKeysOnce();
  if (!publicKeyPem) return null;
  return { keyId: KEY_ID, publicKey: publicKeyPem };
}

function purgeExpiredNonces(now: number): void {
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
}

function consumeNonce(nonce: string): boolean {
  const now = Date.now();
  purgeExpiredNonces(now);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, now + NONCE_TTL_MS);
  return true;
}

export class LoginCipherError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function decryptLoginPassword(cipherB64: string): string {
  loadKeysOnce();
  if (!privateKeyPem) {
    throw new LoginCipherError('LOGIN_CIPHER_NOT_CONFIGURED', '登录加密未配置');
  }

  let plainBuf: Buffer;
  try {
    plainBuf = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(cipherB64, 'base64'),
    );
  } catch {
    throw new LoginCipherError('LOGIN_CIPHER_INVALID', '登录凭据无效或已损坏');
  }

  let payload: LoginCipherPayload;
  try {
    payload = JSON.parse(plainBuf.toString('utf8')) as LoginCipherPayload;
  } catch {
    throw new LoginCipherError('LOGIN_CIPHER_INVALID', '登录凭据格式错误');
  }

  const password = String(payload.password ?? '').trim();
  const ts = Number(payload.ts);
  const nonce = String(payload.nonce ?? '').trim();

  if (!password || !nonce || !Number.isFinite(ts)) {
    throw new LoginCipherError('LOGIN_CIPHER_INVALID', '登录凭据不完整');
  }

  const age = Date.now() - ts;
  if (age < 0 || age > CIPHER_MAX_AGE_MS) {
    throw new LoginCipherError('LOGIN_CIPHER_EXPIRED', '登录凭据已过期，请重试');
  }

  if (!consumeNonce(nonce)) {
    throw new LoginCipherError('LOGIN_CIPHER_REPLAY', '登录凭据已使用，请重试');
  }

  return password;
}

export type ResolveLoginPasswordResult =
  | { ok: true; password: string }
  | { ok: false; status: number; message: string; code?: string };

/** 从登录请求体解析明文密码（cipher 优先） */
export function resolvePasswordFromLoginBody(body: unknown): ResolveLoginPasswordResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const cipher = String(b.cipher ?? '').trim();
  const plain = String(b.password ?? '').trim();

  if (cipher) {
    try {
      return { ok: true, password: decryptLoginPassword(cipher) };
    } catch (e) {
      if (e instanceof LoginCipherError) {
        return { ok: false, status: 400, message: e.message, code: e.code };
      }
      return { ok: false, status: 400, message: '登录凭据无效', code: 'LOGIN_CIPHER_INVALID' };
    }
  }

  if (plain && isPlaintextLoginAllowed()) {
    return { ok: true, password: plain };
  }

  if (isLoginCipherConfigured()) {
    return {
      ok: false,
      status: 400,
      message: '当前环境要求加密登录，请刷新页面后重试',
      code: 'LOGIN_CIPHER_REQUIRED',
    };
  }

  if (!plain) {
    return { ok: false, status: 400, message: '用户名和密码不能为空' };
  }

  return { ok: true, password: plain };
}

/** 测试用：重置内存态 */
export function resetLoginCipherStateForTests(): void {
  privateKeyPem = null;
  publicKeyPem = null;
  loadAttempted = false;
  usedNonces.clear();
}
