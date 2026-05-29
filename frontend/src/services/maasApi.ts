import { apiDelete, apiPost, apiRequest } from './api';

export type MaasListResponse<T = Record<string, unknown>> = {
  ok: boolean;
  message?: string;
  items?: T[];
  total?: number;
  apiVersion?: string;
};

export type MaasControllerView = {
  system_id: string;
  hostname: string;
  status: string;
  online: boolean;
  ip: string;
  version: string;
};

export type MaasDashboardEvent = {
  time: string;
  hostname: string;
  description: string;
  level: string;
};

export type MaasDashboardResponse = {
  ok: boolean;
  message?: string;
  region: {
    name: string;
    endpoint: string;
    maas_version: string;
    connected: boolean;
  };
  machines: {
    total: number;
    ready: number;
    deployed: number;
    provisioning: number;
    error: number;
    other: number;
  };
  controllers: {
    region: MaasControllerView[];
    rack: MaasControllerView[];
  };
  discoveries_count: number;
  os_images_count: number;
  os_images: string[];
  recent_events: MaasDashboardEvent[];
  sync: { images_importing: boolean };
};

export type MaasMachineDetailResponse = {
  ok: boolean;
  message?: string;
  machine?: Record<string, unknown>;
  blockdevices?: Record<string, unknown>[];
  interfaces?: Record<string, unknown>[];
};

export type MaasNetworkResponse = {
  ok: boolean;
  message?: string;
  subnets?: Record<string, unknown>[];
  vlans?: Record<string, unknown>[];
};

export type MaasMachineOp =
  | 'commission'
  | 'deploy'
  | 'release'
  | 'power_on'
  | 'power_off'
  | 'power_cycle'
  | 'mark_broken'
  | 'mark_fixed'
  | 'abort';

function maasPath(cloudId: string, suffix: string): string {
  return `/api/clouds/${encodeURIComponent(cloudId)}/maas${suffix}`;
}

export async function fetchMaasDashboard(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasDashboardResponse> {
  return apiRequest(maasPath(cloudId, '/dashboard'), {
    skipCache: opts?.skipCache ?? true,
  });
}

export async function fetchMaasMachines(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasListResponse> {
  return apiRequest(maasPath(cloudId, '/machines'), {
    skipCache: opts?.skipCache ?? true,
  });
}

export async function fetchMaasMachineDetail(
  cloudId: string,
  systemId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasMachineDetailResponse> {
  return apiRequest(
    maasPath(cloudId, `/machines/${encodeURIComponent(systemId)}`),
    { skipCache: opts?.skipCache ?? true },
  );
}

export async function maasMachineOp(
  cloudId: string,
  systemId: string,
  op: MaasMachineOp,
  body?: Record<string, string>,
): Promise<{ ok: boolean; message?: string }> {
  return apiPost(
    maasPath(cloudId, `/machines/${encodeURIComponent(systemId)}/${op}`),
    body || {},
  );
}

export async function maasDeleteMachine(
  cloudId: string,
  systemId: string,
): Promise<{ ok: boolean; message?: string }> {
  return apiDelete(
    maasPath(cloudId, `/machines/${encodeURIComponent(systemId)}`),
  );
}

export type MaasCreateMachinePayload = {
  architecture: string;
  macAddresses: string[];
  powerType: string;
  powerParameters?: Record<string, string>;
  hostname?: string;
  domain?: string;
  zone?: string;
  pool?: string;
  commission?: boolean;
};

export async function maasCreateMachine(
  cloudId: string,
  payload: MaasCreateMachinePayload,
): Promise<{ ok: boolean; message?: string }> {
  return apiPost(
    maasPath(cloudId, '/machines'),
    payload as unknown as Record<string, unknown>,
  );
}

export async function fetchMaasDiscoveries(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasListResponse> {
  return apiRequest(maasPath(cloudId, '/discoveries'), {
    skipCache: opts?.skipCache ?? true,
  });
}

export async function fetchMaasEvents(
  cloudId: string,
  limit = 50,
  opts?: { skipCache?: boolean },
): Promise<MaasListResponse> {
  return apiRequest(maasPath(cloudId, `/events?limit=${limit}`), {
    skipCache: opts?.skipCache ?? true,
  });
}

export type MaasImageVariant = {
  resource_id: number | string;
  label: string;
  architecture: string;
  size_bytes: number;
  status: 'ready' | 'downloading' | 'unknown';
  is_default: boolean;
  deployable: boolean;
};

/** 普通用户视图：按 (osystem, release) 合并后的操作系统行 */
export type MaasImageGroup = {
  group_id: string;
  display_name: string;
  osystem: string;
  distro_series: string;
  platform: 'linux' | 'windows' | 'other';
  default_resource_id: number | string;
  size_bytes: number;
  status: 'ready' | 'downloading' | 'unknown';
  deployable: boolean;
  variant_count: number;
  variants: MaasImageVariant[];
};

export type MaasImagesListResponse = {
  ok: boolean;
  message?: string;
  items?: MaasImageGroup[];
  total?: number;
  apiVersion?: string;
  view?: string;
};

export type MaasImageSyncStatusResponse = {
  ok: boolean;
  message?: string;
  is_importing?: boolean;
};

export async function fetchMaasImages(
  cloudId: string,
  opts?: { deployable?: boolean; skipCache?: boolean },
): Promise<MaasImagesListResponse> {
  const q = opts?.deployable ? '?deployable=true' : '';
  return apiRequest(maasPath(cloudId, `/images${q}`), {
    skipCache: opts?.skipCache ?? true,
  });
}

export async function fetchMaasImageSyncStatus(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasImageSyncStatusResponse> {
  return apiRequest(maasPath(cloudId, '/images/sync/status'), {
    skipCache: opts?.skipCache ?? true,
  });
}

export async function maasImagesSync(
  cloudId: string,
): Promise<{ ok: boolean; message?: string }> {
  return apiPost(maasPath(cloudId, '/images/sync'), {});
}

export async function maasImagesSyncStop(
  cloudId: string,
): Promise<{ ok: boolean; message?: string }> {
  return apiPost(maasPath(cloudId, '/images/sync/stop'), {});
}

export async function deleteMaasImage(
  cloudId: string,
  imageId: string | number,
): Promise<{ ok: boolean; message?: string }> {
  return apiDelete(
    maasPath(cloudId, `/images/${encodeURIComponent(String(imageId))}`),
  );
}

export type MaasNamedItem = {
  id: number | string;
  name: string;
  description: string;
};

export type MaasPlacementResponse = {
  ok: boolean;
  message?: string;
  zones?: MaasNamedItem[];
  pools?: MaasNamedItem[];
  domains?: MaasNamedItem[];
};

export async function fetchMaasPlacement(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasPlacementResponse> {
  return apiRequest(maasPath(cloudId, '/placement'), {
    skipCache: opts?.skipCache ?? true,
  });
}

export type MaasBootSourceSelection = {
  id: number | string;
  os: string;
  release: string;
  arches: string[];
  subarches: string[];
  labels: string[];
};

export type MaasBootSource = {
  id: number | string;
  url: string;
  keyring_filename: string;
  selections: MaasBootSourceSelection[];
};

export type MaasBootSourcesResponse = {
  ok: boolean;
  message?: string;
  items?: MaasBootSource[];
  total?: number;
};

export async function fetchMaasBootSources(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasBootSourcesResponse> {
  return apiRequest(maasPath(cloudId, '/boot-sources'), {
    skipCache: opts?.skipCache ?? true,
  });
}

export async function createMaasBootSourceSelection(
  cloudId: string,
  sourceId: string | number,
  payload: {
    os: string;
    release: string;
    arches?: string[];
    subarches?: string[];
    labels?: string[];
  },
): Promise<{ ok: boolean; message?: string }> {
  return apiPost(
    maasPath(
      cloudId,
      `/boot-sources/${encodeURIComponent(String(sourceId))}/selections`,
    ),
    payload as unknown as Record<string, unknown>,
  );
}

export async function deleteMaasBootSourceSelection(
  cloudId: string,
  sourceId: string | number,
  selectionId: string | number,
): Promise<{ ok: boolean; message?: string }> {
  return apiDelete(
    maasPath(
      cloudId,
      `/boot-sources/${encodeURIComponent(String(sourceId))}/selections/${encodeURIComponent(
        String(selectionId),
      )}`,
    ),
  );
}

/** @deprecated 使用 fetchMaasImages */
export async function fetchMaasBootResources(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasListResponse> {
  return fetchMaasImages(cloudId, { skipCache: opts?.skipCache });
}

export async function fetchMaasNetwork(
  cloudId: string,
  opts?: { skipCache?: boolean },
): Promise<MaasNetworkResponse> {
  return apiRequest(maasPath(cloudId, '/network'), {
    skipCache: opts?.skipCache ?? true,
  });
}
