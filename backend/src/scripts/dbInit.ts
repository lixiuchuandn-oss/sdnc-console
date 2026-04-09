import fs from 'fs';
import path from 'path';
import { AppDataSource } from '../config/database';
import { initializeAdmin } from '../seeders/initAdmin';
import { initializeRoles } from '../seeders/initRoles';
 
async function removeIfExists(filePath: string) {
  try {
    await fs.promises.rm(filePath, { force: true });
  } catch (e: any) {
    if (fs.existsSync(filePath)) {
      throw new Error(`无法删除数据库文件（可能被占用）：${filePath}；${String(e?.message || e)}`);
    }
  }
  if (fs.existsSync(filePath)) {
    throw new Error(`数据库文件仍然存在（可能被占用）：${filePath}`);
  }
}
 
async function main() {
  const dbPathFromEnv = process.env.DB_PATH;
  const dbPath = dbPathFromEnv || path.join(process.cwd(), 'data.sqlite');
  process.stdout.write(`DB path: ${dbPath}\n`);

  await removeIfExists(dbPath);
  await removeIfExists(`${dbPath}-wal`);
  await removeIfExists(`${dbPath}-shm`);
  await removeIfExists(`${dbPath}-journal`);

  // 临时启用同步以创建表结构
  const originalSync = process.env.DB_SYNC;
  process.env.DB_SYNC = 'true';
  
  await AppDataSource.initialize();
  
  // 同步表结构
  await AppDataSource.synchronize();
  
  await initializeRoles();
  await initializeAdmin();
  await AppDataSource.destroy();
  
  // 恢复原始设置
  if (originalSync !== undefined) {
    process.env.DB_SYNC = originalSync;
  } else {
    delete process.env.DB_SYNC;
  }

  process.stdout.write(`DB initialized: ${dbPath}\n`);
}
 
main().catch((e) => {
  process.stderr.write(`DB init failed: ${String(e?.message || e)}\n`);
  process.exitCode = 1;
});
