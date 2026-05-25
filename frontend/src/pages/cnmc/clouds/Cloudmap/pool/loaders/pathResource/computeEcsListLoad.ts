import { apiPost, fetchCloudProviderEcs } from '../../api';

/** 解析 `GET /api/clouds/:id/resources/ecs` 响应为 VM 数组（与池内其它入口一致） */
export function parseEcsListFromJson(json: unknown): any[] {
  const data = (json as { data?: unknown })?.data;
  const list: unknown[] = Array.isArray(data)
    ? data
    : (data as { Instances?: { Instance?: unknown } })?.Instances?.Instance ||
      (data as { items?: unknown })?.items ||
      (data as { data?: unknown })?.data ||
      [];
  return Array.isArray(list) ? list : [];
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
