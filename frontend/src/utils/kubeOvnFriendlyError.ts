/**
 * 将 Kube-OVN admission webhook 等英文/JSON 报错转为可读中文（1.md 9/12/22 等）。
 */
export function formatKubeOvnFriendlyError(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : raw != null ? String(raw) : '';
  if (!s.trim()) return '操作失败';

  const lower = s.toLowerCase();
  if (lower.includes("can't delete subnet when any ips in using") || lower.includes('any ips in using')) {
    return '当前子网仍有 IP 被占用（例如已分配给虚拟机），无法删除。请先释放相关 IP 或删除使用该子网的资源后再试。';
  }
  if (lower.includes('excludeips') && lower.includes('not a valid address')) {
    return '排除 IP 格式无效：请使用合法 IPv4 或 IPv4 区间；区间写法请使用两个英文点「..」连接起止地址（例如 192.168.1.10..192.168.1.20），勿使用单个连字符「-」。';
  }
  if (lower.includes('gateway') && lower.includes('is not in cidr')) {
    const m = /gateway\s+([0-9.]+)\s+is not in cidr\s+([0-9./]+)/i.exec(s);
    if (m) {
      return `网关地址 ${m[1]} 不在子网 CIDR ${m[2]} 范围内，请修改网关或 CIDR 后重试。`;
    }
    return '网关地址不在子网 CIDR 范围内，请检查网关与网段配置后重试。';
  }
  if (lower.includes('runstrategy') && lower.includes('halted') && lower.includes('manual restart')) {
    return '当前虚拟机运行策略为「保持停止」，不支持手动立即重启。请先将运行策略改为可运行状态后再执行重启。';
  }

  try {
    const j = JSON.parse(s) as { message?: string };
    if (j?.message && typeof j.message === 'string' && j.message !== s) {
      return formatKubeOvnFriendlyError(j.message);
    }
  } catch {
    /* 非 JSON */
  }

  const msgMatch = /"message"\s*:\s*"([^"]+)"/.exec(s);
  if (msgMatch?.[1]) {
    return formatKubeOvnFriendlyError(msgMatch[1]);
  }

  return s;
}
