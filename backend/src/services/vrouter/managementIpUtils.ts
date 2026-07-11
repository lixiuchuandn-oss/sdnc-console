/** 将 CIDR 或裸 IPv4 规范为管理口主机地址（无掩码）。 */
export function normalizeManagementIp(raw: unknown): string {
  const t = String(raw ?? '').trim();
  if (!t || t === '-') {
    throw new Error('management_ip 不能为空');
  }
  const host = t.split('/')[0]?.trim() ?? '';
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) {
    throw new Error('management_ip 格式无效（须为 IPv4 或 IPv4/CIDR）');
  }
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error('management_ip 格式无效（须为 IPv4 或 IPv4/CIDR）');
    }
  }
  return host;
}
