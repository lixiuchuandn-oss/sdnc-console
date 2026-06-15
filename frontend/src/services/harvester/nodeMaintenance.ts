import { apiPost } from '../api';

export type UnhealthyVmGroup = {
  message: string;
  vms: string[];
};

export type NodeMaintenancePrecheck = {
  possible: boolean;
  reason?: string;
};

export async function precheckNodeMaintenance(cloudId: string, nodeName: string) {
  return apiPost(
    `/api/clouds/${cloudId}/resources/harvester/nodes/${encodeURIComponent(nodeName)}/maintenance/precheck`,
    {},
  );
}

export async function listNodeMaintenanceUnhealthyVms(cloudId: string, nodeName: string) {
  return apiPost(
    `/api/clouds/${cloudId}/resources/harvester/nodes/${encodeURIComponent(nodeName)}/maintenance/unhealthy-vms`,
    {},
  );
}

export async function enableNodeMaintenance(cloudId: string, nodeName: string, force: boolean) {
  return apiPost(
    `/api/clouds/${cloudId}/resources/harvester/nodes/${encodeURIComponent(nodeName)}/maintenance/enable`,
    { force },
  );
}

export async function disableNodeMaintenance(cloudId: string, nodeName: string) {
  return apiPost(
    `/api/clouds/${cloudId}/resources/harvester/nodes/${encodeURIComponent(nodeName)}/maintenance/disable`,
    {},
  );
}
