import type { MaasControllerView, MaasDashboardResponse } from '../../../../../services/maasApi';

export const MAAS_DASHBOARD_POLL_MS = 30_000;
export const MAAS_CONFIG_SECTION_ID = 'maas-region-config';
export const MAAS_CONTROLLERS_SECTION_ID = 'maas-controllers';

export function maasDashValue(connected: boolean, n: number): number | string {
  return connected ? n : '—';
}

export function maasControllerOnlineCount(items: MaasControllerView[]): number {
  return items.filter((c) => c.online).length;
}

export function maasControllerFooter(items: MaasControllerView[]): string {
  if (!items.length) return '暂无数据';
  return items.map((c) => `${c.hostname} ${c.online ? '在线' : '离线'}`).join(' · ');
}

export function maasScrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function maasOsImageFooter(data: MaasDashboardResponse | null, connected: boolean): string | undefined {
  if (!connected || !data) return undefined;
  if (data.sync?.images_importing) return '镜像同步中…';
  if ((data.os_images_count ?? 0) > 0) {
    const first = data.os_images?.[0];
    const n = data.os_images_count ?? 0;
    return first && n > 1 ? `${first} 等 ${n} 个` : first || `${n} 个可用`;
  }
  return '暂无可用镜像';
}
