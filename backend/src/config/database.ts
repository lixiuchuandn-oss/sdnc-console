import { DataSource } from 'typeorm';
import path from 'path';
import { logger } from '../utils/logger';
import { resolveBackendRoot } from '../utils/resolveBackendRoot';

const dbLog = logger.child('Database');

const envDb = process.env.DB_PATH?.trim();
// SQLite：显式 DB_PATH 时沿用（绝对路径直接用；相对路径相对当前工作目录）；否则用 backend 包目录下 data.sqlite
const DB_PATH = envDb
  ? path.isAbsolute(envDb)
    ? envDb
    : path.resolve(process.cwd(), envDb)
  : path.join(resolveBackendRoot(), 'data.sqlite');

dbLog.info('SQLite 使用文件:', path.resolve(DB_PATH));

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: DB_PATH,
  synchronize: process.env.DB_SYNC === 'true',
  logging: process.env.DB_LOGGING === 'true',
  extra: {
    busyTimeout: 30000,
  },
  entities: [path.join(__dirname, '..', 'entities', '**', '*.{ts,js}')],
  migrations: [],
  subscribers: [],
});

/** 启用 SQLite WAL 模式以提升并发性能 */
export async function enableWalMode() {
  try {
    if (!AppDataSource.isInitialized) {
      console.warn('[Database] 数据库未初始化，无法启用 WAL 模式');
      return;
    }
    const result = await AppDataSource.query('PRAGMA journal_mode = WAL;');
    await AppDataSource.query('PRAGMA busy_timeout = 30000;');
    dbLog.info('WAL 模式已启用:', result);
  } catch (error) {
    dbLog.warn('启用 WAL 模式失败:', error instanceof Error ? error.message : String(error));
  }
}

/** 兼容旧库：补全 users.passwordChangedAt 列 */
export async function ensureUsersPasswordChangedAtColumn() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 users.passwordChangedAt 检查');
      return;
    }
    const cols = await AppDataSource.query(`PRAGMA table_info(users)`);
    const has =
      Array.isArray(cols) && cols.some((c: { name?: string }) => c.name === 'passwordChangedAt');
    if (!has) {
      dbLog.info('为 users 表添加 passwordChangedAt 列...');
      await AppDataSource.query(`ALTER TABLE "users" ADD COLUMN "passwordChangedAt" datetime`);
      await AppDataSource.query(
        `UPDATE "users" SET "passwordChangedAt" = "createdAt" WHERE "passwordChangedAt" IS NULL`,
      );
      dbLog.info('users.passwordChangedAt 已添加并回填');
    }
  } catch (error) {
    dbLog.error(
      'users.passwordChangedAt 迁移失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
