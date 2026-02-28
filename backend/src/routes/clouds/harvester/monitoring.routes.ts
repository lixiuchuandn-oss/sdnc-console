/**
 * 监控服务代理：概览 + 监控告警（存储、节点、告警列表、Alertmanager 配置等）
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

async function getCloudAndConn(id: string, res: Response): Promise<{ cloud: Cloud; origin: string; token: string; insecure: boolean } | null> {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String((cloud as any)?.config?.provider || '').toLowerCase();
  const isHarvesterLike = ['harvester', 'cloudmap', 'cloudmap.private', 'cloudmap.edge'].includes(provider);
  if (!isHarvesterLike) {
    res.status(400).json({ message: '仅支持 Harvester/Cloudmap 资源池的监控概览' });
    return null;
  }
  const origin = normalizeOrigin(cloud.endpoint || '');
  const token = cloud.secretKey || (cloud as any).config?.token || (cloud as any).config?.apiToken || '';
  const insecure = !!((cloud as any).config?.ignoreTls ?? (cloud as any).config?.insecure);
  if (!token) {
    res.status(400).json({ message: '资源池未配置访问凭证' });
    return null;
  }
  return { cloud, origin, token, insecure };
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
const ALERTMANAGER_PATH =
  'api/v1/namespaces/cattle-monitoring-system/services/http:rancher-monitoring-alertmanager:9093/proxy/api/v2/alerts';
const PROMETHEUS_QUERY_RANGE_PATH =
  'api/v1/namespaces/cattle-monitoring-system/services/http:rancher-monitoring-prometheus:9090/proxy/api/v1/query_range';

const DINGTALK_CONFIGMAP_NS = 'cattle-monitoring-system';
const DINGTALK_CONFIGMAP_NAME = 'alertmanager-webhook-dingtalk';
const DINGTALK_CONFIG_KEY = 'config.yaml';

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
      query.set('receiver', 'cattle-monitoring-system/default-alertmanager-config/message-receiver');
      const url = `${conn.origin}/${ALERTMANAGER_PATH}?${query.toString()}`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      // 源接口返回告警数组，每条含 labels.namespace，过滤按 labels.namespace 做
      let list: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []) || [];

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
      res.status(status).json({ message: e?.message || '请求告警列表失败' });
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

  /** AlertmanagerConfig 名称必须为 email-receiver / dingtalk-receiver / website-receiver 之一（通知对象专用） */
  function isValidReceiverConfigName(name: string): boolean {
    return [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER].includes(String(name || '').trim());
  }

  /** 钉钉 webhook 单条配置（用于 updateDingtalkConfigMapTargets 等） */
  interface DingtalkWebhookConfig {
    url?: string;
    webhookUrl?: string;
    robotUrl?: string;
    robotAccount?: string;
    accessToken?: string;
    robotAccessToken?: string;
    sendResolved?: boolean;
  }

  /** 钉钉 receiver（含 webhookConfigs） */
  interface DingtalkReceiver {
    name?: string;
    robotAccount?: string;
    webhookConfigs?: DingtalkWebhookConfig[];
  }

  const ALERTMANAGERCONFIG_BASE = 'v1/harvester/monitoring.coreos.com.alertmanagerconfigs';
  const PROMETHEUSRULE_VM = 'v1/harvester/monitoring.coreos.com.prometheusrules/cattle-monitoring-system/virtual-machine-custom-rules';
  const SECRETS_BASE = 'v1/harvester/secrets';
  const CONFIGMAPS_BASE = 'v1/harvester/configmaps';

  router.get('/:id/monitoring/secrets', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = String(req.query?.namespace ?? 'cattle-monitoring-system').trim();
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
      const labelQs = '&labelSelector=monitoring-receiver-secret%3Dtrue';
      const apiPath = `${SECRETS_BASE}?${PAGESIZE}&${excludeQs}${filterQs}${labelQs}`;
      const raw = await getJsonOnce(`${conn.origin}/${apiPath}`, conn.token, conn.insecure, true);
      const list: any[] = Array.isArray(raw?.data) ? raw.data : [];
      const secretList = list.map((item: any) => ({
        name: (item?.metadata?.name ?? item?.name ?? '').toString().trim(),
        data: item?.data && typeof item.data === 'object' ? item.data : {},
      }));
      res.json(secretList);
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json([]);
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求密钥secrets列表失败' });
    }
  });

  router.get('/:id/monitoring/configmaps/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespace = (req.params.namespace ?? '').toString().trim();
      const name = (req.params.name ?? '').toString().trim();
      if (!namespace || !name) {
        return res.status(400).json({ message: 'namespace 与 name 不能为空' });
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

  /** 将 dingtalk 接收方的 configMapTargetUrl 写入 ConfigMap targets[specReceiverName].url，成功后才可更新 dingtalk-receiver 的 spec。 */
  async function updateDingtalkConfigMapTargets(
    conn: { origin: string; token: string; insecure: boolean },
    rawReceivers: DingtalkReceiver[]
  ): Promise<void> {
    const path = `${CONFIGMAPS_BASE}/${encodeURIComponent(DINGTALK_CONFIGMAP_NS)}/${encodeURIComponent(DINGTALK_CONFIGMAP_NAME)}`;
    const getUrl = `${conn.origin}/${path}`;
    let raw: any;
    try {
      raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
    } catch (e: any) {
      const status = e?.status ?? e?.statusCode;
      if (status === 404) {
        const err = new Error('钉钉 Webhook ConfigMap 不存在，请先部署 alertmanager-webhook-dingtalk') as Error & { status?: number };
        err.status = 404;
        throw err;
      }
      throw e;
    }
    // Harvester 可能返回 { data: resource } 或直接返回 resource（metadata + data 在顶层）
    let configmap: any = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
    if (!configmap?.metadata && (raw as any)?.metadata && typeof (raw as any).data === 'object') {
      configmap = raw;
    }
    const data = configmap?.data || {};
    let configYaml = (data[DINGTALK_CONFIG_KEY] ?? data['config.yml'] ?? '').toString();
    let config: { targets?: Record<string, { url?: string; [k: string]: any }>; [k: string]: any };
    try {
      config = (yaml.load(configYaml) as Record<string, any>) || {};
    } catch {
      const err = new Error('钉钉 Webhook ConfigMap 的 YAML 解析失败') as Error & { status?: number };
      err.status = 400;
      throw err;
    }
    if (!config.targets || typeof config.targets !== 'object' || Array.isArray(config.targets)) {
      config.targets = {};
    }
    const defaultDingtalkMessage = {
      title: '{{ template "ding.link.title" . }}',
      text: '{{ template "ding.link.content" . }}',
    };
    for (const r of rawReceivers) {
      const webhookConfigs = Array.isArray(r.webhookConfigs) ? r.webhookConfigs : [];
      const wc = webhookConfigs[0];
      const robotAccount = (wc?.robotAccount ?? r?.robotAccount ?? '').toString().trim();
      if (!robotAccount) continue;
      const robotUrl = (wc?.robotUrl ?? wc?.webhookUrl ?? '').toString().trim();
      const robotAccessToken = (wc?.robotAccessToken ?? wc?.accessToken ?? '').toString().trim();
      let configMapTargetUrl: string | undefined;
      if (robotUrl && robotAccessToken) {
        configMapTargetUrl = robotUrl + (robotUrl.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(robotAccessToken);
      } else if (robotUrl) {
        configMapTargetUrl = robotUrl;
      } else {
        configMapTargetUrl = undefined;
      }
      const existing = config.targets[robotAccount] && typeof config.targets[robotAccount] === 'object'
        ? config.targets[robotAccount]
        : {};
      config.targets[robotAccount] = {
        ...existing,
        url: configMapTargetUrl ?? existing.url,
        message: defaultDingtalkMessage,
      };
    }
    configYaml = yaml.dump(config, { lineWidth: -1 });
    const meta = configmap?.metadata || {};
    const resourceVersion = meta.resourceVersion;
    if (!resourceVersion) {
      const err = new Error('ConfigMap 响应缺少 metadata.resourceVersion，无法执行更新') as Error & { status?: number };
      err.status = 500;
      throw err;
    }
    const updated = {
      ...configmap,
      metadata: { ...meta, resourceVersion },
      data: { ...data, [DINGTALK_CONFIG_KEY]: configYaml },
    };
    try {
      await requestJson('PUT', getUrl, conn.token, conn.insecure, updated);
    } catch (e: any) {
      const status = e?.status ?? e?.statusCode;
      const body = typeof e?.body === 'string' ? e.body : '';
      const msg = body ? `${e?.message || '更新 ConfigMap 失败'}: ${body}` : (e?.message || '更新钉钉 Webhook ConfigMap 失败');
      const err = new Error(msg) as Error & { status?: number };
      err.status = typeof status === 'number' ? status : 500;
      throw err;
    }
  }

  /** 从钉钉 Webhook ConfigMap 的 targets 中移除指定 robotAccount 对应的条目 */
  async function removeDingtalkConfigMapTarget(
    conn: { origin: string; token: string; insecure: boolean },
    robotAccount: string
  ): Promise<void> {
    const trimmedAccount = (robotAccount ?? '').toString().trim();
    if (!trimmedAccount) return;
    const path = `${CONFIGMAPS_BASE}/${encodeURIComponent(DINGTALK_CONFIGMAP_NS)}/${encodeURIComponent(DINGTALK_CONFIGMAP_NAME)}`;
    const getUrl = `${conn.origin}/${path}`;
    let raw: any;
    try {
      raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
    } catch (e: any) {
      const status = e?.status ?? e?.statusCode;
      if (status === 404) return; // ConfigMap 不存在则跳过
      throw e;
    }
    let configmap: any = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
    if (!configmap?.metadata && (raw as any)?.metadata && typeof (raw as any).data === 'object') {
      configmap = raw;
    }
    const data = configmap?.data || {};
    let configYaml = (data[DINGTALK_CONFIG_KEY] ?? data['config.yml'] ?? '').toString();
    let config: { targets?: Record<string, any>; [k: string]: any };
    try {
      config = (yaml.load(configYaml) as Record<string, any>) || {};
    } catch {
      return; // YAML 解析失败则跳过
    }
    if (!config.targets || typeof config.targets !== 'object' || Array.isArray(config.targets)) {
      return;
    }
    if (!(trimmedAccount in config.targets)) return;
    delete config.targets[trimmedAccount];
    configYaml = yaml.dump(config, { lineWidth: -1 });
    const meta = configmap?.metadata || {};
    const resourceVersion = meta.resourceVersion;
    if (!resourceVersion) return;
    const updated = {
      ...configmap,
      metadata: { ...meta, resourceVersion },
      data: { ...data, [DINGTALK_CONFIG_KEY]: configYaml },
    };
    try {
      await requestJson('PUT', getUrl, conn.token, conn.insecure, updated);
    } catch (e: any) {
      const status = e?.status ?? e?.statusCode;
      const body = typeof e?.body === 'string' ? e.body : '';
      const msg = body ? `${e?.message || '更新 ConfigMap 失败'}: ${body}` : (e?.message || '移除钉钉 Webhook target 失败');
      const err = new Error(msg) as Error & { status?: number };
      err.status = typeof status === 'number' ? status : 500;
      throw err;
    }
  }

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
        const name = (item?.metadata?.name ?? item?.name ?? '').toString().trim();
        if (receiverConfigNames.has(name)) return false;
        return true;
      });
      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedSet = new Set(tenant.namespaces);
        list = list.filter((item: any) => {
          const ns = (item?.metadata?.namespace ?? item?.namespace ?? '').toString().trim();
          return allowedSet.has(ns);
        });
      }
      res.json(raw?.data !== undefined ? { ...raw, data: list } : list);
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

  router.get('/:id/monitoring/alertmanagerconfigs/receivers', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespaces = parseQueryArray(req.query?.namespaces);
      let receiverNames = parseQueryArray(req.query?.receiverName);
      if (receiverNames.length === 0) receiverNames = [...DEFAULT_RECEIVER_NAMES];
      const tenant = await requireTenantAccess(req, res, cloudId, { namespaces: namespaces });
      if (!tenant) return;
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const excludeQs =
        'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.annotations';
      let filterQs = '';
      for (const ns of namespaces) {
        filterQs += `&filter=metadata.namespace=${encodeURIComponent(ns)}`;
      }
      if (receiverNames.length === 1) {
        filterQs += `&filter=metadata.name=${encodeURIComponent(receiverNames[0])}`;
      }
      const labelQs = '&labelSelector=monitoring-receiver%3Dtrue';
      const apiPath = `${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&${excludeQs}${filterQs}${labelQs}`;
      const url = `${conn.origin}/${apiPath}`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      let list: any[] = Array.isArray((raw as any)?.data) ? (raw as any).data : [];
      if (receiverNames.length > 1) {
        const nameSet = new Set(receiverNames);
        list = list.filter((item: any) => nameSet.has((item?.metadata?.name ?? item?.name ?? '').toString().trim()));
      }
      const receivers: any[] = [];
      for (const item of list) {
        const namespace = (item?.metadata?.namespace ?? item?.namespace ?? '').toString().trim();
        const receiverName = (item?.metadata?.name ?? item?.name ?? '').toString().trim();
        const specReceivers = Array.isArray(item?.spec?.receivers) ? item.spec.receivers : [];
        receivers.push({ namespace, receiverName, specReceivers });
      }
      res.json({ receivers });
    } catch (e: any) {
      if (isUnreachableError(e)) return res.status(200).json({ receivers: [] });
      const errStatus = Number((e as any)?.status);
      if (errStatus === 404 || errStatus === 502) return res.status(200).json({ receivers: [] });
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '获取通知对象列表失败' });
    }
  });

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
    return res.json(data);
  }

  /** 钉钉：normalize webhookConfigs + 更新 ConfigMap targets，再创建或更新 AlertmanagerConfig */
  async function processDingtalkReceivers(
    conn: { origin: string; token: string; insecure: boolean },
    ns: string,
    name: string,
    body: any,
    res: Response,
    path: string,
    getUrl: string
  ): Promise<Response | void> {
    const normalizeReceiversForDingtalk = (receivers: any[]): any[] => {
      if (!Array.isArray(receivers)) return receivers;
      return receivers.map((r: any) => {
        const webhookConfigs = Array.isArray(r.webhookConfigs) ? r.webhookConfigs : [];
        const normalized = webhookConfigs.map((wc: any) => ({
          url: (r?.url ?? '').toString().trim() || undefined,
          sendResolved: (wc as any)?.sendResolved !== false,
        }));
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
          await updateDingtalkConfigMapTargets(conn, rawReceivers);
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
        await updateDingtalkConfigMapTargets(conn, rawReceivers);
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
      const data = await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, body);
      res.status(201).json(data);
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(500).json({ message: e?.message || '创建告警配置失败' });
    }
  });

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
      const data = await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, req.body);
      res.json(data);
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '更新告警通知策略失败' });
    }
  });

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
