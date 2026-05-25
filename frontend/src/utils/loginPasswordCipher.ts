export type LoginPublicKeyResponse = {
  keyId: string;
  publicKey: string;
};

const INSECURE_CONTEXT_LOGIN_HINT =
  '当前页面无法使用登录加密（浏览器 Web Crypto 不可用）。请通过 HTTPS 或 localhost 访问后再登录；若必须使用 HTTP，需由管理员在后端开启 LOGIN_ALLOW_PLAINT_PASSWORD=1（仅建议开发环境）。';

function getWebCryptoSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.importKey === 'function') {
    return subtle;
  }
  throw new Error(INSECURE_CONTEXT_LOGIN_HINT);
}

function createLoginNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function pemToSpkiArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** 拉取登录 RSA 公钥；未配置时返回 null（503） */
export async function fetchLoginPublicKey(apiBase: string): Promise<LoginPublicKeyResponse | null> {
  const base = apiBase.replace(/\/$/, '');
  const res = await fetch(`${base}/api/auth/login-public-key`);
  if (res.status === 503) return null;
  if (!res.ok) {
    throw new Error('获取登录公钥失败');
  }
  const json = (await res.json()) as LoginPublicKeyResponse;
  if (!json?.publicKey || !json?.keyId) {
    throw new Error('登录公钥响应无效');
  }
  return json;
}

/** 使用 RSA-OAEP(SHA-256) 加密登录密码；Network Payload 中为 Base64 密文 */
export async function encryptLoginPassword(publicKeyPem: string, password: string): Promise<string> {
  const subtle = getWebCryptoSubtle();
  const key = await subtle.importKey(
    'spki',
    pemToSpkiArrayBuffer(publicKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );

  const payload = JSON.stringify({
    password,
    ts: Date.now(),
    nonce: createLoginNonce(),
  });

  const encrypted = await subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(payload),
  );

  return arrayBufferToBase64(encrypted);
}

export type LoginRequestBody =
  | { username: string; keyId: string; cipher: string }
  | { username: string; password: string };

/** 构建登录请求体：有公钥则加密，否则回退明文（仅后端允许时有效） */
export async function buildLoginRequestBody(
  apiBase: string,
  username: string,
  password: string,
): Promise<LoginRequestBody> {
  const trimmedUser = String(username ?? '').trim();
  const trimmedPwd = String(password ?? '').trim();
  const keyInfo = await fetchLoginPublicKey(apiBase);
  if (keyInfo?.publicKey) {
    if (!globalThis.crypto?.subtle?.importKey) {
      throw new Error(INSECURE_CONTEXT_LOGIN_HINT);
    }
    const cipher = await encryptLoginPassword(keyInfo.publicKey, trimmedPwd);
    return { username: trimmedUser, keyId: keyInfo.keyId, cipher };
  }
  return { username: trimmedUser, password: trimmedPwd };
}
