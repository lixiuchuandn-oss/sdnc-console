/**
 * 历史容器总权 clouds.containers:{read|write}（角色配置已移除，仅运行时兼容 + 库内迁移）
 */

export const LEGACY_CLOUD_CONTAINERS_READ = 'clouds.containers:read';
export const LEGACY_CLOUD_CONTAINERS_WRITE = 'clouds.containers:write';

const CONTAINER_SUB_READ = [
  'clouds.containers.workloads:read',
  'clouds.containers.pods:read',
  'clouds.containers.jobs:read',
  'clouds.containers.services:read',
  'clouds.containers.ingresses:read',
  'clouds.containers.gateway:read',
  'clouds.containers.configs:read',
  'clouds.containers.registries:read',
  'clouds.containers.pdbs:read',
  'clouds.containers.networkpolicies:read',
] as const;

const CONTAINER_SUB_WRITE = CONTAINER_SUB_READ.map((p) => p.replace(':read', ':write'));

/** 将历史总权展开为子域 atoms，并去掉总权（保存角色 / 启动迁移用） */
export function expandLegacyContainerParentPermissions(permissions: string[]): string[] {
  const out = new Set(permissions);
  if (out.has(LEGACY_CLOUD_CONTAINERS_READ)) {
    CONTAINER_SUB_READ.forEach((p) => out.add(p));
    out.delete(LEGACY_CLOUD_CONTAINERS_READ);
  }
  if (out.has(LEGACY_CLOUD_CONTAINERS_WRITE)) {
    CONTAINER_SUB_WRITE.forEach((p) => out.add(p));
    out.delete(LEGACY_CLOUD_CONTAINERS_WRITE);
  }
  return Array.from(out);
}
