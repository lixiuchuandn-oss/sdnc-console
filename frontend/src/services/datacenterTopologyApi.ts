import { apiDelete, apiPatch, apiPost, apiRequest } from './api';

export type DatacenterRackDevice = {
  id: string;
  rackId: string;
  sourceKind: 'node' | 'switch' | 'custom' | string;
  refKey: string | null;
  customLabel: string | null;
  slotOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DatacenterRack = {
  id: string;
  cloudId: string;
  name: string;
  sortOrder: number;
  devices: DatacenterRackDevice[];
  createdAt?: string;
  updatedAt?: string;
};

export async function fetchDatacenterRacks(
  cloudId: string,
  force = false,
): Promise<{ racks: DatacenterRack[] }> {
  const json: any = await apiRequest(
    `/api/clouds/${encodeURIComponent(cloudId)}/datacenter-topology/racks`,
    { skipCache: force },
  );
  return json?.data || { racks: [] };
}

export async function createDatacenterRack(
  cloudId: string,
  payload: { name: string; sortOrder?: number },
): Promise<DatacenterRack | undefined> {
  const body: { name: string; sortOrder?: number } = { name: payload.name };
  if (payload.sortOrder !== undefined && Number.isFinite(payload.sortOrder)) {
    body.sortOrder = Math.trunc(payload.sortOrder);
  }
  const json: any = await apiPost(`/api/clouds/${encodeURIComponent(cloudId)}/datacenter-topology/racks`, body);
  return json?.data?.rack;
}

export async function patchDatacenterRack(
  cloudId: string,
  rackId: string,
  body: { name?: string; sortOrder?: number },
): Promise<DatacenterRack | undefined> {
  const json: any = await apiPatch(
    `/api/clouds/${encodeURIComponent(cloudId)}/datacenter-topology/racks/${encodeURIComponent(rackId)}`,
    body,
  );
  return json?.data?.rack;
}

export async function deleteDatacenterRack(cloudId: string, rackId: string): Promise<void> {
  await apiDelete(`/api/clouds/${encodeURIComponent(cloudId)}/datacenter-topology/racks/${encodeURIComponent(rackId)}`);
}

export async function createRackDevice(
  cloudId: string,
  rackId: string,
  body: { sourceKind: string; refKey?: string | null; customLabel?: string | null; slotOrder?: number },
): Promise<DatacenterRackDevice | undefined> {
  const json: any = await apiPost(
    `/api/clouds/${encodeURIComponent(cloudId)}/datacenter-topology/racks/${encodeURIComponent(rackId)}/devices`,
    body,
  );
  return json?.data?.device;
}

export async function patchRackDevice(
  cloudId: string,
  rackId: string,
  deviceId: string,
  body: { slotOrder?: number; customLabel?: string | null; refKey?: string | null },
): Promise<DatacenterRackDevice | undefined> {
  const json: any = await apiPatch(
    `/api/clouds/${encodeURIComponent(cloudId)}/datacenter-topology/racks/${encodeURIComponent(
      rackId,
    )}/devices/${encodeURIComponent(deviceId)}`,
    body,
  );
  return json?.data?.device;
}

export async function deleteRackDevice(cloudId: string, rackId: string, deviceId: string): Promise<void> {
  await apiDelete(
    `/api/clouds/${encodeURIComponent(cloudId)}/datacenter-topology/racks/${encodeURIComponent(
      rackId,
    )}/devices/${encodeURIComponent(deviceId)}`,
  );
}
