import { apiDelete, apiPost, apiPut, apiRequest } from '../api';

export type OvnMirrorDirect = 'inbound' | 'outbound' | 'all';
export type OvnMirrorProtocol = 'udp' | 'tcp' | 'all';

export type OvnMirrorEndpointPayload = {
  vmName: string;
  namespace: string;
  networkNad: string;
};

export type OvnMirrorRulePayload = {
  networkNad: string;
  /** string；空表示 any */
  targetIp: string;
  endpoints: OvnMirrorEndpointPayload[];
  port?: number;
  direct?: OvnMirrorDirect;
  protocol?: OvnMirrorProtocol;
  targetPort?: number;
};

export type OvnMirrorSpecPayload = {
  vmName: string;
  namespace: string;
  rules: OvnMirrorRulePayload[];
};

export type OvnMirrorListResponse = {
  message?: string;
  data?: {
    items?: unknown[];
    available?: boolean;
    listSourceUrl?: string;
    error?: string;
  };
};

export async function fetchHarvesterOvnMirrors(
  cloudId: string,
  skipCache = false,
): Promise<OvnMirrorListResponse> {
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/ovn-mirrors`, {
    skipCache,
  });
}

export async function createHarvesterOvnMirror(
  cloudId: string,
  body: { name: string; spec: OvnMirrorSpecPayload },
) {
  return apiPost(`/api/clouds/${cloudId}/resources/harvester/ovn-mirrors`, body);
}

export async function updateHarvesterOvnMirror(
  cloudId: string,
  name: string,
  body: { spec: OvnMirrorSpecPayload },
) {
  return apiPut(
    `/api/clouds/${cloudId}/resources/harvester/ovn-mirrors/${encodeURIComponent(name)}`,
    body,
  );
}

export async function deleteHarvesterOvnMirror(cloudId: string, name: string) {
  return apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/ovn-mirrors/${encodeURIComponent(name)}`,
  );
}
