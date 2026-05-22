import { getAdminAuthConfig } from './adminAuthConfig';

type LockoutEntry = {
  /** 统计周期内的失败时间戳（毫秒） */
  failures: number[];
  /** 锁定截止时间（毫秒） */
  lockedUntil?: number;
};

const lockoutStore = new Map<string, LockoutEntry>();

function normalizeLoginKey(username: string): string {
  return String(username || '').trim().toLowerCase();
}

function getEntry(key: string): LockoutEntry {
  let entry = lockoutStore.get(key);
  if (!entry) {
    entry = { failures: [] };
    lockoutStore.set(key, entry);
  }
  return entry;
}

function pruneFailures(entry: LockoutEntry, windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  entry.failures = entry.failures.filter((t) => t > cutoff);
}

export function getLockRemainingSeconds(lockedUntil: number): number {
  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
}

export function formatLockMessage(lockedUntil: number): string {
  const remainSec = getLockRemainingSeconds(lockedUntil);
  if (remainSec <= 0) {
    return '登录失败次数过多，账号已锁定，请稍后再试';
  }
  if (remainSec >= 60) {
    const remainMin = Math.ceil(remainSec / 60);
    return `登录失败次数过多，账号已锁定，请 ${remainMin} 分钟后再试`;
  }
  return `登录失败次数过多，账号已锁定，请 ${remainSec} 秒后再试`;
}

function lockPayload(lockedUntil: number) {
  return {
    message: formatLockMessage(lockedUntil),
    lockedUntil,
    retryAfterSeconds: getLockRemainingSeconds(lockedUntil),
  };
}

/** 登录前检查是否处于锁定窗口 */
export type LoginLockInfo = {
  message: string;
  lockedUntil: number;
  retryAfterSeconds: number;
};

export function checkLoginLockout(
  username: string,
): ({ locked: true } & LoginLockInfo) | { locked: false } {
  const key = normalizeLoginKey(username);
  if (!key) return { locked: false };

  const entry = getEntry(key);
  const now = Date.now();

  if (entry.lockedUntil != null && entry.lockedUntil > now) {
    return { locked: true, ...lockPayload(entry.lockedUntil) };
  }

  if (entry.lockedUntil != null && entry.lockedUntil <= now) {
    entry.lockedUntil = undefined;
    entry.failures = [];
  }

  return { locked: false };
}

/** 记录一次登录失败；达到阈值时写入锁定截止时间 */
export function recordLoginFailure(
  username: string,
): ({ locked: true } & LoginLockInfo) | { locked: false; remainingAttempts: number } {
  const config = getAdminAuthConfig();
  const key = normalizeLoginKey(username);
  if (!key) {
    return { locked: false, remainingAttempts: config.maxLoginAttempts };
  }

  const entry = getEntry(key);
  const windowMs = config.loginFailureWindowMinutes * 60_000;
  const lockMs = config.loginLockDurationMinutes * 60_000;

  pruneFailures(entry, windowMs);
  entry.failures.push(Date.now());

  if (entry.failures.length >= config.maxLoginAttempts) {
    entry.lockedUntil = Date.now() + lockMs;
    return { locked: true, ...lockPayload(entry.lockedUntil) };
  }

  const remainingAttempts = Math.max(0, config.maxLoginAttempts - entry.failures.length);
  return { locked: false, remainingAttempts };
}

/** 登录成功后清除该用户名的失败记录与锁定 */
export function clearLoginFailures(username: string): void {
  const key = normalizeLoginKey(username);
  if (key) lockoutStore.delete(key);
}

/** 测试用：清空内存状态 */
export function resetLoginLockoutStoreForTests(): void {
  lockoutStore.clear();
}
