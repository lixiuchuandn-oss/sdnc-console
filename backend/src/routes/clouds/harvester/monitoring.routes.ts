/**
 * 监控服务代理：概览 + 监控告警（存储、节点、站内实施告警列表、Alertmanager 配置等）
 * 仅使用 cloudId；租户按 UserSpace 解析 namespace 过滤。设计文档：plan/设计-监控服务-概览.md、设计-监控服务-监控告警.md
 */
import { Router, Response } from 'express';
import yaml from 'js-yaml';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { PrometheusRulesGroup } from '../../../entities/monitoring/PrometheusRulesGroupEntity';
import { UserSpace } from '../../../entities/UserSpace';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';

function normalizeOrigin(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(endpoint || '').replace(/\/+$/, '').replace(/\/v[0-9].*$/, '');
  }
}

async function getCloudConnOnly(id: string): Promise<{ cloud: Cloud; origin: string; token: string; insecure: boolean } | null> {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) return null;
  const provider = String((cloud as any)?.config?.provider || '').toLowerCase();
  const isHarvesterLike = ['harvester', 'cloudmap', 'cloudmap.private', 'cloudmap.edge'].includes(provider);
  if (!isHarvesterLike) return null;
  const origin = normalizeOrigin(cloud.endpoint || '');
  const token = cloud.secretKey || (cloud as any).config?.token || (cloud as any).config?.apiToken || '';
  if (!token) return null;
  const insecure = !!((cloud as any).config?.ignoreTls ?? (cloud as any).config?.insecure);
  return { cloud, origin, token, insecure };
}

async function getCloudAndConn(id: string, res: Response): Promise<{ cloud: Cloud; origin: string; token: string; insecure: boolean } | null> {
  const conn = await getCloudConnOnly(id);
  if (!conn) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return conn;
}

/** 租户访问：解析当前用户在该 cloudId 下可访问的 namespace 列表，与 clouds.harvester_direct 的 checkTenantAccess 逻辑一致 */
async function getTenantAccess(req: any, cloudId: string): Promise<{ allowed: boolean; namespaces: string[]; isAdmin: boolean }> {
  const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
  const isTenantRole = req.user?.role === 'tenant';
  const isTenant = !!(isTenantUser || isTenantRole);
  if (!isTenant) return { allowed: true, namespaces: [], isAdmin: true };

  const userSpaceRepo = AppDataSource.getRepository(UserSpace);
  const userOrgId = (req.user as any)?.organizationId;
  const whereClause: any[] = [];
  if (userOrgId) {
    whereClause.push({ tenantId: (req.user as any).tenantId, cloudId, status: 'active', organizationId: userOrgId });
  } else {
    whereClause.push({ tenantId: (req.user as any).tenantId, cloudId, status: 'active', organizationId: null });
  }
  const matches = await userSpaceRepo.find({ where: whereClause, select: ['namespace'] });
  const uniqueNamespaces = new Set<string>();
  matches.forEach((m) => {
    if (m.namespace) {
      m.namespace.split(',').forEach((ns) => {
        const trimmed = ns.trim();
        if (trimmed) uniqueNamespaces.add(trimmed);
      });
    }
  });
  if (uniqueNamespaces.size === 0) return { allowed: false, namespaces: [], isAdmin: false };
  return { allowed: true, namespaces: Array.from(uniqueNamespaces), isAdmin: false };
}

/** 从认证中间件挂载的 req.user 获取当前账号名称（用于 creator 等） */
function getCreatorFromReq(req: any): string {
  const u = req?.user;
  if (!u) return '';
  return (u.username ?? u.fullName ?? '').toString().trim();
}

/**
 * 鉴权：校验资源池访问权限；若传入 namespaces，非管理员时校验每个命名空间均在允许列表内。
 * 未通过时写 res 并返回 null，通过时返回 tenant。
 */
async function requireTenantAccess(
  req: any,
  res: Response,
  cloudId: string,
  options?: { namespaces?: string[]; forbiddenMessage?: string }
): Promise<{ allowed: boolean; namespaces: string[]; isAdmin: boolean } | null> {
  const tenant = await getTenantAccess(req, cloudId);
  if (!tenant.allowed) {
    res.status(403).json({ message: '您没有该资源池的访问权限' });
    return null;
  }
  const namespaces = options?.namespaces?.filter((ns) => ns != null && String(ns).trim() !== '');
  if (
    namespaces != null &&
    namespaces.length > 0 &&
    !tenant.isAdmin &&
    tenant.namespaces.length > 0
  ) {
    const allowedSet = new Set(tenant.namespaces);
    const allAllowed = namespaces.every((ns) => allowedSet.has(String(ns).trim()));
    if (!allAllowed) {
      res.status(403).json({ message: options?.forbiddenMessage ?? '无权访问该命名空间下的配置' });
      return null;
    }
  }
  return tenant;
}

const PAGESIZE = 'pagesize=100000';
const EXCLUDE = 'exclude=metadata.managedFields';
const CATTLE_MONITORING_SYSTEM_NS = 'cattle-monitoring-system';
const WEBSITE_RECEIVER_NAME = 'website-receiver';
const ALERTMANAGER_PATH =
  `api/v1/namespaces/${CATTLE_MONITORING_SYSTEM_NS}/services/http:rancher-monitoring-alertmanager:9093/proxy/api/v2/alerts`;
const PROMETHEUS_QUERY_RANGE_PATH =
  `api/v1/namespaces/${CATTLE_MONITORING_SYSTEM_NS}/services/http:rancher-monitoring-prometheus:9090/proxy/api/v1/query_range`;

const DINGTALK_CONFIGMAP_NS = CATTLE_MONITORING_SYSTEM_NS;
const DINGTALK_CONFIGMAP_NAME = 'alertmanager-webhook-dingtalk';
const DINGTALK_CONFIG_KEY = 'config.yaml';

const MONITORING_RECEIVER_SECRET_LABEL = 'monitoring-receiver-secret';

function isWebsiteReceiverInMonitoringNs(receiverName: unknown): boolean {
  const name = String(receiverName ?? '').trim();
  const prefix = `${CATTLE_MONITORING_SYSTEM_NS}/`;
  const suffix = `/${WEBSITE_RECEIVER_NAME}`;
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false;
  // prefix 与 suffix 之间必须是一个 segment（alertmanagerconfig name），不能包含 '/'
  const middle = name.slice(prefix.length, name.length - suffix.length);
  return middle !== '' && !middle.includes('/');
}

/** 是否为资源池不可达（网络/超时），此时可返回空数据避免前端反复 500 */
function isUnreachableError(e: any): boolean {
  const status = e?.status;
  const code = e?.code || (e?.cause as any)?.code;
  return (
    status === 503 ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'NETWORK_ERROR'
  );
}

export function registerMonitoringRoutes(router: Router, _checkAdminPermission: any) {
  router.get('/:id/monitoring/storage-nodes', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const url = `${conn.origin}/v1/harvester/longhorn.io.nodes?${PAGESIZE}&${EXCLUDE}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ data: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求存储节点失败' });
    }
  });

  router.get('/:id/monitoring/node-resources', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const url = `${conn.origin}/v1/harvester/nodes?${PAGESIZE}&${EXCLUDE}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ data: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求节点资源失败' });
    }
  });

  router.get('/:id/monitoring/node-metrics', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const url = `${conn.origin}/v1/harvester/metrics.k8s.io.nodes?${PAGESIZE}&${EXCLUDE}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ data: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求节点指标失败' });
    }
  });

  router.get('/:id/monitoring/virtualmachines', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const url = `${conn.origin}/v1/harvester/kubevirt.io.virtualmachines?${PAGESIZE}&${EXCLUDE}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ data: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求虚拟机失败' });
    }
  });

  router.get('/:id/monitoring/virtualmachineinstances', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const url = `${conn.origin}/v1/harvester/kubevirt.io.virtualmachineinstances?${PAGESIZE}&${EXCLUDE}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ data: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求虚拟机实例失败' });
    }
  });

  router.get('/:id/monitoring/blockdevices', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const url = `${conn.origin}/v1/harvester/harvesterhci.io.blockdevices?${PAGESIZE}&${EXCLUDE}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ data: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求块设备失败' });
    }
  });

  /** Prometheus query_range 代理：用于 VM 性能图表等，需鉴权与租户 namespace 校验 */
  router.get('/:id/monitoring/metric-range', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const tenant = await requireTenantAccess(req, res, cloudId);
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const query = String(req.query?.query ?? '').trim();
      const start = req.query?.start;
      const end = req.query?.end;
      const step = req.query?.step;
      if (!query || start == null || end == null || step == null) {
        return res.status(400).json({ message: '缺少 query/start/end/step 参数' });
      }
      const params = new URLSearchParams({
        query,
        start: String(start),
        end: String(end),
        step: String(step),
      });
      const url = `${conn.origin}/${PROMETHEUS_QUERY_RANGE_PATH}?${params.toString()}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) {
        return res.status(200).json({ status: 'success', data: { resultType: 'matrix', result: [] } });
      }
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求指标失败' });
    }
  });

  router.get('/:id/monitoring/alerts-rules', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const datasource = String(req.query?.datasource ?? 'prometheus').trim().toLowerCase();
      if (datasource && datasource !== 'prometheus') {
        return res.status(400).json({ message: '暂不支持的数据源，当前仅支持 prometheus' });
      }
      const tenant = await getTenantAccess(req, cloudId);
      if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      // datasource=prometheus（或未传）：调用 Harvester Alertmanager 拉取告警
      const query = new URLSearchParams();
      query.set('silenced', 'false');
      query.set('inhibited', 'false');
      const url = `${conn.origin}/${ALERTMANAGER_PATH}?${query.toString()}`;
      console.log('alertmanager url: ', url);
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      // 源接口返回告警数组，每条含 labels.namespace，过滤按 labels.namespace 做
      let list: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []) || [];
      // 仅保留 cattle-monitoring-system 命名空间下，任意 AlertmanagerConfig 的 website-receiver 告警
      // receivers[].name 形如：cattle-monitoring-system/<alertmanagerconfig-name>/website-receiver
      list = list.filter((item: any) => {
        const receivers = Array.isArray(item?.receivers) ? item.receivers : [];
        return receivers.some((r: any) => isWebsiteReceiverInMonitoringNs(r?.name));
      });

      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedSet = new Set(tenant.namespaces);
        list = list.filter((item: any) => allowedSet.has(String(item?.labels?.namespace ?? '').trim()));
      }
      const namespaceParam = String((req.query?.namespace ?? req.query?.filter ?? '')).trim();
      if (namespaceParam) {
        const allowedNs = new Set(
          namespaceParam.split(/[,，\s]+/).map((s: string) => s.trim()).filter(Boolean)
        );
        if (allowedNs.size > 0) {
          list = list.filter((item: any) => {
            const ns = String(item?.labels?.namespace ?? '').trim();
            return allowedNs.has(ns);
          });
        }
      }

      // 分页前按更新时间倒序（最新在前）：优先 updatedAt，无则用 startsAt；预计算时间戳一次再排序
      const withTs = list.map((item: any) => {
        const raw = item?.updatedAt ?? item?.startsAt ?? '';
        const ts = raw ? new Date(raw).getTime() : 0;
        return { item, ts: Number.isNaN(ts) ? 0 : ts };
      });
      withTs.sort((a, b) => b.ts - a.ts);
      list = withTs.map((x) => x.item);

      const page = Math.max(1, parseInt(String(req.query?.page), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query?.pageSize), 10) || 10));
      const total = list.length;
      const hasPagination = req.query?.page !== undefined || req.query?.pageSize !== undefined;
      if (hasPagination) {
        const start = (page - 1) * pageSize;
        list = list.slice(start, start + pageSize);
        res.json({ data: list, total });
      } else {
        res.json(list);
      }
    } catch (e: any) {
      if (isUnreachableError(e)) {
        const hasPagination = req.query?.page !== undefined || req.query?.pageSize !== undefined;
        return res.status(200).json(hasPagination ? { data: [], total: 0 } : []);
      }
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求站内实时告警列表失败' });
    }
  });

  // GET /:id/monitoring/prometheusrules：仅当 datasource=prometheus 时调用，返回 PrometheusRule 列表及规则明细
  const PROMETHEUSRULES_PATH = 'v1/harvester/monitoring.coreos.com.prometheusrules';
  const PROMETHEUSRULES_EXCLUDE =
    'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&labelSelector=app.kubernetes.io/rule-type=custom-rules';

  router.get('/:id/monitoring/prometheusrules', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const datasource = String(req.query?.datasource ?? '').trim().toLowerCase();
      if (datasource !== 'prometheus') {
        return res.status(400).json({ message: '此接口仅支持 datasource=prometheus' });
      }
      const tenant = await getTenantAccess(req, cloudId);
      if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;

      const url = `${conn.origin}/${PROMETHEUSRULES_PATH}?limit=-1&${PROMETHEUSRULES_EXCLUDE}`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      let data: any[] = Array.isArray((raw as any)?.data) ? (raw as any).data : [];

      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedSet = new Set(tenant.namespaces);
        data = data.filter((item: any) => allowedSet.has(String(item?.metadata?.namespace ?? '').trim()));
      }

      const rulesGroupMap: Record<string, string> = {};
      const rules: Array<{
        datasource: string;
        groupName: string;
        groupAliasName: string;
        namespace?: string;
        name: string;
        aliasName: string;
        expression: string;
        interval: string;
        severity: string;
      }> = [];

      for (const item of data) {
        const meta = item?.metadata ?? {};
        const groupName = String(meta.name ?? '').trim();
        const groupAliasName = String(meta.annotations?.['cloudhci.io/rule-name'] ?? '').trim();
        const namespace = meta.namespace ? String(meta.namespace).trim() : undefined;
        if (groupName) rulesGroupMap[groupName] = groupAliasName || groupName;

        const groups = item?.spec?.groups ?? [];
        for (const grp of groups) {
          const ruleList = grp?.rules ?? [];
          for (const r of ruleList) {
            if (!r?.alert) continue;
            rules.push({
              datasource: 'prometheus',
              groupName,
              groupAliasName: groupAliasName || groupName,
              namespace,
              name: String(r.alert),
              aliasName: String(r.annotations?.summary ?? r.alert),
              expression: String(r.expr ?? ''),
              interval: String(r.for ?? ''),
              severity: String(r.labels?.severity ?? ''),
            });
          }
        }
      }

      // rulesGroupMap 缓存到数据库，不返回给前端
      try {
        const repo = AppDataSource.getRepository(PrometheusRulesGroup);
        let row = await repo.findOne({ where: { cloudId } });
        if (row) {
          row.data = JSON.stringify(rulesGroupMap);
          await repo.save(row);
        } else {
          await repo.save(repo.create({ cloudId, data: JSON.stringify(rulesGroupMap) }));
        }
      } catch (dbErr: any) {
        console.warn('[monitoring] prometheus-rules cache save failed:', dbErr?.message);
      }

      // 租户可传 alertNames 只返回对应告警名称的规则（与 vmTriggerOptions 对应）
      if (!tenant.isAdmin && req.query?.alertNames != null) {
        const raw = req.query.alertNames;
        const alertNamesSet = new Set<string>(
          Array.isArray(raw)
            ? (raw as string[]).map((v) => String(v).trim()).filter(Boolean)
            : String(raw ?? '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
        );
        if (alertNamesSet.size > 0) {
          const filtered = rules.filter((r) => alertNamesSet.has(r.name));
          return res.json({ rules: filtered });
        }
      }

      res.json({ rules });
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ rules: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求 Prometheus 规则失败' });
    }
  });

  // GET /:id/monitoring/prometheusrules-groups：返回后端缓存的 rulesGroupMap（告警分组下拉用），需 datasource=prometheus
  router.get('/:id/monitoring/prometheusrules-groups', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const datasource = String(req.query?.datasource ?? '').trim().toLowerCase();
      if (datasource !== 'prometheus') {
        return res.status(400).json({ message: '此接口仅支持 datasource=prometheus' });
      }
      const tenant = await getTenantAccess(req, cloudId);
      if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

      const repo = AppDataSource.getRepository(PrometheusRulesGroup);
      const row = await repo.findOne({ where: { cloudId } });
      const rulesGroupMap: Record<string, string> = row?.data ? JSON.parse(row.data) : {};
      res.json({ rulesGroupMap });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '获取告警分组失败' });
    }
  });

  // 当前用户在该云下可访问的命名空间（租户为 UserSpace 解析结果，管理员返回空表示不限制）
  router.get('/:id/monitoring/allowed-namespaces', async (req: any, res: Response) => {
    try {
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });
      res.json({ isAdmin: tenant.isAdmin, namespaces: tenant.namespaces });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '获取失败' });
    }
  });
  const EMAIL_RECEIVER = 'email-receiver';
  const DINGTALK_RECEIVER = 'dingtalk-receiver';
  const WEBSITE_RECEIVER = "website-receiver";
  const NULL_RECEIVER = 'null-receiver';

  /** AlertmanagerConfig 名称必须为 email-receiver / dingtalk-receiver / website-receiver 之一（通知对象专用） */
  function isValidReceiverConfigName(name: string): boolean {
    return [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER].includes(String(name || '').trim());
  }

  /** 判断是否为告警通知策略（非三类通知对象配置）。策略需带 null-receiver 且 route.receiver 为 null-receiver */
  function isPolicyAlertmanagerConfig(metadataName: string): boolean {
    const n = (metadataName ?? '').toString().trim();
    return n.length > 0 && !isValidReceiverConfigName(n);
  }

  /**
   * 规范化告警通知策略的 spec：receivers 中增加 null-receiver，route 最上层设置 receiver: null-receiver。
   * 仅对策略（非 email/dingtalk/website-receiver）调用，避免污染通知对象配置。
   */
  function normalizePolicySpec(spec: any): any {
    if (!spec || typeof spec !== 'object') return spec;
    const receivers = Array.isArray(spec.receivers) ? spec.receivers : [];
    const hasNull = receivers.some((r: any) => (r?.name ?? '').toString().trim() === NULL_RECEIVER);
    const nextReceivers = hasNull ? receivers : [...receivers, { name: NULL_RECEIVER }];
    const route = spec.route && typeof spec.route === 'object' ? spec.route : {};
    const nextRoute = { ...route, receiver: NULL_RECEIVER };
    return { ...spec, receivers: nextReceivers, route: nextRoute };
  }

  const ALERTMANAGERCONFIG_BASE = 'v1/harvester/monitoring.coreos.com.alertmanagerconfigs';
  /** 告警通知对象列表：仅拉取带此 label 的 AlertmanagerConfig（labels: monitoring-receiver: "true"） */
  const MONITORING_RECEIVER_LABEL_SELECTOR = 'monitoring-receiver=true';
  const PROMETHEUSRULE_VM = 'v1/harvester/monitoring.coreos.com.prometheusrules/cattle-monitoring-system/virtual-machine-custom-rules';

  /** 从 route 中收集所有 receiver 名称 */
  function collectReceiverNamesFromRoute(route: any): string[] {
    const names: string[] = [];
    const top = (route?.receiver ?? '').toString().trim();
    if (top) names.push(top);
    const children = Array.isArray(route?.routes) ? route.routes : [];
    for (const c of children) {
      const r = (c?.receiver ?? '').toString().trim();
      if (r && !names.includes(r)) names.push(r);
    }
    return names;
  }

  /** 根据 spec.receivers 推断 receiver 类型 */
  function inferReceiverType(receiverName: string, receivers: any[]): string {
    if (receiverName === WEBSITE_RECEIVER) return WEBSITE_RECEIVER;
    const r = (receivers ?? []).find((x: any) => (x?.name ?? '').toString().trim() === receiverName);
    if (!r) return EMAIL_RECEIVER;
    if (Array.isArray(r.emailConfigs) && r.emailConfigs.length > 0) return EMAIL_RECEIVER;
    if (Array.isArray(r.webhookConfigs) && r.webhookConfigs.length > 0) return DINGTALK_RECEIVER;
    return EMAIL_RECEIVER;
  }

  /** 与前端 receivers.ts getDingtalkWebhookUrl(robotAccount) 一致：内部代理地址，Alertmanager 请求此 URL，由 webhook 服务根据 ConfigMap targets[robotAccount] 转发到钉钉 */
  const DINGTALK_WEBHOOK_BASE = `http://${DINGTALK_CONFIGMAP_NAME}:8060/dingtalk`;

  /**
   * 通知对象（email/dingtalk/website-receiver）更新后，将最新 receiver 定义同步到所有引用该 receiver 的策略 AlertmanagerConfig。
   * 策略创建时会把通知对象的配置内联到 spec.receivers，修改通知对象后需刷新这些策略中的副本。
   */
  async function syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(
    conn: { origin: string; token: string; insecure: boolean },
    namespace: string,
    updatedReceivers: any[]
  ): Promise<void> {
    if (!Array.isArray(updatedReceivers) || updatedReceivers.length === 0) return;
    const namesToSync = new Set(updatedReceivers.map((r: any) => (r?.name ?? '').toString().trim()).filter(Boolean));
    if (namesToSync.size === 0) return;
    const listUrl = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
    let raw: any;
    try {
      raw = await getJsonOnce(listUrl, conn.token, conn.insecure, true);
    } catch (e) {
      console.warn('[syncPoliciesReceiverSpecs] list configs failed:', e);
      return;
    }
    const items: any[] = Array.isArray(raw?.data) ? raw.data : [];
    const receiverConfigNames = new Set([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);
    const policiesToUpdate: Array<{ namespace: string; policyName: string }> = [];
    for (const item of items) {
      const inner = item?.data ?? item;
      const policyName = (inner?.metadata?.name ?? '').toString().trim();
      const ns = (inner?.metadata?.namespace ?? '').toString().trim();
      if (receiverConfigNames.has(policyName) || ns !== namespace) continue;
      const route = inner?.spec?.route ?? {};
      const refs = collectReceiverNamesFromRoute(route);
      if (refs.some((rn: string) => namesToSync.has(rn))) policiesToUpdate.push({ namespace: ns, policyName });
    }
    const pathBase = ALERTMANAGERCONFIG_BASE;
    for (const { namespace: ns, policyName } of policiesToUpdate) {
      try {
        const getPath = `${pathBase}/${encodeURIComponent(ns)}/${encodeURIComponent(policyName)}`;
        const policyRaw = await getJsonOnce(`${conn.origin}/${getPath}`, conn.token, conn.insecure, true);
        const policy = (policyRaw as any)?.data != null && typeof (policyRaw as any).data === 'object' ? (policyRaw as any).data : policyRaw;
        if (!policy?.spec?.receivers) continue;
        const receivers = Array.isArray(policy.spec.receivers) ? policy.spec.receivers : [];
        const nextReceivers = receivers.map((r: any) => {
          const rn = (r?.name ?? '').toString().trim();
          const updated = updatedReceivers.find((u: any) => (u?.name ?? '').toString().trim() === rn);
          return updated ?? r;
        });
        const payload = { ...policy, spec: { ...policy.spec, receivers: nextReceivers } };
        await requestJson('PUT', `${conn.origin}/${getPath}`, conn.token, conn.insecure, payload);
      } catch (e) {
        console.warn(`[syncPoliciesReceiverSpecs] policy ${ns}/${policyName} failed:`, e);
      }
    }
  }

  /** 从 spec（route.matchers / route.routes[].matchers / matchRe / match / annotations.matchers）解析告警规则名称列表 */
  function extractAlertNamesFromSpec(spec: any, annotations?: Record<string, string>): string[] {
    const route = spec?.route ?? {};
    let routeMatchers = Array.isArray(route.matchers) ? route.matchers : [];
    if (routeMatchers.length === 0 && Array.isArray(route.routes) && route.routes.length > 0) {
      const firstChild = route.routes[0];
      routeMatchers = Array.isArray(firstChild?.matchers) ? firstChild.matchers : [];
    }
    const alertnameMatchers = routeMatchers.filter((m: any) => String(m?.name ?? '').toLowerCase() === 'alertname');
    if (alertnameMatchers.length > 0) {
      const first = alertnameMatchers[0];
      const matchType = String(first?.matchType ?? '').trim();
      const value = String(first?.value ?? '').trim();
      if (matchType === '=~' && value) {
        return value.split('|').map((s: string) => s.trim()).filter(Boolean);
      }
      return alertnameMatchers.map((m: any) => String(m?.value ?? '').trim()).filter(Boolean);
    }
    const matchRe = route.matchRe ?? {};
    const alertnameRe = (matchRe.alertname ?? '').toString().trim();
    if (alertnameRe) {
      const parts: string[] = [];
      let current = '';
      for (let i = 0; i < alertnameRe.length; i++) {
        const c = alertnameRe[i];
        if (c === '\\' && i + 1 < alertnameRe.length) {
          current += alertnameRe[i + 1];
          i++;
        } else if (c === '|') {
          if (current.trim()) parts.push(current.trim());
          current = '';
        } else {
          current += c;
        }
      }
      if (current.trim()) parts.push(current.trim());
      return parts.filter(Boolean);
    }
    const match = route.match ?? {};
    const alertnameExact = (match.alertname ?? '').toString().trim();
    if (alertnameExact) return [alertnameExact];
    const matchersStr = annotations?.matchers ?? '';
    if (typeof matchersStr === 'string' && matchersStr.trim()) {
      return matchersStr.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }

  const SECRETS_BASE = 'v1/harvester/secrets';
  const CONFIGMAPS_BASE = 'v1/harvester/configmaps';

  const DINGTALK_MESSAGE_TEMPLATE = {
    title: '{{ template "ding.link.title" . }}',
    text: '{{ template "ding.link.content" . }}',
  };

  function buildDingtalkMessageTemplate(): { title: string; text: string } {
    // Return a fresh object each time to avoid yaml anchors (e.g. &ref_0)
    return {
      title: DINGTALK_MESSAGE_TEMPLATE.title,
      text: DINGTALK_MESSAGE_TEMPLATE.text,
    };
  }

  function buildDefaultDingtalkConfigYamlObject(): { templates: string[]; targets: Record<string, any> } {
    return {
      templates: ['/etc/prometheus-webhook-dingtalk/templates/dingtalk.tmpl'],
      targets: {},
    };
  }

  /** 构建钉钉机器人完整 URL：robotUrl?access_token=robotAccessToken */
  function buildDingtalkTargetUrl(robotUrl: string, robotAccessToken: string): string {
    const base = (robotUrl || 'https://oapi.dingtalk.com/robot/send').trim();
    const token = (robotAccessToken || '').trim();
    if (!token) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}access_token=${encodeURIComponent(token)}`;
  }

  /** 从 ConfigMap 对象解析出 targets 与 configYamlObject，并应用 oldRobotAccounts/newTargets 得到 nextYaml */
  function buildNextYamlFromExisting(
    existing: any,
    oldRobotAccounts: string[],
    newTargets: Array<{ robotAccount: string; robotUrl?: string; robotAccessToken?: string }>
  ): string {
    const rawTargets: Record<string, { url?: string; message?: { title?: string; text?: string } }> = {};
    let configYamlObject: any = buildDefaultDingtalkConfigYamlObject();
    if (existing) {
      const data = existing?.data && typeof existing.data === 'object' ? existing.data : {};
      const configYaml = (data[DINGTALK_CONFIG_KEY] ?? data['config.yml'] ?? '').toString();
      if (configYaml) {
        try {
          const parsed = (yaml.load(configYaml) as any) || {};
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            configYamlObject = parsed;
          }
          const t = configYamlObject?.targets;
          if (t && typeof t === 'object' && !Array.isArray(t)) {
            for (const [k, v] of Object.entries(t)) {
              if (v && typeof v === 'object' && typeof (v as any).url === 'string') {
                const msg = (v as any).message;
                const nextMsg =
                  msg && typeof msg === 'object'
                    ? {
                        title: (msg as any).title ?? DINGTALK_MESSAGE_TEMPLATE.title,
                        text: (msg as any).text ?? DINGTALK_MESSAGE_TEMPLATE.text,
                      }
                    : buildDingtalkMessageTemplate();
                rawTargets[k] = {
                  url: (v as any).url,
                  message: nextMsg,
                };
              }
            }
          }
        } catch {
          /* ignore parse error */
        }
      }
    }
    const targets: Record<string, { url: string; message: { title: string; text: string } }> = {};
    for (const [k, v] of Object.entries(rawTargets)) {
      if (v && typeof v === 'object' && typeof (v as any).url === 'string') {
        const msg = (v as any).message;
        targets[k] = {
          url: (v as any).url,
          message:
            msg && typeof msg === 'object' && msg.title != null && msg.text != null
              ? { title: String(msg.title), text: String(msg.text) }
              : buildDingtalkMessageTemplate(),
        };
      }
    }
    for (const acc of oldRobotAccounts) {
      if (acc) delete targets[acc];
    }
    for (const t of newTargets) {
      const acc = (t.robotAccount || '').trim();
      if (!acc) continue;
      const url = buildDingtalkTargetUrl(t.robotUrl || '', t.robotAccessToken || '');
      targets[acc] = { url, message: buildDingtalkMessageTemplate() };
    }
    const nextConfigYamlObject =
      configYamlObject && typeof configYamlObject === 'object' && !Array.isArray(configYamlObject)
        ? { ...configYamlObject, targets }
        : { ...buildDefaultDingtalkConfigYamlObject(), targets };
    return yaml.dump(nextConfigYamlObject, { noRefs: true, lineWidth: -1 });
  }

  /**
   * 滚动更新 alertmanager-webhook-dingtalk Deployment：修改 Pod 模板注解以触发重建。
   * - 命名空间：cattle-monitoring-system（与 DINGTALK_CONFIGMAP_NS 一致）
   * - Deployment 名称：alertmanager-webhook-dingtalk（与 DINGTALK_CONFIGMAP_NAME 一致）
   *
   * 若获取或更新 Deployment 失败，仅记录告警日志，不影响主流程（ConfigMap 已成功更新）。
   */
  async function restartDingtalkWebhookDeployment(
    conn: { origin: string; token: string; insecure: boolean }
  ): Promise<void> {
    const namespace = DINGTALK_CONFIGMAP_NS;
    const name = DINGTALK_CONFIGMAP_NAME;
    const candidates = [
      // 直连 K8s API（通过 /k8s/clusters/{id} 前缀）
      `${conn.origin}/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`,
      // Harvester 透传 K8s API（与 nodes 查询方式保持一致）
      `${conn.origin}/v1/harvester/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`,
    ];

    let existing: any = null;
    let urlUsed: string | null = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
        if (!raw) continue;
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as any).metadata != null) {
          existing = raw;
        } else if (
          (raw as any)?.data != null &&
          typeof (raw as any).data === 'object' &&
          !Array.isArray((raw as any).data) &&
          (raw as any).data?.metadata != null
        ) {
          existing = (raw as any).data;
        } else {
          existing =
            (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
        }
        urlUsed = url;
        break;
      } catch (e: any) {
        lastErr = e;
      }
    }

    if (!existing || !urlUsed) {
      if (lastErr) {
        console.warn('[dingtalk-receiver] restart alertmanager-webhook-dingtalk: get deployment failed:', lastErr);
      }
      return;
    }

    const now = new Date().toISOString();
    const template = (existing as any).spec?.template || {};
    const templateMeta = template.metadata || {};
    const templateAnnotations = templateMeta.annotations || {};
    const patched: any = {
      ...existing,
      spec: {
        ...(existing as any).spec,
        template: {
          ...template,
          metadata: {
            ...templateMeta,
            annotations: {
              ...templateAnnotations,
              'compute-tower.io/restarted-at': now,
            },
          },
        },
      },
    };

    try {
      await requestJson('PUT', urlUsed, conn.token, conn.insecure, patched);
    } catch (e: any) {
      console.warn('[dingtalk-receiver] restart alertmanager-webhook-dingtalk: update deployment failed:', e);
    }
  }

  /** 同步 dingtalkWebhookConfig：更新 ConfigMap targets，原子性与 DB 操作配合。先 GET 再修改再 PUT，resourceVersion 来自同一次 GET；若 PUT 返回 409（旧数据）则重试。 */
  async function syncDingtalkWebhookConfig(
    conn: { origin: string; token: string; insecure: boolean },
    oldRobotAccounts: string[],
    newTargets: Array<{ robotAccount: string; robotUrl?: string; robotAccessToken?: string }>
  ): Promise<void> {
    const path = `${CONFIGMAPS_BASE}/${encodeURIComponent(DINGTALK_CONFIGMAP_NS)}/${encodeURIComponent(DINGTALK_CONFIGMAP_NAME)}`;
    const getUrl = `${conn.origin}/${path}`;
    const maxPutRetries = 3;

    let existing: any = null;
    try {
      const raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
      // 单资源 GET：Harvester 可能直接返回资源（带 metadata），或包装在 data 里；勿把 ConfigMap 的 .data 误当作资源
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as any).metadata != null) {
        existing = raw;
      } else if ((raw as any)?.data != null && typeof (raw as any).data === 'object' && !Array.isArray((raw as any).data) && (raw as any).data?.metadata != null) {
        existing = (raw as any).data;
      } else {
        existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
      }
    } catch {
      existing = null;
    }

    if (!existing) {
      const nextYaml = buildNextYamlFromExisting(null, oldRobotAccounts, newTargets);
      const payload = {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: DINGTALK_CONFIGMAP_NAME, namespace: DINGTALK_CONFIGMAP_NS },
        data: { [DINGTALK_CONFIG_KEY]: nextYaml },
      };
      await requestJson('POST', `${conn.origin}/${CONFIGMAPS_BASE}`, conn.token, conn.insecure, payload);
      // ConfigMap 首次创建成功后，滚动更新 alertmanager-webhook-dingtalk，以便加载最新配置
      await restartDingtalkWebhookDeployment(conn);
      return;
    }

    for (let attempt = 0; attempt < maxPutRetries; attempt++) {
      const nextYaml = buildNextYamlFromExisting(existing, oldRobotAccounts, newTargets);
      const resourceVersion = (existing?.metadata?.resourceVersion ?? '').toString().trim();
      if (!resourceVersion) {
        throw new Error('ConfigMap 缺少 resourceVersion，无法更新');
      }
      const data = existing?.data && typeof existing.data === 'object' ? existing.data : {};
      const payload = {
        ...existing,
        metadata: { ...existing.metadata, name: DINGTALK_CONFIGMAP_NAME, namespace: DINGTALK_CONFIGMAP_NS, resourceVersion },
        data: { ...data, [DINGTALK_CONFIG_KEY]: nextYaml },
      };
      try {
        await requestJson('PUT', getUrl, conn.token, conn.insecure, payload);
        // ConfigMap 更新成功后，滚动更新 alertmanager-webhook-dingtalk，以便加载最新配置
        await restartDingtalkWebhookDeployment(conn);
        return;
      } catch (e: any) {
        const status = Number((e as any)?.status ?? (e as any)?.statusCode ?? 0);
        if (status === 409 && attempt < maxPutRetries - 1) {
          const raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
          if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as any).metadata != null) {
            existing = raw;
          } else if ((raw as any)?.data != null && typeof (raw as any).data === 'object' && !Array.isArray((raw as any).data) && (raw as any).data?.metadata != null) {
            existing = (raw as any).data;
          } else {
            existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
          }
          continue;
        }
        throw e;
      }
    }
  }

  /** 从 ConfigMap 移除单个钉钉 target（封装 syncDingtalkWebhookConfig） */
  async function removeDingtalkConfigMapTarget(
    conn: { origin: string; token: string; insecure: boolean },
    robotAccount: string
  ): Promise<void> {
    await syncDingtalkWebhookConfig(conn, [robotAccount], []);
  }

  /**
   * 更新 ConfigMap 钉钉 targets（与 alertmanager-webhook-dingtalk config.yaml 中 targets 对应）。
   * target 键为 robotAccount，约定为 namespace_specReceiverName（如 cattle-monitoring-system_ops-dingtalk）。
   */
  async function updateDingtalkConfigMapTargets(
    conn: { origin: string; token: string; insecure: boolean },
    namespace: string,
    rawReceivers: any[]
  ): Promise<void> {
    const newTargets: Array<{ robotAccount: string; robotUrl?: string; robotAccessToken?: string }> = [];
    for (const r of rawReceivers || []) {
      const webhookConfigs = Array.isArray(r.webhookConfigs) ? r.webhookConfigs : [];
      const specReceiverName = (r?.name ?? '').toString().trim();
      for (const wc of webhookConfigs) {
        const robotAccount =
          (wc as any)?.robotAccount ?? (r as any)?.robotAccount ?? `${namespace}_${specReceiverName}`;
        newTargets.push({
          robotAccount,
          robotUrl: (wc as any)?.robotUrl ?? (r as any)?.robotUrl,
          robotAccessToken: (wc as any)?.robotAccessToken ?? (r as any)?.robotAccessToken,
        });
      }
    }
    await syncDingtalkWebhookConfig(conn, [], newTargets);
  }

  router.get('/:id/monitoring/secrets', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = String(req.query?.namespace ?? 'cattle-monitoring-system').trim();
      const datasource = String(req.query?.datasource ?? 'prometheus').trim().toLowerCase();
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权访问该命名空间下的密钥对象',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const excludeQs =
        'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state';
      const filterQs = `&filter=metadata.namespace=${encodeURIComponent(namespace)}`;
      const labelQs = `&labelSelector=${encodeURIComponent(MONITORING_RECEIVER_SECRET_LABEL + '=true')}`;
      const apiPath = `${SECRETS_BASE}?${PAGESIZE}&${excludeQs}${filterQs}${labelQs}`;
      const raw = await getJsonOnce(`${conn.origin}/${apiPath}`, conn.token, conn.insecure, true);
      const list: any[] = Array.isArray(raw?.data) ? raw.data : [];
      const secretList = list.map((item: any) => ({
        name: (item?.metadata?.name ?? item?.name ?? '').toString().trim(),
        data: item?.data && typeof item.data === 'object' ? item.data : {},
        type: (item?.type ?? 'Opaque').toString(),
      }));
      res.json(secretList);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json([]);
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求密钥secrets列表失败' });
    }
  });

  router.get('/:id/monitoring/secrets/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = (req.params.namespace ?? '').toString().trim();
      const name = (req.params.name ?? '').toString().trim();
      if (!namespace || !name) {
        return res.status(400).json({ message: '命名空间与密钥名称不能为空' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权访问该命名空间下的密钥对象',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const path = `${SECRETS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      const excludeQs =
        'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&exclude=metadata.annotations';
      const url = `${conn.origin}/${path}?${excludeQs}`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      // Harvester 单资源 GET：可能返回 { data: resource } 或 resource 本身。Secret 的 data 字段是键值对，非资源，需排除
      const item =
        (raw as any)?.data != null &&
        typeof (raw as any).data === 'object' &&
        (raw as any).data?.metadata != null
          ? (raw as any).data
          : raw;
      if (!item?.metadata) {
        return res.status(404).json({ message: '密钥不存在' });
      }
      if (item?.metadata?.labels?.[MONITORING_RECEIVER_SECRET_LABEL] !== 'true') {
        return res.status(400).json({ message: '该密钥不是告警接收器密钥（缺少 monitoring-receiver-secret 标签）' });
      }
      res.json({
        name: (item?.metadata?.name ?? item?.name ?? '').toString().trim(),
        namespace: (item?.metadata?.namespace ?? '').toString().trim(),
        data: item?.data && typeof item.data === 'object' ? item.data : {},
        type: (item?.type ?? 'Opaque').toString(),
      });
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({});
      const status = (e as any).status ?? (e as any).statusCode ?? 500;
      res.status(status).json({ message: e?.message || '请求密钥失败' });
    }
  });

  router.post('/:id/monitoring/secrets', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const body = req.body;
      const namespace = (body?.metadata?.namespace ?? '').toString().trim();
      const name = (body?.metadata?.name ?? '').toString().trim();
      if (!namespace || !name) {
        return res.status(400).json({ message: 'metadata.namespace 与 metadata.name 不能为空' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权访问该命名空间下的密钥对象',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const payload = {
        apiVersion: 'v1',
        kind: 'Secret',
        type: body?.type ?? 'Opaque',
        metadata: {
          name,
          namespace,
          labels: { ...(body?.metadata?.labels || {}), [MONITORING_RECEIVER_SECRET_LABEL]: 'true' },
        },
        data: body?.data && typeof body.data === 'object' ? body.data : {},
      };
      const url = `${conn.origin}/${SECRETS_BASE}`;
      await requestJson('POST', url, conn.token, conn.insecure, payload);
      res.status(201).json({ message: '创建成功' });
    } catch (e: any) {
      const status = (e as any).status ?? (e as any).statusCode ?? 500;
      const errMsg = (e as any).message || (typeof (e as any).body === 'string' ? (e as any).body : '') || '创建密钥失败';
      res.status(status).json({ message: errMsg });
    }
  });

  router.put('/:id/monitoring/secrets/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = (req.params.namespace ?? '').toString().trim();
      const name = (req.params.name ?? '').toString().trim();
      const body = req.body;
      if (!namespace || !name) {
        return res.status(400).json({ message: 'namespace 与 name 不能为空' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权访问该命名空间下的密钥对象',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const getPath = `${SECRETS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      const existingRaw = await getJsonOnce(`${conn.origin}/${getPath}`, conn.token, conn.insecure, true);
      const existing =
        (existingRaw as any)?.data != null &&
        typeof (existingRaw as any).data === 'object' &&
        (existingRaw as any).data?.metadata != null
          ? (existingRaw as any).data
          : existingRaw;
      if (!existing?.metadata) {
        return res.status(404).json({ message: '密钥不存在' });
      }
      if (existing?.metadata?.labels?.[MONITORING_RECEIVER_SECRET_LABEL] !== 'true') {
        return res.status(400).json({ message: '该密钥不是告警接收器密钥，无法通过此接口修改' });
      }
      const payload = {
        apiVersion: 'v1',
        kind: 'Secret',
        type: body?.type ?? existing?.type ?? 'Opaque',
        metadata: {
          ...existing.metadata,
          name,
          namespace,
          resourceVersion: existing.metadata?.resourceVersion,
          labels: { ...(existing.metadata?.labels || {}), [MONITORING_RECEIVER_SECRET_LABEL]: 'true' },
        },
        data: body?.data && typeof body.data === 'object' ? body.data : existing?.data || {},
      };
      const putUrl = `${conn.origin}/${getPath}`;
      await requestJson('PUT', putUrl, conn.token, conn.insecure, payload);
      res.json({ message: '更新成功' });
    } catch (e: any) {
      const status = (e as any).status ?? (e as any).statusCode ?? 500;
      const errMsg = (e as any).message || (typeof (e as any).body === 'string' ? (e as any).body : '') || '更新密钥失败';
      res.status(status).json({ message: errMsg });
    }
  });

  router.delete('/:id/monitoring/secrets/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = (req.params.namespace ?? '').toString().trim();
      const name = (req.params.name ?? '').toString().trim();
      if (!namespace || !name) {
        return res.status(400).json({ message: 'namespace 与 name 不能为空' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权访问该命名空间下的密钥对象',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const getPath = `${SECRETS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      const existingRaw = await getJsonOnce(`${conn.origin}/${getPath}`, conn.token, conn.insecure, true);
      const existing =
        (existingRaw as any)?.data != null &&
        typeof (existingRaw as any).data === 'object' &&
        (existingRaw as any).data?.metadata != null
          ? (existingRaw as any).data
          : existingRaw;
      if (existing?.metadata && existing?.metadata?.labels?.[MONITORING_RECEIVER_SECRET_LABEL] !== 'true') {
        return res.status(400).json({ message: '该密钥不是告警接收器密钥，无法通过此接口删除' });
      }
      await requestJson('DELETE', `${conn.origin}/${getPath}`, conn.token, conn.insecure);
      res.status(204).send();
    } catch (e: any) {
      const status = (e as any).status ?? (e as any).statusCode ?? 500;
      const errMsg = (e as any).message || (typeof (e as any).body === 'string' ? (e as any).body : '') || '删除密钥失败';
      res.status(status).json({ message: errMsg });
    }
  });

  router.get('/:id/monitoring/configmaps/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = (req.params.namespace ?? '').toString().trim();
      const name = (req.params.name ?? '').toString().trim();
      if (!namespace || !name) {
        return res.status(400).json({ message: '命名空间与配置名称不能为空' });
      }
      if (namespace !== DINGTALK_CONFIGMAP_NS || name !== DINGTALK_CONFIGMAP_NAME) {
        return res.status(400).json({
          message: `仅允许访问 ConfigMap ${DINGTALK_CONFIGMAP_NS}/${DINGTALK_CONFIGMAP_NAME}`,
        });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权访问该命名空间下的 ConfigMap',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const path = `${CONFIGMAPS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      const excludeQs = 'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.annotations';
      const url = `${conn.origin}/${path}?${excludeQs}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({});
      const status = (e as any).status || (e as any).statusCode || 500;
      res.status(status).json({ message: e?.message || '请求 ConfigMap 失败' });
    }
  });

  router.get('/:id/monitoring/prometheusrules/vm-custom-rules', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const exclude = 'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&exclude=metadata.labels&exclude=metadata.annotations';
      const data = await getJsonOnce(`${conn.origin}/${PROMETHEUSRULE_VM}?limit=-1&${exclude}`, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({});
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求虚拟机告警规则失败' });
    }
  });

  /** 告警通知策略：直接从 Harvester API 获取列表（不读写 DB），排除 email/dingtalk/website-receiver */
  router.get('/:id/monitoring/alertmanagerconfigs', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const tenant = await getTenantAccess(req, cloudId);
      if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const url = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      let list: any[] = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw) ? raw : []);
      const receiverConfigNames = new Set([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);
      list = list.filter((item: any) => {
        const inner = item?.data ?? item;
        const name = (inner?.metadata?.name ?? item?.name ?? '').toString().trim();
        if (receiverConfigNames.has(name)) return false;
        return true;
      });
      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedSet = new Set(tenant.namespaces);
        list = list.filter((item: any) => {
          const inner = item?.data ?? item;
          const ns = (inner?.metadata?.namespace ?? item?.namespace ?? '').toString().trim();
          return allowedSet.has(ns);
        });
      }
      const alertNameFilter = (req.query?.alertName ?? '').toString().trim();
      if (alertNameFilter) {
        list = list.filter((item: any) => {
          const inner = item?.data ?? item;
          const spec = inner?.spec ?? {};
          const meta = inner?.metadata ?? {};
          const annotations = meta?.annotations && typeof meta.annotations === 'object' ? meta.annotations : {};
          const names = extractAlertNamesFromSpec(spec, annotations);
          return names.includes(alertNameFilter);
        });
      }
      const normalized = list.map((item: any) => {
        const inner = item?.data ?? item;
        const meta = inner?.metadata ?? {};
        const name = (meta?.name ?? inner?.name ?? '').toString().trim();
        const ns = (meta?.namespace ?? '').toString().trim();
        return {
          id: `${ns}/${name}`,
          metadata: { ...meta, name, namespace: ns },
          spec: inner?.spec ?? {},
        };
      });
      res.json({ data: normalized });
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ data: [] });
      if (Number((e as any)?.status) === 502) return res.status(200).json({ data: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求告警通知策略失败' });
    }
  });

  // GET /:id/monitoring/alertmanagerconfigs/receivers — 告警通知对象
  // 返回结构对齐 monitoring.coreos.com AlertmanagerConfig spec.receivers[]（前端 ReceiverSpec）
  /** 将 query 中的某参数规范为字符串数组（支持 ?namespaces=a&namespaces=b 或 ?namespaces=a,b） */
  function parseQueryArray(value: unknown): string[] {
    if (value == null) return [];
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    const s = String(value).trim();
    if (!s) return [];
    return s.split(',').map((v) => v.trim()).filter(Boolean);
  }

  const DEFAULT_RECEIVER_NAMES = [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER];

  /** 告警通知对象：直接从 Harvester API 获取，仅拉取 labels 为 monitoring-receiver=true 的 AlertmanagerConfig */
  router.get('/:id/monitoring/alertmanagerconfigs/receivers', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespaces = parseQueryArray(req.query?.namespaces);
      let receiverNames = parseQueryArray(req.query?.receiverName);
      if (receiverNames.length === 0) receiverNames = [...DEFAULT_RECEIVER_NAMES];
      const tenant = await requireTenantAccess(req, res, cloudId, { namespaces });
      if (!tenant) return;
      const conn = await getCloudConnOnly(cloudId);
      const receivers: any[] = [];
      const nsFilter = namespaces.length > 0 ? namespaces : null;

      if (!conn) {
        return res.json({ receivers });
      }

      const labelQs = `&labelSelector=${encodeURIComponent(MONITORING_RECEIVER_LABEL_SELECTOR)}`;
      const url = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}${labelQs}`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      const harvesterList: any[] = Array.isArray(raw?.data) ? raw.data : [];

      for (const item of harvesterList) {
        const inner = item?.data ?? item;
        const ns = (inner?.metadata?.namespace ?? '').toString().trim();
        const name = (inner?.metadata?.name ?? '').toString().trim();
        if (!ns || !name) continue;
        if (nsFilter?.length && !nsFilter.includes(ns)) continue;
        if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) continue;
        if (!receiverNames.includes(name)) continue;

        const spec = inner?.spec ?? {};
        const meta = inner?.metadata ?? {};
        const rawReceivers = Array.isArray(spec.receivers) ? spec.receivers : [];
        const creator = meta?.annotations?.['cloudhci.io/creator'];
        const createdAt = meta?.creationTimestamp ? String(meta.creationTimestamp) : undefined;

        const specReceivers = rawReceivers.map((r: any) => ({
          ...r,
          creator: creator ?? undefined,
          createdAt: createdAt ?? undefined,
        }));

        if (specReceivers.length > 0) {
          receivers.push({ namespace: ns, receiverName: name, specReceivers });
        }
      }

      res.json({ receivers });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '获取通知对象列表失败' });
    }
  });

  // GET /:id/monitoring/alertmanagerconfigs/receivers/check — 从 Harvester 校验通知对象名称是否已存在
  router.get('/:id/monitoring/alertmanagerconfigs/receivers/check', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = (req.query?.namespace ?? '').toString().trim();
      const specReceiverName = (req.query?.specReceiverName ?? '').toString().trim();
      const receiverType = (req.query?.receiverType ?? '').toString().trim();
      if (!namespace || !specReceiverName) {
        return res.status(400).json({ message: 'namespace 与 specReceiverName 不能为空' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, { namespaces: [namespace] });
      if (!tenant) return;
      const configName = receiverType && isValidReceiverConfigName(receiverType) ? receiverType : EMAIL_RECEIVER;
      const conn = await getCloudConnOnly(cloudId);
      let exists = false;
      if (conn) {
        try {
          const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(configName)}`;
          const raw = await getJsonOnce(`${conn.origin}/${path}`, conn.token, conn.insecure, true);
          const item = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
          const receivers = Array.isArray(item?.spec?.receivers) ? item.spec.receivers : [];
          exists = receivers.some((r: any) => (r?.name ?? '').toString().trim() === specReceiverName);
        } catch {
          /* 404 or error => exists false */
        }
      }
      res.json({ exists });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '校验失败' });
    }
  });

  // GET /:id/monitoring/alertmanagerconfigs/policy-receivers — 从 Harvester 查询引用某 receiver 的策略（namespace + specReceiverName）
  router.get('/:id/monitoring/alertmanagerconfigs/policy-receivers', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = (req.query?.namespace ?? '').toString().trim();
      const specReceiverName = (req.query?.specReceiverName ?? '').toString().trim();
      const tenant = await requireTenantAccess(req, res, cloudId);
      if (!tenant) return;
      const list: Array<{ namespace: string; policyName: string; receiverType?: string }> = [];
      const conn = await getCloudConnOnly(cloudId);
      if (!conn || !specReceiverName) {
        return res.json({ data: list });
      }
      const url = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      const items: any[] = Array.isArray(raw?.data) ? raw.data : [];
      const receiverConfigNames = new Set([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);
      for (const item of items) {
        const inner = item?.data ?? item;
        const policyName = (inner?.metadata?.name ?? '').toString().trim();
        const ns = (inner?.metadata?.namespace ?? '').toString().trim();
        if (receiverConfigNames.has(policyName)) continue;
        if (namespace && ns !== namespace) continue;
        if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) continue;
        const route = inner?.spec?.route ?? {};
        const refs = collectReceiverNamesFromRoute(route);
        if (refs.includes(specReceiverName)) {
          list.push({ namespace: ns, policyName });
        }
      }
      res.json({ data: list });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '查询失败' });
    }
  });

  /** 告警通知策略：直接从 Harvester API 获取详情（不读写 DB） */
  router.get('/:id/monitoring/alertmanagerconfigs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const { namespace, name } = req.params;
      const tenant = await requireTenantAccess(req, res, cloudId, { namespaces: [namespace] });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      const excludeQs = 'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.annotations';
      const url = `${conn.origin}/${path}?${excludeQs}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({});
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求配置详情失败' });
    }
  });

  /** 告警通知策略：直接调用 Harvester API 创建（不读写 DB） */
  router.post('/:id/monitoring/alertmanagerconfigs', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const body = req.body || {};
      const ns = (body?.metadata?.namespace ?? '').toString().trim();
      const name = (body?.metadata?.name ?? '').toString().trim();
      if (!ns || !name) {
        return res.status(400).json({ message: 'body 中 metadata.namespace 与 metadata.name 不能为空' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [ns],
        forbiddenMessage: '仅能在您有权限的命名空间下创建告警配置',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const payload = isPolicyAlertmanagerConfig(name)
        ? { ...body, spec: normalizePolicySpec(body.spec) }
        : body;
      const data = await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, payload);
      res.status(201).json(data);
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '创建告警配置失败' });
    }
  });

  /** 告警通知策略：直接调用 Harvester API 更新（不读写 DB） */
  router.put('/:id/monitoring/alertmanagerconfigs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const { namespace, name } = req.params;
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权修改该命名空间下的告警通知策略',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      const body = req.body || {};
      const payload = isPolicyAlertmanagerConfig(name)
        ? { ...body, spec: normalizePolicySpec(body.spec) }
        : body;
      const data = await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, payload);
      res.json(data);
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '更新告警通知策略失败' });
    }
  });

  router.delete('/:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const { namespace, name } = req.params;
      const specReceiverName = (req.query.specReceiverName ?? '').toString().trim();
      if (!specReceiverName) {
        return res.status(400).json({ message: '需要删除的通知对象名称不能为空' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, { namespaces: [namespace] });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      if (!isValidReceiverConfigName(name)) {
        return res.status(400).json({ message: '通知方式必须是邮件、钉钉或站内信之一' });
      }
      // 删除前检查是否被告警策略引用
      try {
        const listUrl = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
        const listRaw = await getJsonOnce(listUrl, conn.token, conn.insecure, true);
        const listItems: any[] = Array.isArray(listRaw?.data) ? listRaw.data : [];
        const receiverConfigNames = new Set([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);
        const referencedPolicies: string[] = [];
        for (const item of listItems) {
          const inner = item?.data ?? item;
          const policyName = (inner?.metadata?.name ?? '').toString().trim();
          const ns = (inner?.metadata?.namespace ?? '').toString().trim();
          if (ns !== namespace || receiverConfigNames.has(policyName)) continue;
          const route = inner?.spec?.route ?? {};
          const refs = collectReceiverNamesFromRoute(route);
          if (refs.includes(specReceiverName)) referencedPolicies.push(policyName);
        }
        if (referencedPolicies.length > 0) {
          return res.status(400).json({
            message: '该通知对象已被以下策略引用，请先解除关联',
            policies: referencedPolicies,
          });
        }
      } catch (e: any) {
        const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
        if (status >= 500) console.warn('[DELETE receivers] policy-references check failed:', e);
      }
      const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      const getUrl = `${conn.origin}/${path}`;
      const raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
      const existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
      if (!existing?.spec) {
        return res.status(404).json({ message: '未找到该通知对象名称' });
      }
      const receivers = Array.isArray(existing.spec.receivers) ? existing.spec.receivers : [];
      const toRemove = receivers.find((r: any) => (r?.name ?? '').toString().trim() === specReceiverName);
      const nextReceivers = receivers.filter((r: any) => (r?.name ?? '').toString().trim() !== specReceiverName);
      if (nextReceivers.length === receivers.length) {
        return res.status(404).json({ message: '未找到该通知对象名称' });
      }
      if (name === DINGTALK_RECEIVER && toRemove) {
        const robotAccount =
          ((toRemove as any)?.webhookConfigs?.[0] as any)?.robotAccount ??
          (toRemove as any)?.robotAccount ??
          `${namespace}_${specReceiverName}`;
        try {
          await removeDingtalkConfigMapTarget(conn, robotAccount);
        } catch (e: any) {
          const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
          const msg = e?.message || '移除钉钉 Webhook ConfigMap target 失败';
          if (status >= 500) console.error('[dingtalk-receiver] removeDingtalkConfigMapTarget:', e);
          return res.status(status).json({ message: msg });
        }
      }
      existing.spec.receivers = nextReceivers;
      await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, existing);
      res.status(204).send();
    } catch (e: any) {
      if (Number((e as any)?.status) === 404) {
        return res.status(404).json({ message: e?.message || '未找到该通知对象名称' });
      }
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '删除通知对象失败' });
    }
  });

  /** 邮件/站内信：receivers 原样透传，创建或更新 AlertmanagerConfig */
  async function processEmailReceivers(
    conn: { origin: string; token: string; insecure: boolean },
    ns: string,
    name: string,
    body: any,
    res: Response,
    path: string,
    getUrl: string
  ): Promise<Response | void> {
    const normalizeReceivers = (receivers: any[]) => (Array.isArray(receivers) ? receivers : []);
    let existingRaw: any = null;
    const exists = await getJsonOnce(getUrl, conn.token, conn.insecure, true)
      .then((data) => {
        existingRaw = data;
        return true;
      })
      .catch((err: any) => (err?.status === 404 || err?.statusCode === 404 ? false : Promise.reject(err)));
    if (!exists) {
      const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : [];
      const createPayload = {
        ...body,
        spec: { ...(body?.spec || {}), receivers: normalizeReceivers(rawReceivers) },
        metadata: {
          ...(body?.metadata || {}),
          namespace: ns,
          name,
          labels: { ...(body?.metadata?.labels || {}), 'monitoring-receiver': 'true' },
        },
      };
      const data = await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, createPayload);
      return res.status(201).json(data);
    }
    const existing = (existingRaw as any)?.data != null && typeof (existingRaw as any).data === 'object' ? (existingRaw as any).data : existingRaw;
    if (!existing?.spec) {
      return res.status(500).json({ message: '通知对象配置异常' });
    }
    const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : (existing.spec.receivers || []);
    existing.spec.receivers = normalizeReceivers(rawReceivers);
    if (!existing.metadata) existing.metadata = {};
    if (existing.metadata.labels?.['monitoring-receiver'] !== 'true') {
      existing.metadata.labels = { ...(existing.metadata.labels || {}), 'monitoring-receiver': 'true' };
    }
    const data = await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, existing);
    try {
      await syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(conn, ns, existing.spec.receivers);
    } catch (e) {
      console.warn('[processEmailReceivers] syncPoliciesReceiverSpecs failed:', e);
    }
    return res.json(data);
  }

  /**
   * 钉钉：normalize webhookConfigs + 更新 ConfigMap targets，再创建或更新 AlertmanagerConfig。
   * 与 alertmanager-webhook-dingtalk (cattle-monitoring-system) 的 config.yaml.targets 对应：
   * - 新增：POST 前若有 receivers 则 updateDingtalkConfigMapTargets(conn, ns, rawReceivers)，target 键为 namespace_specReceiverName 或 payload 中的 robotAccount。
   * - 修改：PUT 前若有 receivers 则 updateDingtalkConfigMapTargets(conn, ns, rawReceivers)，合并/覆盖对应 target。
   * - 删除：DELETE 某条 receiver 时 removeDingtalkConfigMapTarget(conn, robotAccount)，robotAccount 取自 webhookConfigs[0].robotAccount ?? receiver.robotAccount ?? namespace_specReceiverName。
   */
  async function processDingtalkReceivers(
    conn: { origin: string; token: string; insecure: boolean },
    ns: string,
    name: string,
    body: any,
    res: Response,
    path: string,
    getUrl: string
  ): Promise<Response | void> {
    /** 与前端 receivers.ts 一致：robotAccount = namespace_specReceiverName；url 优先用请求体，否则用内部代理地址 getDingtalkWebhookUrl(robotAccount)；仅持久化 url/sendResolved（robotUrl/robotAccessToken 在 ConfigMap） */
    const normalizeReceiversForDingtalk = (receivers: any[]): any[] => {
      if (!Array.isArray(receivers)) return receivers;
      return receivers.map((r: any) => {
        const specReceiverName = (r?.name ?? '').toString().trim();
        const webhookConfigs = Array.isArray(r.webhookConfigs) ? r.webhookConfigs : [];
        let normalized = webhookConfigs.map((wc: any) => {
          const robotAccount =
            (wc as any)?.robotAccount ?? (r as any)?.robotAccount ?? `${ns}_${specReceiverName}`;
          const explicitUrl = (r?.url ?? (wc as any)?.url ?? '').toString().trim();
          const url = explicitUrl || `${DINGTALK_WEBHOOK_BASE}/${robotAccount}/send`;
          return {
            url,
            sendResolved: (wc as any)?.sendResolved !== false,
          };
        });
        if (normalized.length === 0 && specReceiverName) {
          const robotAccount = `${ns}_${specReceiverName}`;
          normalized = [{ url: `${DINGTALK_WEBHOOK_BASE}/${robotAccount}/send`, sendResolved: true }];
        }
        return { ...r, webhookConfigs: normalized };
      });
    };
    let existingRaw: any = null;
    const exists = await getJsonOnce(getUrl, conn.token, conn.insecure, true)
      .then((data) => {
        existingRaw = data;
        return true;
      })
      .catch((err: any) => (err?.status === 404 || err?.statusCode === 404 ? false : Promise.reject(err)));
    if (!exists) {
      const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : [];
      if (rawReceivers.length > 0) {
        try {
          await updateDingtalkConfigMapTargets(conn, ns, rawReceivers);
        } catch (e: any) {
          const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
          const msg = e?.message || '更新钉钉Webhook配置文件失败';
          if (status >= 500) console.error('[dingtalk-receiver] updateDingtalkWebhookConfig:', e);
          return res.status(status).json({ message: msg });
        }
      }
      const createPayload = {
        ...body,
        spec: { ...(body?.spec || {}), receivers: normalizeReceiversForDingtalk(rawReceivers) },
        metadata: {
          ...(body?.metadata || {}),
          namespace: ns,
          name,
          labels: { ...(body?.metadata?.labels || {}), 'monitoring-receiver': 'true' },
        },
      };
      const data = await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, createPayload);
      return res.status(201).json(data);
    }
    const existing = (existingRaw as any)?.data != null && typeof (existingRaw as any).data === 'object' ? (existingRaw as any).data : existingRaw;
    if (!existing?.spec) {
      return res.status(500).json({ message: '通知对象配置异常' });
    }
    const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : (existing.spec.receivers || []);
    if (rawReceivers.length > 0) {
      try {
        await updateDingtalkConfigMapTargets(conn, ns, rawReceivers);
      } catch (e: any) {
        const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
        const msg = e?.message || '更新钉钉 Webhook ConfigMap 失败';
        if (status >= 500) console.error('[dingtalk-receiver] updateDingtalkConfigMapTargets:', e);
        return res.status(status).json({ message: msg });
      }
    }
    existing.spec.receivers = normalizeReceiversForDingtalk(rawReceivers);
    if (!existing.metadata) existing.metadata = {};
    if (existing.metadata.labels?.['monitoring-receiver'] !== 'true') {
      existing.metadata.labels = { ...(existing.metadata.labels || {}), 'monitoring-receiver': 'true' };
    }
    const data = await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, existing);
    try {
      await syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(conn, ns, existing.spec.receivers);
    } catch (e) {
      console.warn('[processDingtalkReceivers] syncPoliciesReceiverSpecs failed:', e);
    }
    return res.json(data);
  }

  router.post('/:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const ns = (req.params.namespace ?? '').toString().trim();
      const name = (req.params.name ?? '').toString().trim();
      if (!ns) return res.status(400).json({ message: '命名空间不能为空' });
      if (!isValidReceiverConfigName(name)) {
        return res.status(400).json({ message: '通知方式必须是邮件、钉钉或站内信之一' });
      }
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [ns],
        forbiddenMessage: '仅能在您有权限的命名空间下操作告警通知对象',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const body = req.body || {};
      const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
      const getUrl = `${conn.origin}/${path}`;
      if (name === EMAIL_RECEIVER) {
        return await processEmailReceivers(conn, ns, name, body, res, path, getUrl);
      }
      if (name === DINGTALK_RECEIVER) {
        return await processDingtalkReceivers(conn, ns, name, body, res, path, getUrl);
      }
      if (name === WEBSITE_RECEIVER) {
        const websitePayload = {
          apiVersion: 'monitoring.coreos.com/v1alpha1',
          kind: 'AlertmanagerConfig',
          metadata: { name: WEBSITE_RECEIVER, namespace: ns, labels: { 'monitoring-receiver': 'true' } },
          spec: { receivers: [{ name: WEBSITE_RECEIVER }] },
        };
        return await processEmailReceivers(conn, ns, name, websitePayload, res, path, getUrl);
      }
      return res.status(400).json({ message: '不支持的通知方式' });
    } catch (e: any) {
      const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
      const msg = e?.message || '创建或更新告警通知对象失败';
      if (status >= 500) console.error('[alertmanagerconfigs/receivers]', e);
      res.status(status).json({ message: msg });
    }
  });

  /** 告警通知策略：直接调用 Harvester API 删除（不读写 DB） */
  router.delete('/:id/monitoring/alertmanagerconfigs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const { namespace, name } = req.params;
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权删除该命名空间下的告警通知策略',
      });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      await requestJson('DELETE', `${conn.origin}/${path}`, conn.token, conn.insecure);
      res.status(204).send();
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '删除告警通知策略失败' });
    }
  });
}

