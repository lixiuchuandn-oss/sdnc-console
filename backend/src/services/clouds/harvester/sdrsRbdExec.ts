/**
 * rook-ceph-tools Pod 发现（RBD 命令执行入口，M1 联调）。
 */
import { getJsonOnce } from './utils';

const DEFAULT_TOOLBOX_NAMESPACE = 'rook-ceph';
const TOOLBOX_LABEL_HINTS = ['rook-ceph-tools', 'ceph-tools', 'rbd-tools'];

function cloudOrigin(endpoint: string): string {
  const base = String(endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

async function resolveClusterId(
  origin: string,
  token: string,
  insecure: boolean,
): Promise<string | null> {
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true);
    const arr = Array.isArray(clusters?.data)
      ? clusters.data
      : Array.isArray(clusters?.items)
        ? clusters.items
        : [];
    const local = arr.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = arr[0];
    return String(local?.id || local?.Id || any?.id || any?.Id || '').trim() || null;
  } catch {
    return null;
  }
}

function listPodsUrls(origin: string, clusterId: string | null, namespace: string): string[] {
  const encNs = encodeURIComponent(namespace);
  return [
    ...(clusterId
      ? [`${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/namespaces/${encNs}/pods`]
      : []),
    `${origin}/api/v1/namespaces/${encNs}/pods`,
    `${origin}/v1/harvester/core.v1.pods/${encNs}`,
  ];
}

export type CephToolboxInfo = {
  namespace: string;
  podName: string;
};

export async function findCephToolboxPod(cloud: {
  endpoint?: string;
  secretKey?: string;
  config?: any;
}): Promise<CephToolboxInfo | null> {
  const token = cloud.secretKey || '';
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = cloudOrigin(String(cloud.endpoint || ''));
  const clusterId = await resolveClusterId(origin, token, insecure);
  const ns =
    String((cloud.config as any)?.cephRookNamespace || DEFAULT_TOOLBOX_NAMESPACE).trim() ||
    DEFAULT_TOOLBOX_NAMESPACE;

  let lastErr: any;
  for (const url of listPodsUrls(origin, clusterId, ns)) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray(json?.items)
        ? json.items
        : Array.isArray(json?.data)
          ? json.data
          : [];
      for (const pod of items) {
        const name = String(pod?.metadata?.name || pod?.name || '').trim();
        const phase = String(pod?.status?.phase || pod?.phase || '').trim();
        if (phase !== 'Running' || !name) continue;
        const lower = name.toLowerCase();
        if (TOOLBOX_LABEL_HINTS.some((h) => lower.includes(h)) || lower.includes('tools')) {
          return { namespace: ns, podName: name };
        }
      }
      for (const pod of items) {
        const name = String(pod?.metadata?.name || pod?.name || '').trim();
        const phase = String(pod?.status?.phase || pod?.phase || '').trim();
        if (
          phase === 'Running' &&
          name.toLowerCase().includes('rook') &&
          name.toLowerCase().includes('tool')
        ) {
          return { namespace: ns, podName: name };
        }
      }
    } catch (e: any) {
      lastErr = e;
    }
  }
  if (lastErr) {
    return null;
  }
  return null;
}

/**
 * M1：命令编排与联调占位。生产需在 toolbox Pod 内同步 exec `rbd migration`。
 * 设置 SDRS_MOCK_MIGRATION=1 可在无 Ceph 环境演示任务成功。
 */
export async function runToolboxRbdShell(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  command: string,
): Promise<{ stdout: string; mocked: boolean }> {
  if (String(process.env.SDRS_MOCK_MIGRATION || '').trim() === '1') {
    return { stdout: `[mock] ${command}`, mocked: true };
  }
  const toolbox = await findCephToolboxPod(cloud);
  if (!toolbox) {
    throw new Error(
      '未找到 rook-ceph-tools Pod。请确认 rook-ceph namespace 与 toolbox 已部署，或设置 SDRS_MOCK_MIGRATION=1 做演示。',
    );
  }
  throw new Error(
    `已发现 toolbox Pod ${toolbox.namespace}/${toolbox.podName}，RBD 命令同步 exec 待集群联调。命令: ${command}`,
  );
}
