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
 * GET 查询参数 `mergePublicScenarioNamespaces`：
 * - 未传或 `true`：租户库存类查询仍合并 `tower.io/scenario=public` 命名空间（兼容旧客户端）
 * - `false`：租户仅按 UserSpace 命名空间，不合并公共场景命名空间（云主机控制台「仅镜像/模板/扁平子网」走合并，其余走 false）
 */
export function mergePublicScenarioNamespacesFromQuery(req: { query?: any }): boolean {
  const v = String(req.query?.mergePublicScenarioNamespaces ?? '').toLowerCase();
  if (v === 'false' || v === '0') return false;
  return true;
}

/**
 * 租户在库存类查询中的 OR 条件：UserSpace 允许的命名空间 + 公共场景命名空间（去重）
 */
export async function buildTenantNamespaceInventoryWhere(
  cloudId: string,
  tenantNamespaces: string[],
  options?: { mergePublicScenarioNamespaces?: boolean },
): Promise<Array<{ cloudId: string; namespace: string }>> {
  const mergePublic = options?.mergePublicScenarioNamespaces !== false;
  const publicNs = mergePublic ? await getPublicScenarioNamespaceNames(cloudId) : [];
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
