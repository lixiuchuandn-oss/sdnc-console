/**
 * =============================================================================
 * Harvester：Tower PaaS 托管 VM — 标签约定（**统一键**，RDS 与虚拟网元共用一套名字）
 * =============================================================================
 *
 * ## 必记三键（实例：`metadata.labels` 与 `spec.template.metadata.labels` 一致）
 *
 * | Key | 值 | 说明 |
 * |-----|-----|------|
 * | `tower.io/paas-managed` | `true` | 托管 VM；**VmSection 主列表排除** |
 * | `tower.io/paas-category` | `database` \| `vne` | 产品线：云数据库 vs 虚拟网元 |
 * | `tower.io/paas-type` | 如 `mysql`、`router` | 具体类型（与引擎/网元角色对应） |
 *
 * 云数据库可选：`tower.io/paas-ver`（如 `5.7`）。
 *
 * ## 兼容旧实例（列表仍识别，新创建不再写入）
 *
 * - 云数据库旧键：`tower.io/rds=true`
 * - 虚拟网元旧键：`tower.io/vne-router=true` + `tower.io/vne-type`（与现 `paas-type` 二选一旧镜像仍可读 `vne-type`）
 *
 * ## 镜像（catalog）
 *
 * - 云数据库：`tower.io/paas-category=database` + `tower.io/paas-type=mysql` 等（推荐再加 `paas-managed`）。仅 `paas-type` 无 `vne` 分类的旧镜像仍视为数据库目录。
 * - 虚拟网元：`tower.io/paas-category=vne` + `tower.io/paas-type=router` 等；旧镜像可仅保留 `tower.io/vne-type`。
 */

export const TOWER_LABEL_PAAS_MANAGED = 'tower.io/paas-managed';

export const PAAS_MANAGED_LABEL_VALUE = 'true';

export const TOWER_LABEL_PAAS_CATEGORY = 'tower.io/paas-category';

/** 云数据库产品线 */
export const PAAS_CATEGORY_DATABASE = 'database';

/** 虚拟网元产品线 */
export const PAAS_CATEGORY_VNE = 'vne';

/** 旧：云数据库实例 */
export const TOWER_LABEL_RDS = 'tower.io/rds';

/** 旧：虚拟路由实例 */
export const TOWER_LABEL_VNE_ROUTER = 'tower.io/vne-router';

export function readVmPaasCategory(vm: any): string {
  return String(vm?.metadata?.labels?.[TOWER_LABEL_PAAS_CATEGORY] || '').trim().toLowerCase();
}

function labelEqualsTrue(labels: Record<string, any> | undefined, key: string): boolean {
  if (!labels || typeof labels !== 'object') return false;
  const v = labels[key];
  return v === true || v === 'true';
}

/** 是否云数据库托管 VM（新 `paas-category` 或旧 `tower.io/rds`） */
export function isTowerPaasDatabaseVm(vm: any): boolean {
  const labels = vm?.metadata?.labels || {};
  if (labelEqualsTrue(labels, TOWER_LABEL_RDS)) return true;
  return readVmPaasCategory(vm) === PAAS_CATEGORY_DATABASE;
}

/** 是否虚拟网元（路由等）托管 VM（新 `paas-category` 或旧 `tower.io/vne-router`） */
export function isTowerPaasVneVm(vm: any): boolean {
  const labels = vm?.metadata?.labels || {};
  if (labelEqualsTrue(labels, TOWER_LABEL_VNE_ROUTER)) return true;
  return readVmPaasCategory(vm) === PAAS_CATEGORY_VNE;
}

/**
 * 是否应从「弹性计算 / 云主机主列表」（VmSection）中排除。
 */
export function isTowerPaasInventoryExcludedVm(vm: any): boolean {
  const labels = vm?.metadata?.labels;
  if (labelEqualsTrue(labels, TOWER_LABEL_PAAS_MANAGED)) return true;
  if (labelEqualsTrue(labels, TOWER_LABEL_RDS)) return true;
  if (labelEqualsTrue(labels, TOWER_LABEL_VNE_ROUTER)) return true;
  const cat = readVmPaasCategory(vm);
  if (cat === PAAS_CATEGORY_DATABASE || cat === PAAS_CATEGORY_VNE) return true;
  return false;
}
