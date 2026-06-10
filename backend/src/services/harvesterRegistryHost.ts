/** 解析 Harvester 云资源对应的本地仓库对外 host（与 local-registry 创建逻辑一致） */

export function resolveHarvesterRegistryHost(cloud: {
  endpoint?: string;
  config?: { harvesterHost?: string };
}): string {
  let host = cloud.config?.harvesterHost || '';
  if (host) {
    host = host.replace(/^https?:\/\//, '').split('/')[0];
  }
  if (!host) {
    const base = cloud.endpoint || '';
    try {
      const url = new URL(base);
      host = url.hostname;
    } catch {
      host = base.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    }
  }
  return host;
}

export function buildHarvesterLocalRegistryServer(
  cloud: { endpoint?: string; config?: { harvesterHost?: string } },
  nodePort: number,
): string {
  const host = resolveHarvesterRegistryHost(cloud);
  return `${host}:${nodePort}`;
}
