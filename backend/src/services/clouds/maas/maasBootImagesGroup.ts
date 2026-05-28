import type { MaasImageNormalized } from './maasBootImages';

/** 可部署 OS 白名单（与 integrate §13.3.2 一致） */
const DEPLOYABLE_OS = new Set([
  'ubuntu',
  'ubuntu-core',
  'centos',
  'rhel',
  'windows',
  'suse',
  'ol',
  'esxi',
  'custom',
]);

const BOOTLOADER_PREFIXES = ['grub', 'pxelinux', 'syslinux', 'bootloader'] as const;

const UBUNTU_RELEASE_LABEL: Record<string, string> = {
  jammy: '22.04 LTS',
  noble: '24.04 LTS',
  focal: '20.04 LTS',
  bionic: '18.04 LTS',
};

const CENTOS_RELEASE_LABEL: Record<string, string> = {
  centos7: '7',
  centos8: '8',
  centos6: '6',
};

const WINDOWS_RELEASE_LABEL: Record<string, string> = {
  win10: '10',
  win11: '11',
  win2019: 'Server 2019',
  win2022: 'Server 2022',
};

export type MaasImageVariant = {
  resource_id: number | string;
  label: string;
  architecture: string;
  size_bytes: number;
  status: MaasImageNormalized['status'];
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
  status: MaasImageNormalized['status'];
  deployable: boolean;
  variant_count: number;
  variants: MaasImageVariant[];
};

export function parseBootResourceName(name: string): { osystem: string; release: string } {
  const n = String(name || '').trim();
  const idx = n.indexOf('/');
  if (idx < 0) return { osystem: n.toLowerCase(), release: '' };
  return {
    osystem: n.slice(0, idx).toLowerCase(),
    release: n.slice(idx + 1),
  };
}

/** 列表项是否为用户可见的操作系统（排除 grub/pxelinux 等） */
export function isDeployableOsImageListItem(item: Record<string, unknown>): boolean {
  const name = String(item.name ?? '');
  const { osystem, release } = parseBootResourceName(name);
  if (!release) return false;
  if (BOOTLOADER_PREFIXES.some((p) => osystem.startsWith(p))) return false;
  return DEPLOYABLE_OS.has(osystem);
}

export function formatMaasImageDisplayName(
  osystem: string,
  release: string,
  rawTitle?: string,
): string {
  const os = osystem.toLowerCase();
  const title = String(rawTitle ?? '').trim();

  if (os === 'custom') {
    return title || release || '自定义镜像';
  }
  if (os === 'ubuntu' || os === 'ubuntu-core') {
    const ver = UBUNTU_RELEASE_LABEL[release];
    if (ver) return `Ubuntu ${ver}`;
  }
  if (os === 'centos') {
    const ver = CENTOS_RELEASE_LABEL[release] || release;
    return `CentOS ${ver}`;
  }
  if (os === 'rhel') {
    return `Red Hat Enterprise Linux ${release}`;
  }
  if (os === 'windows') {
    const ver = WINDOWS_RELEASE_LABEL[release] || release;
    return ver.toLowerCase().includes('server') ? `Windows ${ver}` : `Windows ${ver}`;
  }
  if (os === 'suse') {
    return title || `SUSE ${release}`;
  }
  if (os === 'ol') {
    return `Oracle Linux ${release}`;
  }
  if (os === 'esxi') {
    return `VMware ESXi ${release}`;
  }

  const base = osystem.charAt(0).toUpperCase() + osystem.slice(1);
  return title || `${base} ${release}`.trim();
}

function resolvePlatform(osystem: string): MaasImageGroup['platform'] {
  const os = osystem.toLowerCase();
  if (os === 'windows') return 'windows';
  if (['ubuntu', 'ubuntu-core', 'centos', 'rhel', 'suse', 'ol', 'custom', 'esxi'].includes(os)) {
    return 'linux';
  }
  return 'other';
}

function variantLabel(architecture: string): string {
  const a = architecture.toLowerCase();
  if (a.includes('hwe') && a.includes('edge')) return 'HWE Edge 内核';
  if (a.includes('hwe')) return 'HWE 内核';
  if (a.includes('lowlatency')) return '低延迟内核';
  if (a.includes('ga-')) {
    const tail = a.split('/').pop() || a;
    return `通用内核 (${tail})`;
  }
  if (a.includes('generic')) return '通用内核';
  return architecture || '—';
}

/** 默认变体优先级（分数越高越优先） */
function defaultVariantScore(architecture: string): number {
  const a = architecture.toLowerCase();
  if (a.includes('ga-') && /\d{2}\.\d{2}/.test(a)) return 100;
  if (a === 'amd64/generic' || a.endsWith('/generic')) return 80;
  if (a.includes('edge') || a.includes('lowlatency') || a.includes('hwe')) return 20;
  return 50;
}

function pickDefaultVariant(items: MaasImageNormalized[]): MaasImageNormalized {
  return [...items].sort((a, b) => {
    const scoreDiff =
      defaultVariantScore(b.architecture) - defaultVariantScore(a.architecture);
    if (scoreDiff !== 0) return scoreDiff;
    return b.size_bytes - a.size_bytes;
  })[0];
}

function groupKey(osystem: string, release: string): string {
  return `${osystem}:${release}`;
}

/** 将已拉取详情的资源列表合并为普通用户视图 */
export function groupMaasImageResources(resources: MaasImageNormalized[]): MaasImageGroup[] {
  const buckets = new Map<string, MaasImageNormalized[]>();

  for (const r of resources) {
    const { osystem, release } = parseBootResourceName(r.name);
    if (!release || !DEPLOYABLE_OS.has(osystem)) continue;
    if (BOOTLOADER_PREFIXES.some((p) => osystem.startsWith(p))) continue;

    const key = groupKey(osystem, release);
    const list = buckets.get(key) || [];
    list.push(r);
    buckets.set(key, list);
  }

  const groups: MaasImageGroup[] = [];

  for (const [key, members] of buckets) {
    if (!members.length) continue;
    const defaultItem = pickDefaultVariant(members);
    const { osystem, release } = parseBootResourceName(defaultItem.name);
    const variants: MaasImageVariant[] = members.map((m) => ({
      resource_id: m.id,
      label: variantLabel(m.architecture),
      architecture: m.architecture,
      size_bytes: m.size_bytes,
      status: m.status,
      is_default: m.id === defaultItem.id,
      deployable: m.deployable,
    }));

    const anyDownloading = members.some((m) => m.status === 'downloading');
    const status = anyDownloading ? 'downloading' : defaultItem.status;

    groups.push({
      group_id: key,
      display_name: formatMaasImageDisplayName(osystem, release, defaultItem.title),
      osystem,
      distro_series: release,
      platform: resolvePlatform(osystem),
      default_resource_id: defaultItem.id,
      size_bytes: defaultItem.size_bytes,
      status,
      deployable: defaultItem.deployable,
      variant_count: members.length,
      variants,
    });
  }

  groups.sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh-CN'));
  return groups;
}

function isBootResourceListItemDeployable(item: Record<string, unknown>): boolean {
  if (item.last_deployable === true) return true;
  if (item.last_deployable === false) return false;
  const sets = item.sets;
  if (sets && typeof sets === 'object') {
    const entries = Array.isArray(sets)
      ? sets
      : Object.values(sets as Record<string, Record<string, unknown>>);
    if (entries.some((s) => s && typeof s === 'object' && (s as Record<string, unknown>).complete === true)) {
      return true;
    }
    if (entries.length > 0 && entries.every((s) => (s as Record<string, unknown>)?.complete === false)) {
      return false;
    }
  }
  return true;
}

/** 概览页 OS 摘要：仅 boot-resources 列表 + 白名单分组，不拉详情 */
export function summarizeOsImagesFromBootResourceList(items: Record<string, unknown>[]): {
  os_images_count: number;
  os_images: string[];
} {
  const groups = new Map<string, { osystem: string; release: string; deployable: boolean }>();

  for (const item of items) {
    if (!isDeployableOsImageListItem(item)) continue;
    const name = String(item.name ?? '');
    const { osystem, release } = parseBootResourceName(name);
    const key = groupKey(osystem, release);
    const deployable = isBootResourceListItemDeployable(item);
    const prev = groups.get(key);
    groups.set(key, {
      osystem,
      release,
      deployable: (prev?.deployable ?? false) || deployable,
    });
  }

  const ready = [...groups.values()].filter((g) => g.deployable);
  const names = ready
    .map((g) => formatMaasImageDisplayName(g.osystem, g.release))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));

  return { os_images_count: names.length, os_images: names };
}
