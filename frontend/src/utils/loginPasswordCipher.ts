export type LoginPublicKeyResponse = {
  keyId: string;
  publicKey: string;
};

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
  const key = await crypto.subtle.importKey(
    'spki',
    pemToSpkiArrayBuffer(publicKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );

  const payload = JSON.stringify({
    password,
    ts: Date.now(),
    nonce: crypto.randomUUID(),
  });

  const encrypted = await crypto.subtle.encrypt(
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
    const cipher = await encryptLoginPassword(keyInfo.publicKey, trimmedPwd);
    return { username: trimmedUser, keyId: keyInfo.keyId, cipher };
  }
  return { username: trimmedUser, password: trimmedPwd };
}
