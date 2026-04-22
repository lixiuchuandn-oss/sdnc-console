/**
 * 机房拓扑机架条「物理节点」侧：与 DatacenterTopologySection / EmbeddedPhysicalNodeBladeBody 共用。
 * 避免与抽屉逻辑分叉时，优先与 NodesSection 行为对齐。
 */

export type NodeLiveMetrics = {
  cpuUsedCores?: number;
  memUsedBytes?: number;
  storageUsedBytes?: number;
};

export function parseCpuToCores(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return Number.isFinite(v) ? v / 1000 : 0;
  }
  if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return Number.isFinite(v) ? v / 1e9 : 0;
  }
  if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return Number.isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : 0;
}

export function parseMemoryToBytes(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) return 0;
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  return bytes;
}

export function nodeK8sStatus(n: any): Record<string, any> {
  if (n?.status && typeof n.status === 'object') return n.status as Record<string, any>;
  return {};
}

/** K8s 节点 CPU 架构（metadata.labels 或 status.nodeInfo），如 amd64、arm64 */
export function nodeCpuArchitecture(n: any): string {
  if (!n || typeof n !== 'object') return '';
  const labels = (n.metadata?.labels || {}) as Record<string, string>;
  const fromLabel = labels['kubernetes.io/arch'] || labels['beta.kubernetes.io/arch'];
  if (fromLabel != null && String(fromLabel).trim() !== '') return String(fromLabel).trim();
  const fromStatus = n?.status?.nodeInfo?.architecture;
  if (fromStatus != null && String(fromStatus).trim() !== '') return String(fromStatus).trim();
  return '';
}

/** 与 NodesSection / PhysicalNodeDetailDrawer 一致：节点管理（内网）IP */
export function nodeManagementIp(n: any): string {
  const direct = n?.internalIP;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  const st = nodeK8sStatus(n);
  const addrs: any[] = Array.isArray(st?.addresses) ? st.addresses : [];
  const hit = addrs.find((a) => String(a?.type || '') === 'InternalIP')?.address;
  if (hit != null && String(hit).trim() !== '') return String(hit).trim();
  return '';
}

/**
 * HMS `hardware.cpu`（lscpu 风格）中的 CPU Model name；与 PhysicalNodeDetailDrawer HMS CPU 表同源。
 * 无 HMS 时尝试 `status.nodeInfo` / 缓存 `nodeInfo` 上的扩展字段。
 */
export function nodeCpuModelName(n: any): string {
  const cpu = n?.hardware?.cpu;
  if (cpu && typeof cpu === 'object' && !Array.isArray(cpu)) {
    const preferKeys = ['Model name', 'Model Name', 'CPU model name'];
    for (const k of preferKeys) {
      const v = (cpu as Record<string, unknown>)[k];
      if (v != null && String(v).trim() !== '') {
        return String(v).trim().replace(/\s+/g, ' ').slice(0, 200);
      }
    }
    for (const [k, v] of Object.entries(cpu as Record<string, unknown>)) {
      if (v == null) continue;
      const s = String(v).trim();
      if (!s) continue;
      const kl = k.toLowerCase();
      if (kl.includes('model') && kl.includes('name')) {
        return s.replace(/\s+/g, ' ').slice(0, 200);
      }
    }
  }
  const ni = n?.status?.nodeInfo;
  if (ni && typeof ni === 'object') {
    for (const key of ['cpuModelName', 'cpuModel', 'cpu_model_name'] as const) {
      const v = (ni as Record<string, unknown>)[key];
      if (v != null && String(v).trim() !== '') {
        return String(v).trim().replace(/\s+/g, ' ').slice(0, 200);
      }
    }
  }
  const top = n?.nodeInfo;
  if (top && typeof top === 'object') {
    const v2 = (top as Record<string, unknown>).cpuModelName ?? (top as Record<string, unknown>).cpuModel;
    if (v2 != null && String(v2).trim() !== '') {
      return String(v2).trim().replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  return '';
}

export function nodeCpuCapacityStr(n: any): string | undefined {
  const st = nodeK8sStatus(n);
  const s = st?.allocatable?.cpu ?? st?.capacity?.cpu ?? n?.cpu;
  if (s == null || String(s).trim() === '') return undefined;
  return String(s);
}

export function nodeMemCapacityStr(n: any): string | undefined {
  const st = nodeK8sStatus(n);
  const s = st?.allocatable?.memory ?? st?.capacity?.memory ?? n?.memory;
  if (s == null || String(s).trim() === '') return undefined;
  return String(s);
}

export function nodeEphemeralStorageTotalBytes(n: any): number {
  const st = nodeK8sStatus(n);
  const al = st?.allocatable || {};
  const cap = st?.capacity || {};
  const ep = al['ephemeral-storage'] ?? cap['ephemeral-storage'];
  if (ep == null || ep === '') return 0;
  return parseMemoryToBytes(String(ep));
}

export function nodeUsagePercents(
  name: string,
  n: any,
  metrics: Record<string, NodeLiveMetrics>,
): { cpuPct: number; memPct: number; storagePct: number } {
  const m = metrics[name];
  if (!m) return { cpuPct: 0, memPct: 0, storagePct: 0 };
  const cpuTotal = parseCpuToCores(nodeCpuCapacityStr(n));
  const memTotal = parseMemoryToBytes(nodeMemCapacityStr(n) || '');
  const cpuPct =
    cpuTotal > 0 && m.cpuUsedCores != null ? Math.min(100, (m.cpuUsedCores / cpuTotal) * 100) : 0;
  const memPct =
    memTotal > 0 && m.memUsedBytes != null ? Math.min(100, (m.memUsedBytes / memTotal) * 100) : 0;
  const storTotal = nodeEphemeralStorageTotalBytes(n);
  const storagePct =
    storTotal > 0 && m.storageUsedBytes != null
      ? Math.min(100, (m.storageUsedBytes / storTotal) * 100)
      : 0;
  return { cpuPct, memPct, storagePct };
}

export function nodeTempShort(n: any): string | null {
  const ann = n?.metadata?.annotations || {};
  for (const [k, v] of Object.entries(ann)) {
    if (v && typeof v === 'string' && /temp|thermal|cpu.?t/i.test(k)) {
      const t = String(v).replace(/\s+/g, ' ').trim().slice(0, 22);
      return t || null;
    }
  }
  return null;
}

export function nodeTempHint(n: any): string {
  const ann = n?.metadata?.annotations || {};
  for (const [k, v] of Object.entries(ann)) {
    if (v && typeof v === 'string' && /temp|thermal|cpu.?t/i.test(k)) return v.trim().slice(0, 120);
  }
  return '集群未上报（可在节点注解中扩展）';
}

export function nodeReadyLedClass(n: any): 'ok' | 'warn' | 'err' {
  if (typeof n?.ready === 'boolean') return n.ready ? 'ok' : 'err';
  const conds: any[] = Array.isArray(nodeK8sStatus(n)?.conditions) ? nodeK8sStatus(n).conditions : [];
  const r = conds.find((c) => String(c?.type || '') === 'Ready');
  if (!r) return 'warn';
  return String(r.status).toLowerCase() === 'true' ? 'ok' : 'err';
}
