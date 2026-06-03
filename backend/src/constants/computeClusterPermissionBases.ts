/** 计算配置页（节点 / 故障域 / DRS / 迁移）统一权限基 */
export const COMPUTE_CLUSTER_PERMISSION_BASES = ['clouds.compute-cluster'] as const;

export function isComputeClusterPermissionBase(base: string): boolean {
  return (COMPUTE_CLUSTER_PERMISSION_BASES as readonly string[]).includes(base);
}
