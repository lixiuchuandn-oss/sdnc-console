/** Paas Console（ibr-local-web）默认 HTTP 端口 */
export const IBR_LOCAL_WEB_DEFAULT_PORT = 3000;

export function resolveManagementHostIp(row: Record<string, unknown> | null | undefined): string {
  if (!row) return '';
  const raw = String(row.management_ip ?? row.managementIp ?? '').trim();
  if (!raw) return '';
  const host = raw.split('/')[0]?.trim() ?? '';
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return '';
  return host;
}

/** 由管理 IP 拼本机 Console URL；无管理 IP 时返回 null */
export function buildIbrLocalWebUrl(
  row: Record<string, unknown> | null | undefined,
  port: number = IBR_LOCAL_WEB_DEFAULT_PORT,
): string | null {
  const host = resolveManagementHostIp(row);
  if (!host) return null;
  return `http://${host}:${port}/`;
}

/** 新窗口打开本机 Console；成功返回 true */
export function openIbrLocalWeb(row: Record<string, unknown> | null | undefined): boolean {
  const url = buildIbrLocalWebUrl(row);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/** SDNC IBR 运维控制台（独立窗口，无 AdminLayout 侧栏） */
export function buildIbrConsoleUrl(
	vrUuid: string,
	panel?: string,
	tab?: string,
): string | null {
	const u = String(vrUuid || '').trim();
	if (!u) return null;
	const path = `/admin/interconnect/vr/${encodeURIComponent(u)}/console`;
	const params = new URLSearchParams();
	if (panel && String(panel).trim()) {
		params.set('panel', String(panel).trim());
	}
	if (tab && String(tab).trim()) {
		params.set('tab', String(tab).trim());
	}
	const qs = params.toString();
	return qs ? `${path}?${qs}` : path;
}

/** 新窗口打开 IBR 运维控制台 */
export function openIbrConsole(vrUuid: string, panel?: string, tab?: string): boolean {
	const url = buildIbrConsoleUrl(vrUuid, panel, tab);
  if (!url) return false;
  const abs = url.startsWith('http') ? url : `${window.location.origin}${url}`;
  window.open(abs, '_blank', 'noopener,noreferrer');
  return true;
}
