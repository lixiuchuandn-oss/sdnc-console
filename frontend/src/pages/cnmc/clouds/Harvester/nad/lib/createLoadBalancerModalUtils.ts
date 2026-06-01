export type K8sLikeResource = {
  metadata?: { name?: string; namespace?: string };
  name?: string;
  namespace?: string;
  spec?: Record<string, unknown>;
  rawData?: { spec?: Record<string, unknown> };
};

export type LoadBalancerNadInfo = {
  name: string;
  bridge: string;
  range?: string;
};

export type LoadBalancerListenerInput = {
  name?: string;
  port?: number;
  protocol?: string;
  backendPort?: number;
};

export type LoadBalancerSelectorInput = {
  key?: string;
  value?: string;
};

export type LoadBalancerFormValues = {
  name: string;
  namespace: string;
  ipam?: string;
  ipPool?: string;
  listeners?: LoadBalancerListenerInput[];
  selectors?: LoadBalancerSelectorInput[];
};

export type LoadBalancerCreatePayload = {
  name: string;
  namespace: string;
  ipam: string;
  listeners: Array<{
    name?: string;
    port?: number;
    protocol?: string;
    backendPort?: number;
  }>;
  workloadType: string;
  backendServerSelector: Record<string, string[]>;
  annotations?: Record<string, string>;
};

export function getResourceName(item: K8sLikeResource): string {
  return String(item.metadata?.name || item.name || '');
}

export function buildNamespaceSelectOptions(
  namespaces: unknown[],
): { label: string; value: string }[] {
  return (namespaces || []).map((n) => {
    const item = n as K8sLikeResource;
    const name = getResourceName(item);
    return { label: name, value: name };
  });
}

export function pickDefaultNamespaceName(namespaces: unknown[]): string | undefined {
  if (!namespaces?.length) return undefined;
  const list = namespaces as K8sLikeResource[];
  const def = list.find((n) => getResourceName(n) === 'default');
  if (def) return getResourceName(def);
  return getResourceName(list[0]);
}

export function buildIpPoolSelectOptions(ipPools: unknown[]): { label: string; value: string }[] {
  return (ipPools || []).map((p) => {
    const item = p as K8sLikeResource;
    const name = getResourceName(item);
    return { label: name, value: name };
  });
}

export function getIpPoolSpec(pool: K8sLikeResource): Record<string, unknown> | undefined {
  return (pool.spec || pool.rawData?.spec) as Record<string, unknown> | undefined;
}

export function resolveNetworkRefFromPool(
  pool: K8sLikeResource,
): { nadNs: string; nadName: string } | null {
  const poolSpec = getIpPoolSpec(pool);
  if (!poolSpec) return null;
  const selector = poolSpec.selector as { network?: string } | undefined;
  const networkRef = String(selector?.network || poolSpec.network || '').trim();
  if (!networkRef) return null;
  if (networkRef.includes('/')) {
    const [nadNs, nadName] = networkRef.split('/');
    if (nadNs && nadName) return { nadNs, nadName };
    return null;
  }
  return {
    nadNs: String(pool.metadata?.namespace || pool.namespace || 'default'),
    nadName: networkRef,
  };
}

export function formatIpPoolRangeText(poolSpec: Record<string, unknown> | undefined): string {
  const ranges = poolSpec?.ranges;
  if (!Array.isArray(ranges)) return '';
  return ranges
    .map((r) => {
      const range = r as Record<string, unknown>;
      if (range.rangeStart && range.rangeEnd) {
        return `${range.rangeStart}-${range.rangeEnd}`;
      }
      if (range.subnet) return String(range.subnet);
      return '';
    })
    .filter(Boolean)
    .join(', ');
}

export function parseNadBridgeFromDetail(nad: unknown): string | null {
  const n = nad as { spec?: { config?: string }; data?: { spec?: { config?: string } } };
  const raw = n?.data || n;
  const configStr = (raw as { spec?: { config?: string } })?.spec?.config;
  if (!configStr) return null;
  try {
    const config = JSON.parse(configStr) as { bridge?: string };
    return config.bridge ? String(config.bridge) : null;
  } catch {
    return null;
  }
}

export function buildNadInfoFromPoolAndBridge(
  nadNs: string,
  nadName: string,
  bridge: string,
  range?: string,
): LoadBalancerNadInfo {
  return { name: `${nadNs}/${nadName}`, bridge, range: range || undefined };
}

export function findIpPoolByName(ipPools: unknown[], poolName: string): K8sLikeResource | undefined {
  return (ipPools as K8sLikeResource[]).find((p) => getResourceName(p) === poolName);
}

export function buildBackendServerSelector(
  selectors: LoadBalancerSelectorInput[] | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  (selectors || []).forEach((s) => {
    if (!s.key || !s.value) return;
    if (out[s.key]) out[s.key].push(s.value);
    else out[s.key] = [s.value];
  });
  return out;
}

export function buildLoadBalancerListeners(listeners: LoadBalancerListenerInput[] | undefined) {
  return (listeners || []).map((l) => ({
    name: l.name,
    port: l.port,
    protocol: l.protocol,
    backendPort: l.backendPort,
  }));
}

export function buildLoadBalancerCreatePayload(
  values: LoadBalancerFormValues,
  extraAnnotations?: Record<string, string>,
): LoadBalancerCreatePayload {
  const payload: LoadBalancerCreatePayload = {
    name: values.name,
    namespace: values.namespace,
    ipam: values.ipam || 'pool',
    listeners: buildLoadBalancerListeners(values.listeners),
    workloadType: 'vm',
    backendServerSelector: buildBackendServerSelector(values.selectors),
  };

  const mergedAnnotations = { ...(extraAnnotations || {}) };
  if (values.ipam === 'pool' && values.ipPool) {
    mergedAnnotations['loadbalancer.harvesterhci.io/ip-pool'] = values.ipPool;
  }
  if (Object.keys(mergedAnnotations).length > 0) {
    payload.annotations = mergedAnnotations;
  }
  return payload;
}

export async function resolveKubeVipBridgeAnnotation(
  values: LoadBalancerFormValues,
  ipPools: unknown[],
  fetchNadDetail: (nadNs: string, nadName: string) => Promise<unknown>,
): Promise<string | undefined> {
  if (values.ipam !== 'pool' || !values.ipPool) return undefined;
  const selectedPool = findIpPoolByName(ipPools, values.ipPool);
  if (!selectedPool) return undefined;
  const ref = resolveNetworkRefFromPool(selectedPool);
  if (!ref) return undefined;
  const nad = await fetchNadDetail(ref.nadNs, ref.nadName);
  const bridge = parseNadBridgeFromDetail(nad);
  return bridge || undefined;
}

export function parseLoadBalancerCreateError(rawMessage: string): string {
  let errorMsg = rawMessage || '未知错误';
  if (errorMsg.includes('already exists') || errorMsg.includes('AlreadyExists')) {
    return '该负载均衡名称已存在，请使用其他名称';
  }
  if (errorMsg.includes('{')) {
    try {
      const jsonStart = errorMsg.indexOf('{');
      const errObj = JSON.parse(errorMsg.substring(jsonStart)) as {
        reason?: string;
        code?: number;
        message?: string;
      };
      if (errObj.reason === 'AlreadyExists' || errObj.code === 409) {
        return '该负载均衡名称已存在，请使用其他名称';
      }
      if (errObj.message) return errObj.message;
    } catch {
      // use original message
    }
  }
  return errorMsg;
}

export async function resolveNadInfoForIpPool(
  poolName: string,
  ipPools: unknown[],
  fetchNadDetail: (nadNs: string, nadName: string) => Promise<unknown>,
): Promise<LoadBalancerNadInfo | null> {
  if (!poolName) return null;
  const selectedPool = findIpPoolByName(ipPools, poolName);
  if (!selectedPool) return null;
  const poolSpec = getIpPoolSpec(selectedPool);
  const ref = resolveNetworkRefFromPool(selectedPool);
  if (!ref) return null;
  const rangeStr = formatIpPoolRangeText(poolSpec);
  const nad = await fetchNadDetail(ref.nadNs, ref.nadName);
  const bridge = parseNadBridgeFromDetail(nad);
  if (!bridge) return null;
  return buildNadInfoFromPoolAndBridge(ref.nadNs, ref.nadName, bridge, rangeStr);
}
