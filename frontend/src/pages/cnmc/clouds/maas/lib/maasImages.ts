/** BFF 归一化操作系统分组（§13.3.2 普通用户视图） */
export type MaasImageVariant = {
  resource_id: number | string;
  label: string;
  architecture: string;
  size_bytes: number;
  status: 'ready' | 'downloading' | 'unknown';
  is_default: boolean;
  deployable: boolean;
};

export type MaasImageGroup = {
  group_id: string;
  display_name: string;
  osystem: string;
  distro_series: string;
  platform: 'linux' | 'windows' | 'other';
  default_resource_id: number | string;
  size_bytes: number;
  status: 'ready' | 'downloading' | 'unknown';
  deployable: boolean;
  variant_count: number;
  variants: MaasImageVariant[];
};

export function formatMaasImageSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const STATUS_LABEL: Record<MaasImageGroup['status'], string> = {
  ready: '就绪',
  downloading: '下载中',
  unknown: '—',
};

const PLATFORM_LABEL: Record<MaasImageGroup['platform'], string> = {
  linux: 'Linux',
  windows: 'Windows',
  other: '其他',
};

export function maasImageStatusLabel(status: MaasImageGroup['status']): string {
  return STATUS_LABEL[status] ?? status;
}

export function maasPlatformLabel(platform: MaasImageGroup['platform']): string {
  return PLATFORM_LABEL[platform] ?? platform;
}
