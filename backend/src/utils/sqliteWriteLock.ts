import { AppDataSource } from '../config/database';

/** SQLite 单写入端：所有 inventory / upload-task 写操作串行，避免并行 transaction 触发 COMMIT 失败 */
const SQLITE_SERIAL_WRITE_KEY = '__sqlite_serial_writes__';

const writeChains = new Map<string, Promise<void>>();

export function isSqliteDb(): boolean {
  return AppDataSource.options.type === 'sqlite';
}

export function isSqliteTransactionError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || '').toLowerCase();
  const driverCode = String(
    (e as { driverError?: { code?: string } })?.driverError?.code ||
      (e as { code?: string })?.code ||
      '',
  );
  return (
    driverCode === 'SQLITE_ERROR' ||
    msg.includes('sqlite_error') ||
    msg.includes('cannot commit') ||
    msg.includes('no transaction is active') ||
    msg.includes('cannot start a transaction') ||
    msg.includes('no such savepoint')
  );
}

export async function withSqliteWriteLock<T>(logicalKey: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = isSqliteDb() ? SQLITE_SERIAL_WRITE_KEY : logicalKey;
  const prev = writeChains.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  writeChains.set(lockKey, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (writeChains.get(lockKey) === chained) writeChains.delete(lockKey);
  }
}

export async function withSqliteTransactionRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; delayMs?: number },
): Promise<T> {
  if (!isSqliteDb()) return fn();
  const retries = opts?.retries ?? 3;
  const delayMs = opts?.delayMs ?? 150;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isSqliteTransactionError(e) || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
