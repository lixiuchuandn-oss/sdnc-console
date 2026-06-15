import type { HarvesterTestParams } from './clouds/harvester/types';
import { getHarvesterVM, resolveVmPath } from './clouds/harvester/vm';
import { getJsonOnce } from './clouds/harvester/utils';
import {
  isLocalRegistryManagedPvc,
  isLocalRegistryManagedPvcName,
  REGISTRY_MANAGED_PVC_MESSAGE,
} from './registryManagedLocalRegistry';

function buildPvcUrl(endpoint: string, namespace: string, name: string): string {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  return `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`;
}

export async function fetchPvcOrNull(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
): Promise<any | null> {
  try {
    return await getJsonOnce(buildPvcUrl(params.endpoint, namespace, name), params.token, params.insecure);
  } catch {
    return null;
  }
}

export async function isRegistryManagedPvcRef(
  params: HarvesterTestParams,
  namespace: string,
  pvcName: string,
): Promise<boolean> {
  if (!pvcName) return false;
  const pvc = await fetchPvcOrNull(params, namespace, pvcName);
  if (pvc) return isLocalRegistryManagedPvc(pvc);
  return isLocalRegistryManagedPvcName(pvcName);
}

export async function getVmVolumePvcRef(
  params: HarvesterTestParams,
  instanceId: string,
  diskName: string,
): Promise<{ namespace: string; name: string } | null> {
  const path = await resolveVmPath(params, instanceId);
  if (!path || !diskName) return null;
  const vm = await getHarvesterVM(params, path.namespace, path.name);
  const volumes = vm?.spec?.template?.spec?.volumes || [];
  const vol = volumes.find((v: any) => v.name === diskName);
  const claimName = vol?.persistentVolumeClaim?.claimName;
  if (!claimName) return null;
  return { namespace: path.namespace, name: claimName };
}

export async function getVmVolumePvcRefByNsName(
  params: HarvesterTestParams,
  vmNamespace: string,
  vmName: string,
  diskName: string,
): Promise<{ namespace: string; name: string } | null> {
  if (!vmNamespace || !vmName || !diskName) return null;
  const vm = await getHarvesterVM(params, vmNamespace, vmName);
  const volumes = vm?.spec?.template?.spec?.volumes || [];
  const vol = volumes.find((v: any) => v.name === diskName);
  const claimName = vol?.persistentVolumeClaim?.claimName;
  if (!claimName) return null;
  return { namespace: vmNamespace, name: claimName };
}

export { REGISTRY_MANAGED_PVC_MESSAGE };
