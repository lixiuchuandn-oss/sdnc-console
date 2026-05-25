import {
  fetchHarvesterMigrations,
  fetchHarvesterMigrationsDirect,
} from 'services/harvester/vm';

/** 拉取迁移记录列表（与 MigrationsSection 原 loadData 一致） */
export async function fetchComputeMigrationsList(
  cloudId: string,
  force: boolean,
): Promise<unknown[]> {
  const res = await fetchHarvesterMigrations(cloudId, force);
  let list = res?.data?.items || [];
  if (!Array.isArray(list) || list.length === 0) {
    try {
      const direct = await fetchHarvesterMigrationsDirect(cloudId, force);
      list = direct?.data?.items || direct?.items || [];
    } catch {
      // direct fallback optional
    }
  }
  return Array.isArray(list) ? list : [];
}
