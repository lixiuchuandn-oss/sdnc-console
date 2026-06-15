/**
 * Harvester 1.5+ CDI 镜像下载：须先创建 VirtualMachineImageDownloader，就绪后再 GET Steve download。
 */
import {
  type HarvesterCloudEndpointLike,
  type HarvesterClusterApiRoots,
  resolveHarvesterClusterApiRootsAsync,
} from './vmImageClusterApi';
import { getJsonOnce, requestJson, resolveHarvesterCloudKubeToken } from './utils';

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function buildVmImageDownloaderUrls(
  roots: HarvesterClusterApiRoots,
  namespace: string,
  imageName: string,
): { createUrl: string; getUrls: string[] } {
  const encNs = encodeURIComponent(namespace);
  const encName = encodeURIComponent(imageName);
  const collection = `${roots.apiPrefix}/apis/harvesterhci.io/v1beta1/namespaces/${encNs}/virtualmachineimagedownloaders`;
  const item = `${collection}/${encName}`;
  const getUrls = [item];
  if (roots.apiPrefix !== roots.hostRoot) {
    getUrls.push(
      `${roots.hostRoot}/apis/harvesterhci.io/v1beta1/namespaces/${encNs}/virtualmachineimagedownloaders/${encName}`,
    );
  }
  return { createUrl: collection, getUrls: [...new Set(getUrls)] };
}

function isVmImageDownloaderReady(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const status = (obj as { status?: Record<string, unknown> }).status || {};
  if (status.ready === true) return true;
  const phase = String(status.phase || status.state || '').toLowerCase();
  if (phase === 'ready' || phase === 'completed' || phase === 'succeeded') return true;
  const conds = (status.conditions || []) as Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
  }>;
  for (const c of conds) {
    const t = String(c?.type || '');
    const st = String(c?.status || '');
    if (
      (t === 'Ready' || t === 'DownloadReady' || t === 'Initialized') &&
      (st === 'True' || st === 'true')
    ) {
      return true;
    }
  }
  return false;
}

function vmImageDownloaderFailureMessage(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const status = (obj as { status?: Record<string, unknown> }).status || {};
  const conds = (status.conditions || []) as Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
  }>;
  for (const c of conds) {
    const st = String(c?.status || '');
    if (st !== 'False' && st !== 'false') continue;
    const t = String(c?.type || '');
    if (t === 'Failed' || t === 'DownloadFailed' || t === 'Error') {
      return String(c.message || c.reason || '镜像下载准备失败');
    }
  }
  const msg = String(status.message || '').trim();
  if (msg && /fail|error/i.test(msg)) return msg;
  return null;
}

async function fetchVmImageDownloader(
  getUrls: string[],
  token: string,
  insecure: boolean,
): Promise<{ found: boolean; obj?: unknown; status?: number }> {
  for (const url of getUrls) {
    try {
      const obj = await getJsonOnce(url, token, insecure, true);
      return { found: true, obj };
    } catch (e: unknown) {
      const status = Number((e as { status?: number })?.status);
      if (status === 404) continue;
      throw e;
    }
  }
  return { found: false };
}

async function createVmImageDownloader(
  createUrl: string,
  namespace: string,
  imageName: string,
  token: string,
  insecure: boolean,
): Promise<void> {
  const body = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'VirtualMachineImageDownloader',
    metadata: {
      name: imageName,
      namespace,
    },
    spec: {
      imageName,
    },
  };
  try {
    await requestJson('POST', createUrl, token, insecure, body);
  } catch (e: unknown) {
    const status = Number((e as { status?: number })?.status);
    if (status === 409) return;
    const msg = String((e as { message?: string })?.message || e || '');
    if (/already exists/i.test(msg)) return;
    throw e;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type EnsureVmImageDownloaderOpts = {
  signal?: AbortSignal;
  timeoutMs?: number;
  onWaiting?: () => void;
};

/**
 * CDI / 第三方存储镜像：创建并等待 VirtualMachineImageDownloader 就绪（与 Harvester UI 点击下载前一致）。
 */
export async function ensureHarvesterVmImageDownloaderReady(
  cloud: HarvesterCloudEndpointLike,
  namespace: string,
  imageName: string,
  opts?: EnsureVmImageDownloaderOpts,
): Promise<void> {
  const ns = String(namespace || '').trim();
  const name = String(imageName || '').trim();
  if (!ns || !name) throw new Error('缺少镜像命名空间或名称');

  const roots = await resolveHarvesterClusterApiRootsAsync(cloud);
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const { createUrl, getUrls } = buildVmImageDownloaderUrls(roots, ns, name);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  let fetched = await fetchVmImageDownloader(getUrls, token, insecure);
  if (!fetched.found) {
    await createVmImageDownloader(createUrl, ns, name, token, insecure);
    fetched = await fetchVmImageDownloader(getUrls, token, insecure);
  }

  if (fetched.found && isVmImageDownloaderReady(fetched.obj)) return;

  while (Date.now() < deadline) {
    if (opts?.signal?.aborted) throw new Error('CANCELLED');
    opts?.onWaiting?.();
    await sleep(POLL_INTERVAL_MS);
    fetched = await fetchVmImageDownloader(getUrls, token, insecure);
    if (!fetched.found) {
      await createVmImageDownloader(createUrl, ns, name, token, insecure);
      continue;
    }
    const failMsg = vmImageDownloaderFailureMessage(fetched.obj);
    if (failMsg) throw new Error(failMsg);
    if (isVmImageDownloaderReady(fetched.obj)) return;
  }

  throw new Error('等待镜像下载准备超时，请稍后重试');
}
