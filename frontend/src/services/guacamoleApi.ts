import { apiPost, apiPut, apiRequest, apiDelete } from './api';

export type GuacamoleInstanceDto = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  dataSource: string;
  isDefault: boolean;
  status: string;
  hasDesktopUserPassword?: boolean;
  lastTestAt?: string;
  lastTestMessage?: string;
};

export type CloudDesktopUserDto = {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  status: 'active' | 'inactive';
  guacamoleUsername: string;
  instanceId?: string;
  syncStatus: string;
  lastSyncAt?: string;
  lastSyncMessage?: string;
};

export type PoolGatewayAccess = {
  registered: boolean;
  poolEnabled: boolean;
  ready: boolean;
  instanceId?: string;
  message?: string;
};

export async function fetchGuacamoleInstances() {
  return apiRequest('/api/remote/guacamole/instances', { skipCache: true }) as Promise<{
    ok: boolean;
    data: GuacamoleInstanceDto[];
  }>;
}

export async function createGuacamoleInstance(body: {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  desktop_user_password?: string;
  dataSource?: string;
  isDefault?: boolean;
}) {
  return apiPost('/api/remote/guacamole/instances', body) as Promise<{
    ok: boolean;
    data: GuacamoleInstanceDto;
  }>;
}

export async function updateGuacamoleInstance(
  id: string,
  body: Partial<{
    name: string;
    baseUrl: string;
    username: string;
    password: string;
    desktop_user_password: string;
    dataSource: string;
    isDefault: boolean;
  }>,
) {
  return apiPut(`/api/remote/guacamole/instances/${encodeURIComponent(id)}`, body) as Promise<{
    ok: boolean;
    data: GuacamoleInstanceDto;
  }>;
}

export async function testGuacamoleInstance(id: string) {
  return apiPost(`/api/remote/guacamole/instances/${encodeURIComponent(id)}/test`, {}) as Promise<{
    ok: boolean;
    message: string;
    data: GuacamoleInstanceDto;
  }>;
}

export async function fetchPoolGatewayAccess(cloudId: string) {
  return apiRequest(`/api/remote/guacamole/pools/${encodeURIComponent(cloudId)}/access`, {
    skipCache: true,
  }) as Promise<PoolGatewayAccess & { ok?: boolean }>;
}

export async function updatePoolGatewayConfig(
  cloudId: string,
  body: { enabled?: boolean; instanceId?: string | null },
) {
  return apiPut(`/api/remote/guacamole/pools/${encodeURIComponent(cloudId)}/config`, body) as Promise<
    PoolGatewayAccess & { ok: boolean; config: { enabled?: boolean; instanceId?: string } }
  >;
}

export async function syncCloudDesktopUsers(instanceId?: string) {
  return apiPost('/api/remote/guacamole/users/sync', {
    ...(instanceId ? { instance_id: instanceId } : {}),
  }) as Promise<{
    ok: boolean;
    synced: number;
    failed: number;
    message?: string;
  }>;
}

export async function fetchCloudDesktopUsers() {
  return apiRequest('/api/remote/guacamole/desktop-users', { skipCache: true }) as Promise<{
    ok: boolean;
    data: CloudDesktopUserDto[];
  }>;
}

export async function createCloudDesktopUser(body: {
  username: string;
  full_name: string;
  email?: string;
}) {
  return apiPost('/api/remote/guacamole/desktop-users', body) as Promise<{
    ok: boolean;
    data: CloudDesktopUserDto;
  }>;
}

export async function updateCloudDesktopUser(
  id: string,
  body: Partial<{ full_name: string; email: string; status: 'active' | 'inactive' }>,
) {
  return apiPut(`/api/remote/guacamole/desktop-users/${encodeURIComponent(id)}`, body) as Promise<{
    ok: boolean;
    data: CloudDesktopUserDto;
  }>;
}

export async function deleteCloudDesktopUser(id: string) {
  return apiDelete(`/api/remote/guacamole/desktop-users/${encodeURIComponent(id)}`) as Promise<{
    ok: boolean;
  }>;
}

export async function fetchVmDesktopAssignments(
  cloudId: string,
  namespace: string,
  resourceId: string,
) {
  const q = new URLSearchParams({
    cloud_id: cloudId,
    namespace,
    resource_id: resourceId,
  });
  return apiRequest(`/api/remote/guacamole/assignments?${q.toString()}`, {
    skipCache: true,
  }) as Promise<{
    ok: boolean;
    data: Array<{ assignment_id: string; desktop_user: CloudDesktopUserDto }>;
  }>;
}

export async function assignVmDesktopUsers(body: {
  cloud_id: string;
  namespace: string;
  resource_id: string;
  desktop_user_ids: string[];
  protocol?: string;
  username?: string;
  password?: string;
}) {
  return apiPost('/api/remote/guacamole/assignments', body) as Promise<{
    ok: boolean;
    connection_id: string;
    assigned: string[];
    removed: string[];
    message?: string;
  }>;
}
