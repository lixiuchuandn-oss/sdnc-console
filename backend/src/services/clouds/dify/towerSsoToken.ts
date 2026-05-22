import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export type TowerDifySsoClaims = {
  sub: string;
  email: string;
  iss?: string;
  aud?: string;
  jti: string;
};

export function signTowerDifySsoToken(
  claims: Omit<TowerDifySsoClaims, 'jti'> & { jti?: string },
  secret: string,
  expiresInSeconds = 60,
): string {
  const payload: Record<string, string> = {
    sub: claims.sub,
    email: claims.email,
    jti: claims.jti || crypto.randomUUID(),
  };
  if (claims.iss?.trim()) payload.iss = claims.iss.trim();
  if (claims.aud?.trim()) payload.aud = claims.aud.trim();
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

export function normalizeDifyConsoleUrl(raw: string): string {
  const u = raw.trim().replace(/\/+$/, '');
  if (!u) throw new Error('Dify 控制台地址为空');
  return u;
}

export function buildTowerDifyCallbackUrl(
  difyConsoleUrl: string,
  token: string,
  returnUrl?: string,
): string {
  const base = normalizeDifyConsoleUrl(difyConsoleUrl);
  const params = new URLSearchParams({ token });
  if (returnUrl?.trim()) {
    params.set('return_url', returnUrl.trim());
  }
  return `${base}/console/api/auth/tower/callback?${params.toString()}`;
}
