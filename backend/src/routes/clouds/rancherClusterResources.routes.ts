import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import {
  getRancherContext,
  rancherGet,
  rancherListItems,
  rancherPost,
} from '../../services/clouds/rancher/rancherNormanClient';

const log = logger.child('RancherClusterResources');

const WORKLOAD_STEVE_KINDS = [
  'cronjob',
  'job',
  'daemonset',
  'deployment',
  'statefulset',
  'pod',
] as const;

type WorkloadSteveKind = (typeof WORKLOAD_STEVE_KINDS)[number];

function isWorkloadSteveKind(k: string): k is WorkloadSteveKind {
  return (WORKLOAD_STEVE_KINDS as readonly string[]).includes(k);
}

function steveWorkloadPath(clusterId: string, kind: WorkloadSteveKind): string {
  const cid = encodeURIComponent(clusterId);
  const paths: Record<WorkloadSteveKind, string> = {
    cronjob: `/k8s/clusters/${cid}/apis/batch/v1/cronjobs?limit=500`,
    job: `/k8s/clusters/${cid}/apis/batch/v1/jobs?limit=500`,
    daemonset: `/k8s/clusters/${cid}/apis/apps/v1/daemonsets?limit=500`,
    deployment: `/k8s/clusters/${cid}/apis/apps/v1/deployments?limit=500`,
    statefulset: `/k8s/clusters/${cid}/apis/apps/v1/statefulsets?limit=500`,
    pod: `/k8s/clusters/${cid}/v1/pods?limit=500`,
  };
  return paths[kind];
}

const WORKLOAD_K8S_KIND: Record<WorkloadSteveKind, string> = {
  cronjob: 'CronJob',
  job: 'Job',
  daemonset: 'DaemonSet',
  deployment: 'Deployment',
  statefulset: 'StatefulSet',
  pod: 'Pod',
};

function steveWorkloadCreatePath(
  clusterId: string,
  kind: WorkloadSteveKind,
  namespace: string,
): string {
  const c = encodeURIComponent(clusterId);
  const n = encodeURIComponent(namespace);
  const paths: Record<WorkloadSteveKind, string> = {
    cronjob: `/k8s/clusters/${c}/apis/batch/v1/namespaces/${n}/cronjobs`,
    job: `/k8s/clusters/${c}/apis/batch/v1/namespaces/${n}/jobs`,
    daemonset: `/k8s/clusters/${c}/apis/apps/v1/namespaces/${n}/daemonsets`,
    deployment: `/k8s/clusters/${c}/apis/apps/v1/namespaces/${n}/deployments`,
    statefulset: `/k8s/clusters/${c}/apis/apps/v1/namespaces/${n}/statefulsets`,
    // 核心 v1 组在 apiserver 上为 /api/v1/...，Steve 上需带 api/ 前缀；/v1/namespaces/... 仅 list 等部分路径，POST 会 405
    pod: `/k8s/clusters/${c}/api/v1/namespaces/${n}/pods`,
  };
  return paths[kind];
}

function mapCronJobRow(it: any) {
  const md = it.metadata || {};
  const spec = it.spec || {};
  const st = it.status || {};
  const active = Array.isArray(st.active) ? st.active.length : 0;
  return {
    id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
    namespace: String(md.namespace || '').trim(),
    name: String(md.name || '').trim() || '—',
    schedule: spec.schedule != null ? String(spec.schedule) : '',
    suspend: spec.suspend === true ? '是' : '否',
    active: String(active),
    lastSchedule: st.lastScheduleTime ? String(st.lastScheduleTime) : '',
    created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
  };
}

function mapJobRow(it: any) {
  const md = it.metadata || {};
  const spec = it.spec || {};
  const st = it.status || {};
  const completions = spec.completions;
  const succeeded = st.succeeded;
  let progress = '';
  if (completions != null && completions !== undefined) {
    progress = `${succeeded ?? 0}/${completions}`;
  } else {
    progress = String(succeeded ?? 0);
  }
  const status = st.completionTime ? 'Complete' : st.active ? 'Active' : '—';
  return {
    id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
    namespace: String(md.namespace || '').trim(),
    name: String(md.name || '').trim() || '—',
    completions: progress,
    status,
    created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
  };
}

function mapDaemonSetRow(it: any) {
  const md = it.metadata || {};
  const st = it.status || {};
  return {
    id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
    namespace: String(md.namespace || '').trim(),
    name: String(md.name || '').trim() || '—',
    desired: String(st.desiredNumberScheduled ?? ''),
    current: String(st.currentNumberScheduled ?? ''),
    ready: String(st.numberReady ?? ''),
    available: String(st.numberAvailable ?? ''),
    created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
  };
}

function mapReplicaSetStyleRow(it: any) {
  const md = it.metadata || {};
  const spec = it.spec || {};
  const st = it.status || {};
  const desired = spec.replicas ?? 0;
  const ready = st.readyReplicas ?? 0;
  return {
    id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
    namespace: String(md.namespace || '').trim(),
    name: String(md.name || '').trim() || '—',
    ready: `${ready}/${desired}`,
    upToDate: String(st.updatedReplicas ?? ''),
    available: String(st.availableReplicas ?? ''),
    created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
  };
}

function mapPodRow(it: any) {
  const md = it.metadata || {};
  const spec = it.spec || {};
  const st = it.status || {};
  const cs = Array.isArray(st.containerStatuses) ? st.containerStatuses : [];
  const total = cs.length;
  const readyN = cs.filter((c: any) => c && c.ready).length;
  const restarts = cs.reduce((a: number, c: any) => a + (c?.restartCount || 0), 0);
  return {
    id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
    namespace: String(md.namespace || '').trim(),
    name: String(md.name || '').trim() || '—',
    ready: total ? `${readyN}/${total}` : '—',
    status: st.phase ? String(st.phase) : '',
    restarts: String(restarts),
    node: spec.nodeName ? String(spec.nodeName) : '',
    created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
  };
}

async function fetchRancherCloudOr404(id: string, res: Response): Promise<Cloud | null> {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'rancher') {
    res.status(400).json({ message: '仅 Rancher 资源池支持该接口' });
    return null;
  }
  return cloud;
}

function clusterIdFromReq(params: { clusterId?: string }): string {
  return decodeURIComponent(String(params.clusterId || '').trim());
}

/**
 * 挂载：GET /api/clouds/:id/rancher/clusters/:clusterId/{projects|namespaces|nodes|members|events|detail|workloads/*}
 * 须在 `GET /:id` 之前注册。
 */
export function attachRancherClusterResourceRoutes(router: Router, perm: RequestHandler): void {
  const basePath = '/:id/rancher/clusters/:clusterId';

  router.get(`${basePath}/projects`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const r = await rancherGet(ctx, '/v3/projects?limit=1000');
      if (!r.ok) {
        res.status(r.status === 401 ? 502 : 502).json({ message: r.message || '获取项目失败' });
        return;
      }
      const items = rancherListItems(r.data).filter(
        (p: any) => String(p.clusterId || p.clusterID || '') === clusterId,
      );
      const data = items.map((p: any) => ({
        id: String(p.id || '').trim(),
        name: String(p.name || p.id || '').trim() || '—',
        state: String(p.state || '').trim() || undefined,
        namespaceId: p.namespaceId ? String(p.namespaceId) : undefined,
        created: p.created || p.createdTS,
      }));
      res.json({ data });
    } catch (e: any) {
      log.error('projects', e?.message);
      res.status(500).json({ message: e?.message || '获取项目失败' });
    }
  });

  router.get(`${basePath}/namespaces`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const path = `/k8s/clusters/${encodeURIComponent(clusterId)}/v1/namespaces?limit=500`;
      const r = await rancherGet(ctx, path);
      if (!r.ok) {
        res.status(502).json({ message: r.message || '获取命名空间失败' });
        return;
      }
      const items = rancherListItems(r.data);
      const data = items.map((ns: any) => {
        const md = ns.metadata || ns;
        const st = ns.status || {};
        return {
          id: String(md.uid || md.name || '').trim(),
          name: String(md.name || '').trim() || '—',
          phase: String(st.phase || md.status?.phase || '').trim() || undefined,
          created: md.creationTimestamp,
        };
      });
      res.json({ data });
    } catch (e: any) {
      log.error('namespaces', e?.message);
      res.status(500).json({ message: e?.message || '获取命名空间失败' });
    }
  });

  router.get(`${basePath}/nodes`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const r = await rancherGet(ctx, '/v3/nodes?limit=1000');
      if (!r.ok) {
        res.status(502).json({ message: r.message || '获取节点失败' });
        return;
      }
      const items = rancherListItems(r.data).filter(
        (n: any) => String(n.clusterId || n.clusterID || '') === clusterId,
      );
      const data = items.map((n: any) => {
        const ni = n.status?.nodeInfo || n.nodeInfo || {};
        const labels = n.labels || {};
        const isCp =
          n.controlPlane === true ||
          String(labels['node-role.kubernetes.io/control-plane'] || '') === 'true' ||
          String(labels['node-role.kubernetes.io/controlplane'] || '') === 'true' ||
          String(labels['node-role.kubernetes.io/etcd'] || '') === 'true';
        return {
          id: String(n.id || '').trim(),
          name: String(n.nodeName || n.hostname || n.requestedHostname || n.id || '').trim() || '—',
          state: String(n.state || '').trim() || undefined,
          kubeletVersion: ni.kubeletVersion ? String(ni.kubeletVersion) : undefined,
          internalIp:
            (n.ipAddress && String(n.ipAddress)) ||
            (n.internalAddress && String(n.internalAddress)) ||
            undefined,
          roles: isCp ? 'control-plane' : 'worker',
        };
      });
      res.json({ data });
    } catch (e: any) {
      log.error('nodes', e?.message);
      res.status(500).json({ message: e?.message || '获取节点失败' });
    }
  });

  router.get(`${basePath}/members`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const r = await rancherGet(ctx, '/v3/clusterroletemplatebindings?limit=1000');
      if (!r.ok) {
        res.status(502).json({ message: r.message || '获取集群成员失败' });
        return;
      }
      const items = rancherListItems(r.data).filter(
        (b: any) => String(b.clusterId || b.clusterID || '') === clusterId,
      );
      const data = items.map((b: any) => ({
        id: String(b.id || '').trim(),
        userId: b.userId ? String(b.userId) : undefined,
        userPrincipalName: b.userPrincipalName ? String(b.userPrincipalName) : undefined,
        groupPrincipalName: b.groupPrincipalName ? String(b.groupPrincipalName) : undefined,
        roleTemplateId: b.roleTemplateId ? String(b.roleTemplateId) : undefined,
        created: b.created || b.createdTS,
      }));
      res.json({ data });
    } catch (e: any) {
      log.error('members', e?.message);
      res.status(500).json({ message: e?.message || '获取集群成员失败' });
    }
  });

  router.get(`${basePath}/events`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const path = `/k8s/clusters/${encodeURIComponent(clusterId)}/v1/events?limit=200`;
      const r = await rancherGet(ctx, path, { timeout: 45000 });
      if (!r.ok) {
        res.status(502).json({ message: r.message || '获取事件失败' });
        return;
      }
      const items = rancherListItems(r.data);
      const data = items.map((ev: any) => {
        const md = ev.metadata || {};
        const involved = ev.involvedObject || {};
        return {
          namespace: md.namespace ? String(md.namespace) : '',
          reason: ev.reason ? String(ev.reason) : '',
          message: ev.message ? String(ev.message) : '',
          type: ev.type ? String(ev.type) : '',
          lastTimestamp: ev.lastTimestamp || ev.eventTime,
          kind: involved.kind ? String(involved.kind) : '',
          name: involved.name ? String(involved.name) : '',
        };
      });
      res.json({ data });
    } catch (e: any) {
      log.error('events', e?.message);
      res.status(500).json({ message: e?.message || '获取事件失败' });
    }
  });

  router.get(`${basePath}/detail`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const r = await rancherGet(ctx, `/v3/clusters/${encodeURIComponent(clusterId)}`);
      if (!r.ok) {
        res.status(502).json({ message: r.message || '获取集群信息失败' });
        return;
      }
      const c = r.data || {};
      res.json({
        data: {
          id: String(c.id || clusterId).trim(),
          name: String(c.name || '').trim() || clusterId,
          state: String(c.state || '').trim() || undefined,
          kubernetesVersion:
            c.version?.gitVersion ||
            c.kubernetesVersion ||
            c.appliedSpec?.rancherKubernetesEngineConfig?.kubernetesVersion ||
            undefined,
          provider: c.provider != null ? String(c.provider) : undefined,
          agentImage: c.agentImage ? String(c.agentImage) : undefined,
        },
      });
    } catch (e: any) {
      log.error('detail', e?.message);
      res.status(500).json({ message: e?.message || '获取集群信息失败' });
    }
  });

  router.get(`${basePath}/workloads/counts`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const results = await Promise.all(
        (WORKLOAD_STEVE_KINDS as readonly WorkloadSteveKind[]).map(async (kind) => {
          const path = steveWorkloadPath(clusterId, kind);
          const r = await rancherGet(ctx, path, {
            timeout: kind === 'pod' ? 45000 : 30000,
          });
          if (!r.ok) {
            return { kind, count: 0, ok: false };
          }
          return { kind, count: rancherListItems(r.data).length, ok: true };
        }),
      );
      const counts: Record<string, number> = {};
      for (const x of results) {
        counts[x.kind] = x.count;
      }
      res.json({ data: { counts } });
    } catch (e: any) {
      log.error('workloads/counts', e?.message);
      res.status(500).json({ message: e?.message || '获取工作负载数量失败' });
    }
  });

  router.get(`${basePath}/workloads/:kind`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const rawKind = String(req.params.kind || '')
        .trim()
        .toLowerCase();
      if (!isWorkloadSteveKind(rawKind)) {
        res.status(400).json({ message: '不支持的资源类型' });
        return;
      }
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const path = steveWorkloadPath(clusterId, rawKind);
      const r = await rancherGet(ctx, path, {
        timeout: rawKind === 'pod' ? 45000 : 30000,
      });
      if (!r.ok) {
        res.status(502).json({ message: r.message || '获取工作负载失败' });
        return;
      }
      const items = rancherListItems(r.data);
      let data: any[];
      switch (rawKind) {
        case 'cronjob':
          data = items.map(mapCronJobRow);
          break;
        case 'job':
          data = items.map(mapJobRow);
          break;
        case 'daemonset':
          data = items.map(mapDaemonSetRow);
          break;
        case 'deployment':
        case 'statefulset':
          data = items.map(mapReplicaSetStyleRow);
          break;
        case 'pod':
          data = items.map(mapPodRow);
          break;
        default:
          data = [];
      }
      res.json({ data });
    } catch (e: any) {
      log.error('workloads', e?.message);
      res.status(500).json({ message: e?.message || '获取工作负载失败' });
    }
  });

  /** 按命名空间创建工作负载：请求体为完整 Kubernetes 对象 JSON，须与 :kind 一致 */
  router.post(`${basePath}/workloads/:kind`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const rawKind = String(req.params.kind || '')
        .trim()
        .toLowerCase();
      if (!isWorkloadSteveKind(rawKind)) {
        res.status(400).json({ message: '不支持的资源类型' });
        return;
      }
      const manifest = (req.body as { manifest?: unknown })?.manifest;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        res.status(400).json({ message: '请提供有效的 manifest 对象' });
        return;
      }
      const m = manifest as Record<string, unknown>;
      const md = (m.metadata as Record<string, unknown> | undefined) || {};
      const ns = String(md.namespace || '').trim();
      const name = String(md.name || '').trim();
      if (!ns || !name) {
        res.status(400).json({ message: 'manifest.metadata 需包含非空的 name 与 namespace' });
        return;
      }
      const k8sKind = String(m.kind || '').trim();
      if (k8sKind !== WORKLOAD_K8S_KIND[rawKind]) {
        res.status(400).json({
          message: `资源 kind 须为 ${WORKLOAD_K8S_KIND[rawKind]}，当前为 ${k8sKind || '—'}`,
        });
        return;
      }
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const path = steveWorkloadCreatePath(clusterId, rawKind, ns);
      const r = await rancherPost(ctx, path, m, { timeout: 120000 });
      if (!r.ok) {
        res.status(r.status === 401 ? 502 : 502).json({
          message: r.message || '创建工作负载失败',
          data: r.data,
        });
        return;
      }
      res.status(201).json({ data: { ok: true, result: r.data } });
    } catch (e: any) {
      log.error('workloads create', e?.message);
      res.status(500).json({ message: e?.message || '创建工作负载失败' });
    }
  });

  /** Steve 聚类资源列表：与侧栏子项 sub= 一一对应 */
  const RANCHER_K8S_STEVE_KINDS = [
    'services',
    'ingresses',
    'persistentvolumes',
    'persistentvolumeclaims',
    'storageclasses',
    'networkpolicies',
    'configmaps',
    'secrets',
    'catalogapps',
  ] as const;
  type K8sSteveKind = (typeof RANCHER_K8S_STEVE_KINDS)[number];
  const isK8sSteveKind = (k: string): k is K8sSteveKind =>
    (RANCHER_K8S_STEVE_KINDS as readonly string[]).includes(k);

  function k8sStevePath(clusterId: string, kind: K8sSteveKind): string {
    const c = encodeURIComponent(clusterId);
    const paths: Record<K8sSteveKind, string> = {
      services: `/k8s/clusters/${c}/v1/services?limit=500`,
      ingresses: `/k8s/clusters/${c}/apis/networking.k8s.io/v1/ingresses?limit=500`,
      persistentvolumes: `/k8s/clusters/${c}/v1/persistentvolumes?limit=200`,
      persistentvolumeclaims: `/k8s/clusters/${c}/v1/persistentvolumeclaims?limit=500`,
      storageclasses: `/k8s/clusters/${c}/apis/storage.k8s.io/v1/storageclasses?limit=200`,
      networkpolicies: `/k8s/clusters/${c}/apis/networking.k8s.io/v1/networkpolicies?limit=500`,
      configmaps: `/k8s/clusters/${c}/v1/configmaps?limit=500`,
      secrets: `/k8s/clusters/${c}/v1/secrets?limit=500`,
      catalogapps: `/k8s/clusters/${c}/apis/catalog.cattle.io/v1/apps?limit=500`,
    };
    return paths[kind];
  }

  function mapServiceRow(it: any) {
    const md = it.metadata || it;
    const spec = it.spec || {};
    return {
      id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
      namespace: String(md.namespace || '').trim() || '—',
      name: String(md.name || '').trim() || '—',
      type: spec.type != null ? String(spec.type) : 'ClusterIP',
      clusterIP: spec.clusterIP != null ? String(spec.clusterIP) : '—',
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapIngressRow(it: any) {
    const md = it.metadata || it;
    const spec = it.spec || {};
    const rules = Array.isArray(spec.rules) ? spec.rules : [];
    const hosts: string[] = [];
    for (const r of rules) {
      if (r?.host) hosts.push(String(r.host));
    }
    return {
      id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
      namespace: String(md.namespace || '').trim() || '—',
      name: String(md.name || '').trim() || '—',
      hosts: hosts.length ? hosts.join(', ') : '—',
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapPVRow(it: any) {
    const md = it.metadata || it;
    const spec = it.spec || {};
    return {
      id: String(md.uid || md.name || '').trim(),
      name: String(md.name || '').trim() || '—',
      namespace: '—',
      capacity: spec.capacity?.storage != null ? String(spec.capacity.storage) : '—',
      state: (it.status as any)?.phase != null ? String((it.status as any).phase) : '—',
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapPVCRow(it: any) {
    const md = it.metadata || it;
    const st = it.status || {};
    return {
      id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
      namespace: String(md.namespace || '').trim() || '—',
      name: String(md.name || '').trim() || '—',
      status: st.phase != null ? String(st.phase) : '—',
      volume: st.phase === 'Bound' && st.volumeName ? String(st.volumeName) : '—',
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapStorageClassRow(it: any) {
    const md = it.metadata || it;
    const prov = it.provisioner != null ? String(it.provisioner) : '—';
    return {
      id: String(md.name || md.uid || '').trim(),
      name: String(md.name || '').trim() || '—',
      namespace: '—',
      provisioner: prov,
      default:
        (md.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ||
        md.annotations?.['storageclass.beta.kubernetes.io/is-default-class'] === 'true' ?
          '是' :
          '否'),
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapNetPolRow(it: any) {
    const md = it.metadata || it;
    return {
      id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
      namespace: String(md.namespace || '').trim() || '—',
      name: String(md.name || '').trim() || '—',
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapConfigMapRow(it: any) {
    const md = it.metadata || it;
    return {
      id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
      namespace: String(md.namespace || '').trim() || '—',
      name: String(md.name || '').trim() || '—',
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapSecretRow(it: any) {
    const md = it.metadata || it;
    return {
      id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
      namespace: String(md.namespace || '').trim() || '—',
      name: String(md.name || '').trim() || '—',
      type: it.type != null ? String(it.type) : 'Opaque',
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }
  function mapCatalogAppRow(it: any) {
    const md = it.metadata || it;
    const st = it.status?.summaryState != null ? String(it.status.summaryState) : '—';
    return {
      id: String(md.uid || `${md.namespace}/${md.name}`).trim(),
      namespace: String(md.namespace || '').trim() || '—',
      name: String(md.name || '').trim() || '—',
      state: st,
      created: md.creationTimestamp ? String(md.creationTimestamp) : undefined,
    };
  }

  router.get(`${basePath}/k8s/:kind`, perm, async (req: AuthRequest, res: Response) => {
    try {
      const rawKind = String(req.params.kind || '')
        .trim()
        .toLowerCase();
      if (!isK8sSteveKind(rawKind)) {
        res.status(400).json({ message: '不支持的资源类型' });
        return;
      }
      const cloud = await fetchRancherCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getRancherContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const clusterId = clusterIdFromReq(req.params);
      const path = k8sStevePath(clusterId, rawKind);
      const r = await rancherGet(ctx, path, {
        timeout: rawKind === 'catalogapps' || rawKind === 'configmaps' ? 45000 : 30000,
      });
      if (!r.ok) {
        if (rawKind === 'catalogapps' && (r.status === 404 || r.status === 403)) {
          res.json({ data: [], warning: '当前 Rancher 可能未使用 catalog.cattle.io 应用资源' });
          return;
        }
        res.status(502).json({ message: r.message || '获取资源失败' });
        return;
      }
      const items = rancherListItems(r.data);
      let data: any[];
      switch (rawKind) {
        case 'services':
          data = items.map(mapServiceRow);
          break;
        case 'ingresses':
          data = items.map(mapIngressRow);
          break;
        case 'persistentvolumes':
          data = items.map(mapPVRow);
          break;
        case 'persistentvolumeclaims':
          data = items.map(mapPVCRow);
          break;
        case 'storageclasses':
          data = items.map(mapStorageClassRow);
          break;
        case 'networkpolicies':
          data = items.map(mapNetPolRow);
          break;
        case 'configmaps':
          data = items.map(mapConfigMapRow);
          break;
        case 'secrets':
          data = items.map(mapSecretRow);
          break;
        case 'catalogapps':
          data = items.map(mapCatalogAppRow);
          break;
        default:
          data = [];
      }
      res.json({ data });
    } catch (e: any) {
      log.error('k8s list', e?.message);
      res.status(500).json({ message: e?.message || '获取资源失败' });
    }
  });
}
