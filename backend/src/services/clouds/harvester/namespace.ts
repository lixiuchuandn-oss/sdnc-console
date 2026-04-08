import { HarvesterTestParams } from './types';
import { requestJson, getJsonOnce } from './utils';

export const isProtectedNamespace = (name: string): boolean => {
  if (!name) return false;
  const lower = name.toLowerCase();
  
  // Exact match blacklist (System & Public namespaces)
  const exactBlacklist = [
    'default',
    'kube-system',
    'kube-public',
    'kube-node-lease',
    'harvester-system',
    'cattle-system',
    'cattle-fleet-system',
    'cattle-global-data',
    'cattle-global-nt',
    'longhorn-system',
    'ingress-nginx',
    'monitoring-system',
    'fleet-system',
    'fleet-default',
    'fleet-local',
    'cloud-public',
    'harvester-public'
  ];
  if (exactBlacklist.includes(lower)) return true;

  // Prefix match blacklist (Aligned with frontend isSystemNamespace logic)
  const prefixBlacklist = [
    'cattle',
    'fleet',
    'longhorn',
    'kube',
    'harvester',
    'cluster',
    'local',
    'ingress',
    'user-' // Keep user- with hyphen as specific backend rule
  ];
  return prefixBlacklist.some(p => lower.startsWith(p));
};

/**
 * 与前端 `harvesterUtils.isPublicNamespace` 一致：列表 excludeSystem 时仍返回这些名字
 */
export const isPublicNamespaceName = (name: string): boolean => {
  const n = String(name || '').trim().toLowerCase();
  return ['cloud-public', 'default', 'harvester-public'].includes(n);
};

/**
 * 与前端 `harvesterUtils.isSystemNamespace` 一致（前缀判定）
 */
export const isSystemNamespaceName = (name: string): boolean => {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  const prefixes = [
    'cattle',
    'fleet',
    'longhorn',
    'kube',
    'harvester',
    'cluster-fleet',
    'cluster',
    'local',
    'ingress',
  ];
  return prefixes.some((p) => n.startsWith(p));
};

/**
 * GET 列表 `excludeSystem=true` 时是否应从结果中移除。
 * 规则：先放行公共名（与前端一致）；再按前端系统前缀隐藏；其余仍按 isProtectedNamespace（如 monitoring-system、user-*）
 */
export const shouldHideNamespaceWhenExcludeSystem = (name: string): boolean => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  if (isPublicNamespaceName(trimmed)) return false;
  if (isSystemNamespaceName(trimmed)) return true;
  return isProtectedNamespace(trimmed);
};

/**
 * 判断命名空间是否由 Tower 平台创建和管理
 * @param namespace 命名空间对象（包含 metadata.labels）
 * @returns 如果是平台创建的返回 true，否则返回 false
 */
export const isTowerManagedNamespace = (namespace: any): boolean => {
  if (!namespace || !namespace.metadata) return false;
  const labels = namespace.metadata.labels || {};
  return labels['tower.io/managed'] === 'true';
};

/**
 * 获取命名空间的场景类型
 * @param namespace 命名空间对象（包含 metadata.labels）
 * @returns 'public' | 'tenant' | null
 */
export const getNamespaceScenario = (namespace: any): 'public' | 'tenant' | null => {
  if (!namespace || !namespace.metadata) return null;
  const labels = namespace.metadata.labels || {};
  const scenario = labels['tower.io/scenario'];
  if (scenario === 'public' || scenario === 'tenant') {
    return scenario;
  }
  return null;
};

/**
 * 创建 Harvester 命名空间
 * @param params 连接参数
 * @param name 命名空间名称
 * @param annotations 注解（可选）
 * @param options 选项（可选）
 * @param options.scenario 场景类型：'public' | 'tenant'，用于标识是公共空间还是租户空间
 * @param options.addFinalizer 是否添加终结器，默认为 true
 * @param options.bindingLabels 灾备/关联用稳定 ID（写入 metadata.labels），如 tenant-id、organization-id、cloud-id
 */
export const createHarvesterNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
  annotations?: Record<string, string>,
  options?: {
    scenario?: 'public' | 'tenant';
    addFinalizer?: boolean;
    bindingLabels?: Record<string, string>;
  },
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces`;
  
  // 构建标签：标识是平台创建的命名空间（与虚拟机统一）
  const labels: Record<string, string> = {
    'kubernetes.io/metadata.name': name,
    'tower.io/managed': 'true', // 标识是 Tower 平台管理的命名空间
    'tower.io/creator': 'compute-tower', // 标识资源归属（与虚拟机统一）
  };
  
  // 根据场景添加标签
  if (options?.scenario === 'public') {
    labels['tower.io/scenario'] = 'public';
  } else if (options?.scenario === 'tenant') {
    labels['tower.io/scenario'] = 'tenant';
  }

  if (options?.bindingLabels) {
    Object.assign(labels, options.bindingLabels);
  }
  
  // 构建注解：合并用户提供的注解
  const finalAnnotations: Record<string, string> = {
    ...annotations,
  };
  
  // 如果没有提供场景信息，尝试从注解中推断
  if (!options?.scenario && annotations) {
    if (name === 'cloud-public' || annotations['tower.io/public']) {
      labels['tower.io/scenario'] = 'public';
    } else if (annotations['tower.io/tenant'] || annotations['tower.io/organization']) {
      labels['tower.io/scenario'] = 'tenant';
    }
  }
  
  const body = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name,
      labels,
      annotations: finalAnnotations,
      // 添加终结器，防止命名空间被意外删除（与虚拟机统一）
      // 终结器会在命名空间删除时被调用，可以用于清理资源
      ...(options?.addFinalizer !== false ? {
        finalizers: ['tower.io/managed'],
      } : {}),
    },
  } as any;
  return requestJson('POST', url, token, insecure, body);
};

/**
 * 合并 PATCH 命名空间的 metadata.labels / metadata.annotations（已存在命名空间时补齐 Tower 关联信息）
 */
export const patchHarvesterNamespaceMetadata = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
  fragment: { labels?: Record<string, string>; annotations?: Record<string, string> },
): Promise<any> => {
  if (!fragment.labels && !fragment.annotations) {
    return undefined;
  }
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
  const metadata: Record<string, unknown> = {};
  if (fragment.labels && Object.keys(fragment.labels).length > 0) {
    metadata.labels = fragment.labels;
  }
  if (fragment.annotations && Object.keys(fragment.annotations).length > 0) {
    metadata.annotations = fragment.annotations;
  }
  if (Object.keys(metadata).length === 0) {
    return undefined;
  }
  return requestJson(
    'PATCH',
    url,
    token,
    insecure,
    { metadata },
    { 'Content-Type': 'application/strategic-merge-patch+json' },
  );
};

export const deleteHarvesterNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
): Promise<any> => {
  if (isProtectedNamespace(name)) {
    throw new Error(`Namespace ${name} is protected and cannot be deleted.`);
  }
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

export const listHarvesterNamespacesRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/v1/namespaces`;
  try {
    const json = await getJsonOnce(url, token, insecure, true);
    const items = Array.isArray(json?.data)
      ? json?.data
      : Array.isArray(json?.items)
        ? json?.items
        : [];
    return items;
  } catch (e) {
    console.warn(
      '[listHarvesterNamespacesRaw] Steve API failed, falling back to K8s API:',
      e,
    );
    const k8sUrl = `${origin}/api/v1/namespaces`;
    const json = await getJsonOnce(k8sUrl, token, insecure);
    const items = Array.isArray(json?.items) ? json.items : [];
    return items.map((item: any) => ({
      ...item,
      links: item.links || {
        view: `${origin}/api/v1/namespaces/${item.metadata?.name}`,
        self: `${origin}/api/v1/namespaces/${item.metadata?.name}`,
      },
    }));
  }
};

export const getHarvesterNamespaceRaw = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
  return getJsonOnce(url, token, insecure);
};

