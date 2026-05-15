/**
 * RBD 存储池「配置」：与 Ceph Dashboard Pools → 配置 Tab 同源，
 * 数据来自 `GET /api/pool/{pool_name}/configuration`（RbdConfiguration.list，主要为 QoS）。
 * 参考：ceph/dashboard/services/rbd.py、rbd-configuration.service.ts、rbd-configuration-list.component.ts
 */

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

export type RbdQosValueType = 'bps' | 'iops';

export type RbdPoolConfigurationTableRow = {
  key: string;
  displayName: string;
  description: string;
  optionKey: string;
  sourceLabel: string;
  valueDisplay: string;
};

/** 与 Dashboard `RbdConfigurationService` QoS 段顺序、筛选项一致（创建/编辑池表单复用） */
export const CEPH_RBD_QOS_FIELD_META: ReadonlyArray<{
  name: string;
  displayName: string;
  description: string;
  valueType: RbdQosValueType;
}> = [
  {
    name: 'rbd_qos_bps_limit',
    displayName: 'BPS 上限',
    description: '所需的每秒 IO 字节数上限。',
    valueType: 'bps',
  },
  {
    name: 'rbd_qos_iops_limit',
    displayName: 'IOPS 上限',
    description: '所需的每秒 IO 操作次数上限。',
    valueType: 'iops',
  },
  {
    name: 'rbd_qos_read_bps_limit',
    displayName: '读 BPS 上限',
    description: '所需的每秒内读取的字节数上限。',
    valueType: 'bps',
  },
  {
    name: 'rbd_qos_read_iops_limit',
    displayName: '读 IOPS 上限',
    description: '所需的每秒读操作次数上限。',
    valueType: 'iops',
  },
  {
    name: 'rbd_qos_write_bps_limit',
    displayName: '写 BPS 上限',
    description: '所需的每秒内写入的字节数上限。',
    valueType: 'bps',
  },
  {
    name: 'rbd_qos_write_iops_limit',
    displayName: '写 IOPS 上限',
    description: '所需的每秒写操作次数上限。',
    valueType: 'iops',
  },
  {
    name: 'rbd_qos_bps_burst',
    displayName: 'BPS 突发',
    description: '所需的 IO 字节数突发上限。',
    valueType: 'bps',
  },
  {
    name: 'rbd_qos_iops_burst',
    displayName: 'IOPS 突发',
    description: '所需的 IO 操作次数突发上限。',
    valueType: 'iops',
  },
  {
    name: 'rbd_qos_read_bps_burst',
    displayName: '读 BPS 突发',
    description: '所需的读取的字节数突发上限。',
    valueType: 'bps',
  },
  {
    name: 'rbd_qos_read_iops_burst',
    displayName: '读 IOPS 突发',
    description: '所需的读操作次数突发上限。',
    valueType: 'iops',
  },
  {
    name: 'rbd_qos_write_bps_burst',
    displayName: '写 BPS 突发',
    description: '所需的写入的字节数突发上限。',
    valueType: 'bps',
  },
  {
    name: 'rbd_qos_write_iops_burst',
    displayName: '写 IOPS 突发',
    description: '所需的写操作次数突发上限。',
    valueType: 'iops',
  },
];

const RBD_QOS_OPTIONS = CEPH_RBD_QOS_FIELD_META;

const KNOWN_QOS_NAMES = new Set(RBD_QOS_OPTIONS.map((o) => o.name));

export function parseRbdConfigNumericValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Dashboard：`RbdConfigurationSourceField` 0 全局 / 1 池 / 2 镜像 */
export function formatRbdPoolConfigSource(source: unknown): string {
  if (typeof source === 'string') {
    const s = source.trim().toLowerCase();
    if (s === 'global' || s === '0') return '全局';
    if (s === 'pool' || s === '1') return '池';
    if (s === 'image' || s === '2') return '镜像';
  }
  const n = typeof source === 'number' ? source : NaN;
  if (n === 0) return '全局';
  if (n === 1) return '池';
  if (n === 2) return '镜像';
  return '';
}

function formatBpsLikeDashboard(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B/s';
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)} B/s`;
  const dec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(dec)} ${units[i]}`;
}

function formatIopsLikeDashboard(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 IOPS';
  return `${Math.round(n)} IOPS`;
}

export function formatRbdPoolConfigValue(valueType: RbdQosValueType, value: unknown): string {
  const n = parseRbdConfigNumericValue(value);
  if (n == null) return '';
  return valueType === 'bps' ? formatBpsLikeDashboard(n) : formatIopsLikeDashboard(n);
}

/**
 * 解析 Dashboard `configuration` 接口返回的数组（元素含 name / source / value）。
 * 仅保留与官方 UI 相同的 12 项 QoS 键，顺序与 Dashboard 服务定义一致。
 */
export function buildRbdPoolConfigurationTableRows(apiPayload: unknown): RbdPoolConfigurationTableRow[] {
  let list: unknown = apiPayload;
  if (isPlainRecord(apiPayload) && Array.isArray(apiPayload.configuration)) {
    list = apiPayload.configuration;
  }
  if (!Array.isArray(list)) return [];
  const byName = new Map<string, { source: unknown; value: unknown }>();
  for (const item of list) {
    if (!isPlainRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name : typeof item.key === 'string' ? item.key : '';
    if (!name || !KNOWN_QOS_NAMES.has(name)) continue;
    byName.set(name, { source: item.source, value: item.value });
  }
  const rows: RbdPoolConfigurationTableRow[] = [];
  for (const meta of RBD_QOS_OPTIONS) {
    const hit = byName.get(meta.name);
    if (!hit) continue;
    rows.push({
      key: meta.name,
      displayName: meta.displayName,
      description: meta.description,
      optionKey: meta.name,
      sourceLabel: formatRbdPoolConfigSource(hit.source),
      valueDisplay: formatRbdPoolConfigValue(meta.valueType, hit.value),
    });
  }
  return rows;
}

/** 从单池 `configuration` 数组填充 QoS 数值（未出现的项为 0），供创建/编辑表单 */
export function qosValuesFromDashboardConfigurationList(configuration: unknown): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(
    CEPH_RBD_QOS_FIELD_META.map((o) => [o.name, 0]),
  ) as Record<string, number>;
  if (!Array.isArray(configuration)) return out;
  for (const item of configuration) {
    if (!isPlainRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name || !(name in out)) continue;
    const n = parseRbdConfigNumericValue(item.value);
    if (n != null) out[name] = n;
  }
  return out;
}
