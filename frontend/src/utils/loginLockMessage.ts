/** 与后端 formatLockMessage 口径一致 */
export function formatLoginLockRemaining(remainSec: number): string {
  if (remainSec <= 0) {
    return '登录失败次数过多，账号已锁定，请稍后再试';
  }
  if (remainSec >= 60) {
    const remainMin = Math.ceil(remainSec / 60);
    return `登录失败次数过多，账号已锁定，请 ${remainMin} 分钟后再试`;
  }
  return `登录失败次数过多，账号已锁定，请 ${remainSec} 秒后再试`;
}

export function getRemainSecFromLockedUntil(lockedUntil: number): number {
  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
}

export type LoginError = Error & {
  code?: string;
  lockedUntil?: number;
  remainingAttempts?: number;
};

function parseLockedUntilMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function getLockedUntilFromLoginError(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const until = parseLockedUntilMs((error as LoginError).lockedUntil);
  if (until == null) return null;
  return getRemainSecFromLockedUntil(until) > 0 ? until : null;
}

export function getLoginErrorHint(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message.trim();
  if (!msg) return null;
  return msg;
}
