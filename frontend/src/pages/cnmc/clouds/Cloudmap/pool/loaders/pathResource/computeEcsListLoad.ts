import { apiPost, fetchCloudProviderEcs } from '../../api';

/** 解析 `GET /api/clouds/:id/resources/ecs` 响应为 VM 数组（与池内其它入口一致） */
export function parseEcsListFromJson(json: unknown): any[] {
  const data = (json as { data?: unknown })?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const row = data as {
      Instances?: { Instance?: unknown };
      items?: unknown;
      data?: unknown;
    };
    const candidate = row.Instances?.Instance ?? row.items ?? row.data ?? [];
    if (Array.isArray(candidate)) return candidate;
    return candidate != null ? [candidate] : [];
  }
  return [];
}

/** 强制刷新前可选 sync（Harvester / Cloudmap） */
export async function syncCloudEcsBeforeLoad(
  cloudId: string,
  force: boolean,
  skipSync: boolean,
): Promise<void> {
  if (!force || skipSync) return;
  try {
    await apiPost(`/api/clouds/${cloudId}/sync`);
  } catch {
    // sync 失败仍尝试读列表
  }
}

export async function fetchComputeEcsList(
  cloudId: string,
  force: boolean,
): Promise<unknown> {
  return fetchCloudProviderEcs(cloudId, force);
}
