/**
 * 物理主机（K8s Node）与 Prometheus node-exporter `instance`（通常为 IP:9100）的展示名映射。
 * 数据来源：`GET .../node-resources`（快车道 nodeResources）；节点名与 IP 稳定，按 cloudId 进程内缓存。
 */
import { formatPrometheusInstanceLabel } from './hostSegments';

function getNodeList(nodesResponse: unknown): any[] {
  if (!nodesResponse) return [];
  const r = nodesResponse as Record<string, unknown>;
  if (Array.isArray(nodesResponse)) return nodesResponse;
  if (Array.isArray(r.data)) return r.data as any[];
  const data = r.data as { items?: unknown[] } | undefined;
  const items = data?.items;
  if (Array.isArray(items)) return items as any[];
  if (Array.isArray(r.items)) return r.items as any[];
  return [];
}

const EXPORTER_PORTS = ['9100', '9101', '9090'] as const;

/** cloudId → instance 查找键（小写）→ 物理主机名 */
const instanceLabelCache = new Map<string, Map<string, string>>();

function registerInstanceKey(map: Map<string, string>, key: string, hostName: string): void {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return;
  map.set(normalized, hostName);
}

/** 从 node-resources 构建 instance → 物理主机名 映射 */
export function buildPhysicalHostInstanceLabelMap(nodesResponse: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of getNodeList(nodesResponse)) {
    const hostName = String(node?.metadata?.name ?? '').trim();
    if (!hostName) continue;

    registerInstanceKey(map, hostName, hostName);

    for (const addr of node?.status?.addresses ?? []) {
      const address = String(addr?.address ?? '').trim();
      if (!address) continue;
      registerInstanceKey(map, address, hostName);
      for (const port of EXPORTER_PORTS) {
        registerInstanceKey(map, `${address}:${port}`, hostName);
      }
    }
  }
  return map;
}

/** 按 cloudId 取缓存映射；首次有 node-resources 时写入缓存，后续不再重建 */
export function getPhysicalHostInstanceLabelMap(
  cloudId: string,
  nodesResponse: unknown | null,
): Map<string, string> {
  if (!cloudId) return new Map();
  const cached = instanceLabelCache.get(cloudId);
  if (cached) return cached;
  if (!nodesResponse) return new Map();
  const built = buildPhysicalHostInstanceLabelMap(nodesResponse);
  instanceLabelCache.set(cloudId, built);
  return built;
}

export function clearPhysicalHostInstanceLabelCache(cloudId?: string): void {
  if (cloudId) {
    instanceLabelCache.delete(cloudId);
    return;
  }
  instanceLabelCache.clear();
}

/** 将 Prometheus instance 解析为物理主机名；未命中时回退为 IP/主机段 */
export function resolvePhysicalHostInstanceLabel(
  instance: string,
  labelMap: Map<string, string>,
): string {
  const trimmed = instance.trim();
  if (!trimmed) return '-';
  const lower = trimmed.toLowerCase();
  const hostPart = lower.split(':')[0];
  return (
    labelMap.get(lower) ??
    labelMap.get(hostPart) ??
    formatPrometheusInstanceLabel(trimmed)
  );
}
