/** 平台「部署本地仓库」创建的 Kubernetes Service，不可在服务页直接编辑/删除 */
const LOCAL_REGISTRY_SERVICE_NAME_PATTERN = /^docker-registry-[a-z0-9-]+$/i;

export function isLocalRegistryManagedServiceName(name: string | null | undefined): boolean {
  if (!name) return false;
  return LOCAL_REGISTRY_SERVICE_NAME_PATTERN.test(name);
}

export function isLocalRegistryManagedService(service: {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: {
    type?: string;
    ports?: Array<{ port?: number; name?: string }>;
    selector?: Record<string, string>;
  };
} | null | undefined): boolean {
  if (!service?.metadata) return false;

  const labels = service.metadata.labels || {};
  const annotations = service.metadata.annotations || {};
  const name = service.metadata.name || '';
  const towerType = labels['compute-tower.io/type'] || annotations['compute-tower.io/type'];

  if (towerType === 'local-registry-service') {
    return true;
  }

  if (labels['compute-tower.io/local-registry-id']) {
    return true;
  }

  if (
    labels['app.kubernetes.io/managed-by'] === 'compute-tower' &&
    isLocalRegistryManagedServiceName(name)
  ) {
    return true;
  }

  if (!isLocalRegistryManagedServiceName(name)) {
    return false;
  }

  const selectorApp = service.spec?.selector?.app;
  if (selectorApp && selectorApp === name) {
    return true;
  }

  const hasRegistryPort = (service.spec?.ports || []).some(
    (port) => port.port === 5000 || port.name === 'registry',
  );
  return service.spec?.type === 'NodePort' && hasRegistryPort;
}

export const REGISTRY_MANAGED_SERVICE_MESSAGE =
  '该 Service 由「部署本地仓库」自动创建，请在「镜像仓库」中编辑或删除对应仓库';

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

export const REGISTRY_MANAGED_PVC_MESSAGE =
  '该云盘由「部署本地仓库」自动创建，请在「镜像仓库」中编辑或删除对应仓库';

/** 平台「部署本地仓库」创建的 Deployment（`docker-registry-<name>`），不可在工作负载页直接编辑/删除 */
export function isLocalRegistryManagedDeploymentName(name: string | null | undefined): boolean {
  return isLocalRegistryManagedServiceName(name);
}

export function isLocalRegistryManagedDeployment(deployment: {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    template?: {
      spec?: {
        containers?: Array<{ name?: string; ports?: Array<{ containerPort?: number; name?: string }> }>;
      };
    };
  };
} | null | undefined): boolean {
  if (!deployment?.metadata) return false;

  const labels = deployment.metadata.labels || {};
  const annotations = deployment.metadata.annotations || {};
  const name = deployment.metadata.name || '';
  const towerType = labels['compute-tower.io/type'] || annotations['compute-tower.io/type'];

  if (towerType === 'local-registry-deployment') {
    return true;
  }

  if (labels['compute-tower.io/local-registry-id']) {
    return true;
  }

  if (
    labels['app.kubernetes.io/managed-by'] === 'compute-tower' &&
    isLocalRegistryManagedDeploymentName(name)
  ) {
    return true;
  }

  if (!isLocalRegistryManagedDeploymentName(name)) {
    return false;
  }

  const selectorApp = deployment.spec?.selector?.matchLabels?.app;
  const containers = deployment.spec?.template?.spec?.containers || [];
  const hasRegistryContainer = containers.some(
    (container) =>
      container?.name === 'registry'
      && (container?.ports || []).some(
        (port) => port?.containerPort === 5000 || port?.name === 'registry',
      ),
  );

  if (selectorApp && selectorApp === name && hasRegistryContainer) {
    return true;
  }

  return hasRegistryContainer;
}

export const REGISTRY_MANAGED_DEPLOYMENT_MESSAGE =
  '该工作负载由「部署本地仓库」自动创建，请在「镜像仓库」中编辑或删除对应仓库';
