import { DataSource } from 'typeorm';
import path from 'path';

// SQLite 数据库文件路径，可通过环境变量 DB_PATH 覆盖
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data.sqlite');

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: DB_PATH,
  // 生产环境禁用自动同步，使用迁移文件管理数据库结构
  // 但为了测试机部署方便，允许通过环境变量 DB_SYNC=true 强制开启同步
  synchronize: process.env.DB_SYNC === 'true',
  logging: process.env.NODE_ENV === 'development',
  // SQLite 配置：
  // - 设置 busy timeout 为 5 秒，避免数据库锁定问题
  // - 启用 WAL (Write-Ahead Logging) 模式，提升并发读写性能
  // - WAL 模式允许多个读取器和一个写入器同时工作，减少锁定冲突
  extra: {
    busyTimeout: 5000, // 5 秒超时
  },
  // 同时支持 ts-node 运行和编译后的 js 文件
  entities: [path.join(__dirname, '..', 'entities', '**', '*.{ts,js}')],
  migrations: [],
  subscribers: [],
});

/**
 * 启用 SQLite WAL 模式以提升并发性能
 * 应该在数据库连接初始化后调用
 */
export async function enableWalMode() {
  try {
    if (!AppDataSource.isInitialized) {
      console.warn('[Database] 数据库未初始化，无法启用 WAL 模式');
      return;
    }
    const result = await AppDataSource.query('PRAGMA journal_mode = WAL;');
    console.log('[Database] WAL 模式已启用:', result);
  } catch (error) {
    console.warn('[Database] 启用 WAL 模式失败:', error);
  }
}

/**
 * 确保回收站相关表存在，如果不存在则创建
 */
export async function ensureRecycleBinTables() {
  try {
    if (!AppDataSource.isInitialized) {
      console.warn('[Database] 数据库未初始化，无法创建回收站表');
      return;
    }

    // 检查表是否存在
    const tableExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='recycle_bin_shutdown_records'`
    );

    if (tableExists.length === 0) {
      console.log('[Database] 创建回收站关机记录表...');
      
      // 创建表
      await AppDataSource.query(`
        CREATE TABLE "recycle_bin_shutdown_records" (
          "id" varchar PRIMARY KEY NOT NULL,
          "cloudId" varchar NOT NULL,
          "cloudName" varchar NOT NULL,
          "namespace" varchar NOT NULL,
          "name" varchar NOT NULL,
          "instanceId" varchar NOT NULL,
          "uid" varchar NOT NULL,
          "shutdownAt" datetime NOT NULL,
          "status" varchar NOT NULL,
          "errorMessage" varchar,
          "previousStatus" varchar,
          "taskId" varchar
        )
      `);

      // 创建索引
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_cloudId_namespace_name" 
        ON "recycle_bin_shutdown_records" ("cloudId", "namespace", "name")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_shutdownAt" 
        ON "recycle_bin_shutdown_records" ("shutdownAt")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_status" 
        ON "recycle_bin_shutdown_records" ("status")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_cloudId" 
        ON "recycle_bin_shutdown_records" ("cloudId")
      `);

      console.log('[Database] 回收站关机记录表创建成功');
    } else {
      console.log('[Database] 回收站关机记录表已存在');
    }
  } catch (error) {
    console.error('[Database] 创建回收站表失败:', error);
    throw error;
  }
}