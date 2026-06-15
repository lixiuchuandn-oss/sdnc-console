import { getJsonOnce } from './utils';

export type PvcWorkloadConsumer = {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job' | 'CronJob';
  name: string;
};

function resolveSteveClusterOrigin(base: string): string {
  let origin = (base || '').replace(/\/+$/, '');
  if (!origin.includes('/k8s/clusters/')) {
    try {
      const u = new URL(origin);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = origin.replace(/\/v[0-9].*$/, '');
    }
    origin += '/k8s/clusters/local';
  }
  return origin;
}

async function fetchClusterAppsResources(
  endpoint: string,
  token: string,
  insecure: boolean,
  resource: 'deployments' | 'statefulsets' | 'daemonsets',
): Promise<any[]> {
  const origin = resolveSteveClusterOrigin(endpoint);
  const url = `${origin}/apis/apps/v1/${resource}`;
  const result = await getJsonOnce(url, token, insecure, true);
  return Array.isArray(result?.items) ? result.items : [];
}

/** 拉取集群工作负载并构建 PVC → 消费者映射（供卷列表 enrichment 复用） */
export async function fetchClusterPvcWorkloadConsumerMap(
  endpoint: string,
  token: string,
  insecure: boolean,
): Promise<Map<string, PvcWorkloadConsumer[]>> {
  try {
    const [deployments, statefulsets, daemonsets] = await Promise.all([
      fetchClusterAppsResources(endpoint, token, insecure, 'deployments'),
      fetchClusterAppsResources(endpoint, token, insecure, 'statefulsets'),
      fetchClusterAppsResources(endpoint, token, insecure, 'daemonsets'),
    ]);
    return buildPvcWorkloadConsumerMap({ deployments, statefulsets, daemonsets });
  } catch {
    return new Map();
  }
}

export function resolveVolumeAttachedInfo(input: {
  namespace: string;
  pvcName: string;
  k8sStatus?: Record<string, unknown>;
  pvcStatus?: Record<string, unknown>;
  pvcWorkloadMap: Map<string, PvcWorkloadConsumer[]>;
}): { attachedTo: string[]; workloadConsumers: PvcWorkloadConsumer[] } {
  const { namespace, pvcName, k8sStatus, pvcStatus, pvcWorkloadMap } = input;
  const workloads =
    (k8sStatus?.workloadsStatus as unknown[])
    || (pvcStatus?.workloadsStatus as unknown[])
    || (pvcStatus?.workloadStatus as unknown[])
    || [];
  const rawNames: string[] = Array.isArray(workloads)
    ? workloads
        .map((w: any) => String(w?.workloadName || w?.podName || ''))
        .filter(Boolean)
    : [];
  const workloadConsumers = getPvcWorkloadConsumers(pvcWorkloadMap, namespace, pvcName);
  const workloadLabels = formatPvcWorkloadConsumerLabels(workloadConsumers);
  const attachedTo = Array.from(
    new Set(
      [
        ...rawNames
          .map((n: string) => {
            let s = n.trim();
            if (/^virt-launcher-/.test(s)) {
              s = s.replace(/^virt-launcher-/, '');
            }
            return s;
          })
          .filter(Boolean),
        ...workloadLabels,
      ],
    ),
  );
  return { attachedTo, workloadConsumers };
}

function workloadVolumes(workload: any): any[] {
  return (
    workload?.spec?.template?.spec?.volumes
    || workload?.spec?.jobTemplate?.spec?.template?.spec?.volumes
    || []
  );
}

function addConsumer(
  map: Map<string, PvcWorkloadConsumer[]>,
  namespace: string,
  claimName: string,
  consumer: PvcWorkloadConsumer,
) {
  if (!namespace || !claimName || !consumer.name) return;
  const key = `${namespace}/${claimName}`;
  const list = map.get(key) || [];
  if (list.some((item) => item.kind === consumer.kind && item.name === consumer.name)) {
    return;
  }
  list.push(consumer);
  map.set(key, list);
}

/** 从 Deployment / StatefulSet / DaemonSet / Job / CronJob 构建 PVC → 工作负载引用表 */
export function buildPvcWorkloadConsumerMap(workloads: {
  deployments?: any[];
  statefulsets?: any[];
  daemonsets?: any[];
  jobs?: any[];
  cronjobs?: any[];
}): Map<string, PvcWorkloadConsumer[]> {
  const map = new Map<string, PvcWorkloadConsumer[]>();

  for (const item of workloads.deployments || []) {
    const ns = item?.metadata?.namespace || '';
    const name = item?.metadata?.name || '';
    for (const vol of workloadVolumes(item)) {
      const claim = vol?.persistentVolumeClaim?.claimName;
      if (claim) addConsumer(map, ns, claim, { kind: 'Deployment', name });
    }
  }

  for (const item of workloads.statefulsets || []) {
    const ns = item?.metadata?.namespace || '';
    const name = item?.metadata?.name || '';
    for (const vol of workloadVolumes(item)) {
      const claim = vol?.persistentVolumeClaim?.claimName;
      if (claim) addConsumer(map, ns, claim, { kind: 'StatefulSet', name });
    }
  }

  for (const item of workloads.daemonsets || []) {
    const ns = item?.metadata?.namespace || '';
    const name = item?.metadata?.name || '';
    for (const vol of workloadVolumes(item)) {
      const claim = vol?.persistentVolumeClaim?.claimName;
      if (claim) addConsumer(map, ns, claim, { kind: 'DaemonSet', name });
    }
  }

  for (const item of workloads.jobs || []) {
    const ns = item?.metadata?.namespace || '';
    const name = item?.metadata?.name || '';
    for (const vol of workloadVolumes(item)) {
      const claim = vol?.persistentVolumeClaim?.claimName;
      if (claim) addConsumer(map, ns, claim, { kind: 'Job', name });
    }
  }

  for (const item of workloads.cronjobs || []) {
    const ns = item?.metadata?.namespace || '';
    const name = item?.metadata?.name || '';
    for (const vol of workloadVolumes(item)) {
      const claim = vol?.persistentVolumeClaim?.claimName;
      if (claim) addConsumer(map, ns, claim, { kind: 'CronJob', name });
    }
  }

  return map;
}

export function getPvcWorkloadConsumers(
  map: Map<string, PvcWorkloadConsumer[]>,
  namespace: string,
  pvcName: string,
): PvcWorkloadConsumer[] {
  return map.get(`${namespace}/${pvcName}`) || [];
}

export function formatPvcWorkloadConsumerLabels(consumers: PvcWorkloadConsumer[]): string[] {
  return consumers.map((item) => `${item.kind}/${item.name}`);
}
