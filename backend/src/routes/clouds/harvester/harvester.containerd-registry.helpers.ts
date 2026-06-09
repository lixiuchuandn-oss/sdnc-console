/**
 * Harvester containerd-registry Setting 辅助函数
 */
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';

function extractHarvesterOrigin(base: string): string {
  let origin = base.replace(/\/+$/, '');
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  return origin;
}

export function normalizeRegistryServer(server: string): string {
  return server.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * 将 HTTP 私有仓库加入 Harvester containerd-registry（允许节点以 HTTP 拉取）
 */
export async function addInsecureRegistryToHarvesterContainerd(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  server: string,
): Promise<{ configured: boolean; server: string }> {
  const normalizedServer = normalizeRegistryServer(server);
  if (!normalizedServer) {
    throw new Error('无效的仓库地址');
  }

  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = cloud.secretKey || '';
  const origin = extractHarvesterOrigin(cloud.endpoint || '');

  const getUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
  const current = await getJsonOnce(getUrl, token, insecure, true);
  const resourceVersion =
    (current as any)?.metadata?.resourceVersion || (current as any)?.resourceVersion;

  let currentValue: {
    Mirrors?: Record<string, any>;
    Configs?: Record<string, any>;
    Auths?: null;
  } = {
    Mirrors: {},
    Configs: {},
    Auths: null,
  };
  try {
    const currentVal = (current as any)?.value;
    if (currentVal) {
      currentValue = typeof currentVal === 'string' ? JSON.parse(currentVal) : currentVal;
    }
  } catch {
    // 使用默认空结构
  }

  if (!currentValue.Mirrors) currentValue.Mirrors = {};
  if (!currentValue.Configs) currentValue.Configs = {};
  if (currentValue.Auths === undefined) currentValue.Auths = null;

  const httpEndpoint = `http://${normalizedServer}`;
  const mirror = currentValue.Mirrors[normalizedServer];
  const config = currentValue.Configs[normalizedServer];
  const alreadyConfigured =
    mirror?.Endpoints?.includes(httpEndpoint) &&
    config?.TLS?.InsecureSkipVerify === true;

  if (alreadyConfigured) {
    return { configured: false, server: normalizedServer };
  }

  currentValue.Mirrors[normalizedServer] = {
    Endpoints: [httpEndpoint],
    Rewrites: null,
  };
  currentValue.Configs[normalizedServer] = {
    Auth: null,
    TLS: {
      CAFile: '',
      CertFile: '',
      KeyFile: '',
      InsecureSkipVerify: true,
    },
  };

  const body = {
    metadata: {
      name: 'containerd-registry',
      resourceVersion,
    },
    value: JSON.stringify(currentValue),
  };

  const putUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
  await requestJson('PUT', putUrl, token, insecure, body);

  return { configured: true, server: normalizedServer };
}
