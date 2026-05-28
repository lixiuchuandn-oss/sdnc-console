/** MAAS NodeStatus 与界面展示（见 docs/maas-integration.md） */
export const MAAS_STATUS_BY_CODE: Record<number, string> = {
  0: '新建',
  1: '纳管中',
  4: '可用',
  6: '运行中',
  7: '已下线',
  8: '故障',
  9: '部署中',
  10: '已分配',
  12: '回收中',
};

export function resolveMaasStatusLabel(machine: Record<string, unknown>): string {
  const name = String(machine.status_name || machine.status_name_display || '').trim();
  if (name) {
    const lower = name.toLowerCase();
    if (lower.includes('deployed')) return '运行中';
    if (lower.includes('ready')) return '可用';
    if (lower.includes('commission')) return '纳管中';
    if (lower.includes('deploying')) return '部署中';
    if (lower.includes('releasing')) return '回收中';
    if (lower.includes('broken')) return '故障';
    if (lower.includes('failed')) return '失败';
    if (lower.includes('new')) return '新建';
    return name;
  }
  const code = Number(machine.status);
  if (!Number.isNaN(code) && MAAS_STATUS_BY_CODE[code] !== undefined) {
    return MAAS_STATUS_BY_CODE[code];
  }
  return '—';
}

export function maasStatusLabelByCode(code: string): string {
  const n = Number(code);
  if (!Number.isNaN(n) && MAAS_STATUS_BY_CODE[n]) return MAAS_STATUS_BY_CODE[n];
  return code || '未知';
}

export function normalizeMaasMachineRow(raw: Record<string, unknown>): {
  raw: Record<string, unknown>;
  systemId: string;
  hostname: string;
  statusLabel: string;
  cpu: string;
  memoryGiB: string;
  os: string;
  arch: string;
  powerType: string;
} {
  const systemId = String(raw.system_id || raw.id || '').trim() || '—';
  const hostname = String(
    raw.fqdn || raw.hostname || raw.name || systemId,
  ).trim();
  const memMiB = Number(raw.memory_MiB ?? raw.memory ?? 0);
  const memoryGiB =
    memMiB > 0 ? `${(memMiB / 1024).toFixed(1)} GiB` : '—';
  const cpu = raw.cpu_count != null ? String(raw.cpu_count) : '—';
  const osystem = String(raw.osystem || '').trim();
  const series = String(raw.distro_series || '').trim();
  const os = [osystem, series].filter(Boolean).join(' ') || '—';
  return {
    raw,
    systemId,
    hostname,
    statusLabel: resolveMaasStatusLabel(raw),
    cpu,
    memoryGiB,
    os,
    arch: String(raw.architecture || '—'),
    powerType: String(raw.power_type || '—'),
  };
}
