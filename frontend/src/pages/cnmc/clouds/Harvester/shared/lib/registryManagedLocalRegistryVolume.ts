/** 平台「部署本地仓库」创建的 PVC（`docker-registry-<name>-pvc`），不可在云盘页挂载/卸载/删除 */
const LOCAL_REGISTRY_PVC_NAME_PATTERN = /^docker-registry-[a-z0-9-]+-pvc$/i;

export function isLocalRegistryManagedPvcName(name: string | null | undefined): boolean {
  if (!name) return false;
  return LOCAL_REGISTRY_PVC_NAME_PATTERN.test(name);
}

export function isLocalRegistryManagedPvc(pvc: {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
} | null | undefined): boolean {
  if (!pvc?.metadata) return false;

  const labels = pvc.metadata.labels || {};
  const annotations = pvc.metadata.annotations || {};
  const name = pvc.metadata.name || '';
  const towerType = labels['compute-tower.io/type'] || annotations['compute-tower.io/type'];

  if (towerType === 'local-registry-pvc') {
    return true;
  }

  if (labels['compute-tower.io/local-registry-id']) {
    return true;
  }

  if (
    labels['app.kubernetes.io/managed-by'] === 'compute-tower' &&
    isLocalRegistryManagedPvcName(name)
  ) {
    return true;
  }

  const appName = labels['app.kubernetes.io/name'];
  if (
    isLocalRegistryManagedPvcName(name) &&
    appName &&
    name === `${appName}-pvc` &&
    /^docker-registry-[a-z0-9-]+$/i.test(appName)
  ) {
    return true;
  }

  return false;
}

export function isLocalRegistryManagedVolume(record: {
  name?: string;
  raw?: unknown;
} | null | undefined): boolean {
  if (!record) return false;
  const raw = (record.raw || record) as {
    metadata?: { name?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
  };
  if (isLocalRegistryManagedPvc(raw)) return true;
  return isLocalRegistryManagedPvcName(record.name || raw?.metadata?.name);
}

export const REGISTRY_MANAGED_PVC_HINT =
  '该云盘由「部署本地仓库」自动创建，请在「镜像仓库」中编辑或删除对应仓库';
