import { DataSource } from 'typeorm';
import { logger } from './logger';

/**
 * 将历史 `category` + `subType` 合并为单字段 `category` = `kind:首段标签`。
 * 在含 `subType` 列的 SQLite 上执行；列已删时忽略错误。
 */
export async function mergeSecurityDomainCategoryLegacy(dataSource: DataSource): Promise<void> {
  try {
    const rows: { id: string; category: string | null; subType: string | null }[] =
      await dataSource.query(
        `SELECT id, category, subType FROM security_domains WHERE subType IS NOT NULL AND TRIM(subType) != ''`,
      );
    for (const r of rows) {
      const c = String(r.category || '').trim();
      if (c.includes(':')) continue;
      const first = String(r.subType || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)[0];
      if (!c || !first) continue;
      const merged = `${c}:${first}`;
      await dataSource.query(`UPDATE security_domains SET category = ? WHERE id = ?`, [
        merged,
        r.id,
      ]);
    }
    logger.info(`[security_domains] 已合并旧版 category/subType（处理 ${rows.length} 条候选）`);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('no such column') || msg.includes('subType')) {
      logger.debug('[security_domains] 跳过 subType 合并（列不存在或已迁移）');
      return;
    }
    logger.warn('[security_domains] 合并 category/subType 失败:', e);
  }
}
