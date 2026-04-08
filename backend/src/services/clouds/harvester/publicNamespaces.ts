/**
 * 公共空间命名：与集群 tower.io/scenario=public 对齐（读命名空间库存）
 */
import { AppDataSource } from '../../../config/database';
import { HarvesterNamespaceInventory } from '../../../entities/harvester/HarvesterNamespaceInventory';

export const TOWER_SCENARIO_LABEL = 'tower.io/scenario';

/** 库存中带 tower.io/scenario=public 的命名空间名称 */
export async function getPublicScenarioNamespaceNames(cloudId: string): Promise<string[]> {
  const nsRepo = AppDataSource.getRepository(HarvesterNamespaceInventory);
  const rows = await nsRepo.find({ where: { cloudId } });
  const names: string[] = [];
  for (const row of rows) {
    const labels = row.rawData?.metadata?.labels ?? row.labels ?? {};
    if (
      String(labels[TOWER_SCENARIO_LABEL] ?? '').toLowerCase() === 'public' &&
      row.name
    ) {
      names.push(row.name);
    }
  }
  return names;
}

/**
 * 租户在库存类查询中的 OR 条件：UserSpace 允许的命名空间 + 公共场景命名空间（去重）
 */
export async function buildTenantNamespaceInventoryWhere(
  cloudId: string,
  tenantNamespaces: string[],
): Promise<Array<{ cloudId: string; namespace: string }>> {
  const publicNs = await getPublicScenarioNamespaceNames(cloudId);
  const merged = [
    ...tenantNamespaces.map((s) => String(s || '').trim()).filter(Boolean),
    ...publicNs,
  ];
  const seen = new Set<string>();
  const out: Array<{ cloudId: string; namespace: string }> = [];
  for (const ns of merged) {
    if (!ns || seen.has(ns)) continue;
    seen.add(ns);
    out.push({ cloudId, namespace: ns });
  }
  return out;
}

/** 解绑等场景：视为「公共资源、不拦解绑」的命名空间集合（label + 历史名兼容） */
export async function getPublicNamespaceNameSetForUnbind(cloudId: string): Promise<Set<string>> {
  const fromLabel = await getPublicScenarioNamespaceNames(cloudId);
  return new Set([...fromLabel, 'cloud-public', 'default']);
}
