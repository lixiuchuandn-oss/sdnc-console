/**
 * Harvester VirtualMachineImage 下载 URL 解析。
 * 底座 canonical：
 * - download：{host}/v1/harvester/harvesterhci.io.virtualmachineimages/{ns}/{name}/download
 * - downloadcancel：GET .../virtualmachineimages/{ns}/{name}?link=downloadcancel（Steve LinkHandler）
 */
import {
  type HarvesterCloudEndpointLike,
  type HarvesterClusterApiRoots,
  isLikelyRancherManagementEndpoint,
  resolveHarvesterClusterApiRootsAsync,
  resolveHarvesterRancherOrigin,
} from './vmImageClusterApi';
import { requestJson, resolveHarvesterCloudKubeToken } from './utils';

function rancherClusterPathSuffix(roots: HarvesterClusterApiRoots): string {
  const { apiPrefix, hostRoot } = roots;
  if (apiPrefix === hostRoot) return '';
  if (!apiPrefix.startsWith(hostRoot)) return '';
  return apiPrefix.slice(hostRoot.length);
}

function isSteveHarvesterPath(pathOrUrl: string): boolean {
  return String(pathOrUrl || '').includes('/v1/harvester/');
}

/** 底座 Steve 镜像下载 URL（与 Harvester UI / links.download 一致） */
export function buildHarvesterVmImageSteveDownloadUrl(
  hostRoot: string,
  namespace: string,
  name: string,
): string {
  const base = String(hostRoot || '').replace(/\/+$/, '');
  const encNs = encodeURIComponent(namespace);
  const encName = encodeURIComponent(name);
  return `${base}/v1/harvester/harvesterhci.io.virtualmachineimages/${encNs}/${encName}/download`;
}

/** 底座 Steve 镜像下载取消 URL（与 Harvester UI links.downloadcancel / ?link=downloadcancel 一致） */
export function buildHarvesterVmImageSteveDownloadCancelUrl(
  hostRoot: string,
  namespace: string,
  name: string,
): string {
  const base = String(hostRoot || '').replace(/\/+$/, '');
  const encNs = encodeURIComponent(namespace);
  const encName = encodeURIComponent(name);
  return `${base}/v1/harvester/harvesterhci.io.virtualmachineimages/${encNs}/${encName}?link=downloadcancel`;
}

/** 仅对 subresources 等非 Steve 路径补全 Rancher /k8s/clusters/{id} */
export function rewriteRancherProxiedHarvesterUrl(
  url: string,
  roots: HarvesterClusterApiRoots,
): string {
  if (isSteveHarvesterPath(url)) return url;
  const suffix = rancherClusterPathSuffix(roots);
  if (!suffix) return url;
  try {
    const u = new URL(url);
    if (u.pathname.includes('/k8s/clusters/')) return url;
    const marker = '/apis/subresources.harvesterhci.io/';
    const idx = u.pathname.indexOf(marker);
    if (idx >= 0) {
      u.pathname = `${suffix}${u.pathname.slice(idx)}`;
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return url;
}

/** 将相对路径或绝对 URL 规范为可请求地址；Steve 下载始终落在 host 根路径 */
export function resolveHarvesterClusterResourceUrl(
  roots: HarvesterClusterApiRoots,
  pathOrUrl: string,
): string {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    if (isSteveHarvesterPath(raw)) return raw;
    return rewriteRancherProxiedHarvesterUrl(raw, roots);
  }

  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const { apiPrefix, hostRoot } = roots;
  if (isSteveHarvesterPath(path)) {
    return `${hostRoot.replace(/\/+$/, '')}${path}`;
  }
  if (path.startsWith('/k8s/clusters/')) return `${hostRoot}${path}`;
  if (apiPrefix !== hostRoot) return `${apiPrefix}${path}`;
  return `${hostRoot}${path}`;
}

export function resolveDownloadUrlFromVmImagePayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const r = payload as Record<string, unknown>;
  const data = r.data as Record<string, unknown> | undefined;
  const candidates = [
    (r.links as Record<string, unknown> | undefined)?.download,
    (r.actions as Record<string, unknown> | undefined)?.download,
    (data?.links as Record<string, unknown> | undefined)?.download,
    (data?.actions as Record<string, unknown> | undefined)?.download,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

export function resolveDownloadCancelUrlFromVmImagePayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const r = payload as Record<string, unknown>;
  const data = r.data as Record<string, unknown> | undefined;
  const candidates = [
    (r.links as Record<string, unknown> | undefined)?.downloadcancel,
    (r.actions as Record<string, unknown> | undefined)?.downloadcancel,
    (data?.links as Record<string, unknown> | undefined)?.downloadcancel,
    (data?.actions as Record<string, unknown> | undefined)?.downloadcancel,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return undefined;
}

export async function resolveVmImageDownloadLinkCandidates(
  cloud: HarvesterCloudEndpointLike,
  namespace: string,
  name: string,
  linksDownload?: string,
): Promise<string[]> {
  const endpoint = String(cloud.endpoint || cloud.config?.endpoint || '').trim();
  const hostRoot = resolveHarvesterRancherOrigin(endpoint);
  const roots = await resolveHarvesterClusterApiRootsAsync(cloud);
  const encNs = encodeURIComponent(namespace);
  const encName = encodeURIComponent(name);
  const stevePath = `/v1/harvester/harvesterhci.io.virtualmachineimages/${encNs}/${encName}/download`;
  const steveDirect = buildHarvesterVmImageSteveDownloadUrl(hostRoot, namespace, name);
  const out: string[] = [];

  const link = String(linksDownload || '').trim();
  if (link) {
    if (/^https?:\/\//i.test(link) && isSteveHarvesterPath(link)) {
      out.push(link);
    } else {
      out.push(resolveHarvesterClusterResourceUrl(roots, link));
    }
  }

  // 底座 canonical（优先于 subresources / k8s/clusters 代理路径）
  out.push(steveDirect);

  const { apiPrefix } = roots;
  if (apiPrefix !== hostRoot) {
    out.push(`${apiPrefix.replace(/\/+$/, '')}${stevePath}`);
  }

  if (isLikelyRancherManagementEndpoint(endpoint)) {
    out.push(`${hostRoot.replace(/\/+$/, '')}/k8s/clusters/local${stevePath}`);
  }

  return [...new Set(out.filter(Boolean))];
}

export async function resolveVmImageDownloadCancelLinkCandidates(
  cloud: HarvesterCloudEndpointLike,
  namespace: string,
  name: string,
  linksDownloadCancel?: string,
): Promise<string[]> {
  const endpoint = String(cloud.endpoint || cloud.config?.endpoint || '').trim();
  const hostRoot = resolveHarvesterRancherOrigin(endpoint);
  const roots = await resolveHarvesterClusterApiRootsAsync(cloud);
  const encNs = encodeURIComponent(namespace);
  const encName = encodeURIComponent(name);
  const stevePath = `/v1/harvester/harvesterhci.io.virtualmachineimages/${encNs}/${encName}?link=downloadcancel`;
  const steveDirect = buildHarvesterVmImageSteveDownloadCancelUrl(hostRoot, namespace, name);
  const out: string[] = [];

  const link = String(linksDownloadCancel || '').trim();
  if (link) {
    if (/^https?:\/\//i.test(link) && isSteveHarvesterPath(link)) {
      out.push(link);
    } else {
      out.push(resolveHarvesterClusterResourceUrl(roots, link));
    }
  }

  // 底座 canonical（优先于 k8s/clusters 代理路径）
  out.push(steveDirect);

  const { apiPrefix } = roots;
  if (apiPrefix !== hostRoot) {
    out.push(`${apiPrefix.replace(/\/+$/, '')}${stevePath}`);
  }

  if (isLikelyRancherManagementEndpoint(endpoint)) {
    out.push(`${hostRoot.replace(/\/+$/, '')}/k8s/clusters/local${stevePath}`);
  }

  return [...new Set(out.filter(Boolean))];
}

/**
 * 调用 Harvester downloadcancel（GET ?link=downloadcancel），终止 CDI 导出并删除 VirtualMachineImageDownloader。
 * BackingImage 后端为 no-op；404/已删除视为成功。
 */
export async function requestHarvesterVmImageDownloadCancel(
  cloud: HarvesterCloudEndpointLike,
  namespace: string,
  imageName: string,
  opts?: { linksDownloadCancel?: string },
): Promise<void> {
  const ns = String(namespace || '').trim();
  const name = String(imageName || '').trim();
  if (!ns || !name) return;

  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const urls = await resolveVmImageDownloadCancelLinkCandidates(
    cloud,
    ns,
    name,
    opts?.linksDownloadCancel,
  );
  const errors: Error[] = [];

  for (const url of urls) {
    try {
      await requestJson('GET', url, token, insecure, undefined, { Accept: '*/*' });
      return;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      const status = Number((e as { status?: number })?.status);
      const msg = err.message || '';
      if (status === 404 || /not found/i.test(msg)) {
        return;
      }
      errors.push(err);
    }
  }

  if (errors.length) {
    throw errors[0];
  }
  throw new Error('无法调用集群 downloadcancel');
}

/** 优先展示底座真实错误（如 downloader 未就绪），避免被 subresources 404 掩盖 */
export function pickHarvesterDownloadErrorMessage(errors: Error[]): string {
  if (!errors.length) return '无法从 Harvester 下载镜像';
  const scored = errors.map((e) => {
    const m = e.message || '';
    let score = 0;
    if (m.includes('virtualmachineimagedownloaders')) score += 10;
    if (m.includes('vm image downloader')) score += 10;
    if (m.includes('please wait until the image has been imported')) score += 8;
    if (!m.includes('404 page not found')) score += 5;
    if (m.includes('HTTP 500')) score += 3;
    return { e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].e.message || '无法从 Harvester 下载镜像';
}

export function guessVmImageDownloadFilename(
  displayName: string,
  imageName: string,
  imageType?: string,
  diskFormat?: string,
): string {
  const base = String(displayName || imageName || 'image')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_');
  const lowerType = String(imageType || '').toLowerCase();
  const lowerFmt = String(diskFormat || '').toLowerCase();
  if (lowerType === 'iso' || lowerFmt === 'iso') {
    return base.endsWith('.iso') ? base : `${base}.iso`;
  }
  if (base.match(/\.(qcow2|qcow|img|raw|iso)$/i)) return base;
  if (lowerFmt === 'raw') return `${base}.img`;
  return `${base}.qcow2`;
}
