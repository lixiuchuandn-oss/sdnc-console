/**
 * 监控服务代理：概览 + 监控告警（存储、节点、站内实施告警列表、Alertmanager 配置等）
 * 仅使用 cloudId；租户按 UserSpace 解析 namespace 过滤。设计文档：plan/设计-监控服务-概览.md、设计-监控服务-监控告警.md
 */
import { Router, Response } from 'express';
import { In } from 'typeorm';
import yaml from 'js-yaml';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { PrometheusRulesGroup } from '../../../entities/monitoring/PrometheusRulesGroupEntity';
import { EmailReceiver } from '../../../entities/monitoring/EmailReceiver';
import { DingtalkReceiver } from '../../../entities/monitoring/DingtalkReceiver';
import { WebsiteReceiver } from '../../../entities/monitoring/WebsiteReceiver';
import { AlertPolicyReceiver } from '../../../entities/monitoring/AlertPolicyReceiver';
import { AlertPolicy } from '../../../entities/monitoring/AlertPolicy';
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
      query.set('receiver', 'cattle-monitoring-system/default-alertmanager-config/website-receiver');
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

  /** AlertmanagerConfig 名称必须为 email-receiver / dingtalk-receiver / website-receiver 之一（通知对象专用） */
  function isValidReceiverConfigName(name: string): boolean {
    return [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER].includes(String(name || '').trim());
  }

  const ALERTMANAGERCONFIG_BASE = 'v1/harvester/monitoring.coreos.com.alertmanagerconfigs';
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

  const DINGTALK_WEBHOOK_BASE = `http://${DINGTALK_CONFIGMAP_NAME}:8060/dingtalk`;

  /** 从数据库构建 receiver spec（用于策略 YAML 重新生成） */
  function buildReceiverSpecFromDb(
    cloudId: string,
    namespace: string,
    receiverName: string,
    emailRows: EmailReceiver[],
    dingtalkRows: DingtalkReceiver[]
  ): any {
    if (receiverName === WEBSITE_RECEIVER) {
      return { name: WEBSITE_RECEIVER };
    }
    const emailRow = emailRows.find((r) => r.specReceiverName === receiverName);
    if (emailRow) {
      const ec = {
        to: emailRow.emailTo,
        from: emailRow.emailFrom,
        smarthost: emailRow.smarthost || undefined,
        authUsername: emailRow.smtpAuthUsername || undefined,
        authPassword: emailRow.smtpAuthPasswordSecretName
          ? { name: emailRow.smtpAuthPasswordSecretName, key: emailRow.smtpAuthPasswordSecretKey || 'password' }
          : undefined,
        requireTLS: emailRow.smtpRequireTls,
        sendResolved: emailRow.sendResolved,
      };
      return { name: receiverName, emailConfigs: [ec] };
    }
    const dingtalkRow = dingtalkRows.find((r) => r.specReceiverName === receiverName);
    if (dingtalkRow) {
      const robotAccount = dingtalkRow.robotAccount || `${namespace}_${dingtalkRow.specReceiverName}`;
      const webhookUrl = dingtalkRow.url || `${DINGTALK_WEBHOOK_BASE}/${robotAccount}/send`;
      return {
        name: receiverName,
        webhookConfigs: [{
          url: webhookUrl,
          robotUrl: dingtalkRow.robotUrl,
          robotAccount,
          robotAccessToken: dingtalkRow.robotAccessToken,
          sendResolved: dingtalkRow.sendResolved,
        }],
      };
    }
    return null;
  }

  /** 通知对象修改后，重新生成引用该命名空间下 email/dingtalk/website 的告警策略的 AlertmanagerConfig YAML 并同步到 Harvester */
  async function regenerateAffectedPolicies(
    cloudId: string,
    namespace: string,
    receiverType: 'email-receiver' | 'dingtalk-receiver' | 'website-receiver'
  ): Promise<void> {
    const policyRepo = AppDataSource.getRepository(AlertPolicyReceiver);
    const policyReceivers = await policyRepo.find({
      where: { cloudId, namespace, receiverType },
      select: ['policyName'],
    });
    const policyNames = [...new Set(policyReceivers.map((p) => p.policyName))];
    if (policyNames.length === 0) return;

    const conn = await getCloudConnOnly(cloudId);
    if (!conn) return;

    const emailRepo = AppDataSource.getRepository(EmailReceiver);
    const dingtalkRepo = AppDataSource.getRepository(DingtalkReceiver);
    const emailRows = await emailRepo.find({ where: { cloudId, namespace } });
    const dingtalkRows = await dingtalkRepo.find({ where: { cloudId, namespace } });

    const pathBase = ALERTMANAGERCONFIG_BASE;
    for (const policyName of policyNames) {
      try {
        const getPath = `${pathBase}/${encodeURIComponent(namespace)}/${encodeURIComponent(policyName)}`;
        const raw = await getJsonOnce(`${conn.origin}/${getPath}`, conn.token, conn.insecure, true);
        const existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
        if (!existing?.spec?.route) continue;

        const route = existing.spec.route;
        const receiverNames = (collectReceiverNamesFromRoute(route) ?? []).filter((n: string) => n !== 'null-receiver');
        const newReceivers: any[] = [{ name: 'null-receiver' }];
        for (const rn of receiverNames) {
          const spec = buildReceiverSpecFromDb(cloudId, namespace, rn, emailRows, dingtalkRows);
          if (spec) newReceivers.push(spec);
        }
        if (newReceivers.length <= 1) continue;

        const payload = {
          ...existing,
          spec: { ...existing.spec, receivers: newReceivers, route: { ...route, receiver: 'null-receiver' } },
        };
        await requestJson('PUT', `${conn.origin}/${getPath}`, conn.token, conn.insecure, payload);
      } catch (e) {
        console.warn(`[regenerateAffectedPolicies] policy ${namespace}/${policyName} failed:`, e);
      }
    }
  }

  /** 同步告警策略与通知对象关联到本地表（使用 email_receivers.id / dingtalk_receivers.id / website_receivers.id 关联） */
  async function syncAlertPolicyReceivers(
    cloudId: string,
    namespace: string,
    policyName: string,
    body: any
  ): Promise<void> {
    const repo = AppDataSource.getRepository(AlertPolicyReceiver);
    await repo.delete({ cloudId, namespace, policyName });
    const spec = body?.spec ?? body?.data?.spec;
    const route = spec?.route;
    const receivers = Array.isArray(spec?.receivers) ? spec.receivers : [];
    const receiverNames = (collectReceiverNamesFromRoute(route) ?? []).filter((n: string) => n !== 'null-receiver');
    if (receiverNames.length === 0) return;
    const emailRepo = AppDataSource.getRepository(EmailReceiver);
    const dingtalkRepo = AppDataSource.getRepository(DingtalkReceiver);
    const websiteRepo = AppDataSource.getRepository(WebsiteReceiver);
    const entities: AlertPolicyReceiver[] = [];
    for (const receiverName of receiverNames) {
      const receiverType = inferReceiverType(receiverName, receivers);
      const e = new AlertPolicyReceiver();
      e.cloudId = cloudId;
      e.namespace = namespace;
      e.policyName = policyName;
      e.receiverType = receiverType;
      if (receiverType === EMAIL_RECEIVER) {
        const emailRow = await emailRepo.findOne({ where: { cloudId, namespace, specReceiverName: receiverName } });
        if (emailRow) e.emailReceiverId = emailRow.id;
      } else if (receiverType === DINGTALK_RECEIVER) {
        const dingtalkRow = await dingtalkRepo.findOne({ where: { cloudId, namespace, specReceiverName: receiverName } });
        if (dingtalkRow) e.dingtalkReceiverId = dingtalkRow.id;
      } else if (receiverType === WEBSITE_RECEIVER) {
        const websiteRow = await websiteRepo.findOne({ where: { cloudId, namespace, specReceiverName: receiverName } });
        if (websiteRow) e.websiteReceiverId = websiteRow.id;
      }
      entities.push(e);
    }
    await repo.save(entities);
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

  /** 仅在同步到 Harvester 时注入 null-receiver、annotations[cloudhci.io/creator]、labels[cloudhci.io/create-by] */
  function toHarvesterAlertmanagerConfigPayload(body: any, options?: { creator?: string }): any {
    const spec = body?.spec ?? {};
    const route = spec?.route ?? {};
    const receivers = Array.isArray(spec?.receivers) ? spec.receivers : [];
    const hasNullReceiver = receivers.some((r: any) => (r?.name ?? '').toString().trim() === 'null-receiver');
    const nextReceivers = hasNullReceiver ? receivers : [{ name: 'null-receiver' }, ...receivers];
    const nextRoute = { ...route, receiver: 'null-receiver' };
    const meta = body?.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {};
    const annotations = meta?.annotations && typeof meta.annotations === 'object' ? { ...meta.annotations } : {};
    const labels = meta?.labels && typeof meta.labels === 'object' ? { ...meta.labels } : {};
    if (options?.creator != null && options.creator !== '') {
      annotations['cloudhci.io/creator'] = options.creator;
    }
    labels['cloudhci.io/create-by'] = 'platform';
    const metadata = { ...meta, annotations, labels };
    return { ...body, metadata, spec: { ...spec, receivers: nextReceivers, route: nextRoute } };
  }

  const SECRETS_BASE = 'v1/harvester/secrets';
  const CONFIGMAPS_BASE = 'v1/harvester/configmaps';

  const MONITORING_RECEIVER_SECRET_LABEL = 'monitoring-receiver-secret';

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

  /** 告警通知策略：从数据库读取列表；若 DB 为空且可连 Harvester，则从 Harvester 同步到 DB */
  router.get('/:id/monitoring/alertmanagerconfigs', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const tenant = await getTenantAccess(req, cloudId);
      if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });
      const policyRepo = AppDataSource.getRepository(AlertPolicy);
      const where: any = { cloudId };
      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        where.namespace = In(tenant.namespaces);
      }
      let rows = await policyRepo.find({ where, order: { namespace: 'ASC', policyName: 'ASC' } });
      if (rows.length === 0) {
        const conn = await getCloudConnOnly(cloudId);
        if (conn) {
          try {
            const raw = await getJsonOnce(`${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}`, conn.token, conn.insecure, true);
            const harvesterList: any[] = Array.isArray(raw?.data) ? raw.data : [];
            const receiverConfigNames = new Set([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);
            for (const item of harvesterList) {
              const inner = item?.data ?? item;
              const name = (inner?.metadata?.name ?? '').toString().trim();
              if (receiverConfigNames.has(name)) continue;
              const ns = (inner?.metadata?.namespace ?? '').toString().trim();
              if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) continue;
              const meta = inner?.metadata ?? {};
              const spec = inner?.spec ?? {};
              await policyRepo.upsert(
                {
                  cloudId,
                  namespace: ns,
                  policyName: name,
                  description: (meta?.annotations?.description ?? '').toString().trim(),
                  specJson: JSON.stringify(spec),
                  metadataJson: JSON.stringify(meta),
                  resourceVersion: meta?.resourceVersion,
                },
                { conflictPaths: ['cloudId', 'namespace', 'policyName'] }
              );
            }
            rows = await policyRepo.find({ where, order: { namespace: 'ASC', policyName: 'ASC' } });
          } catch {
            /* ignore sync error */
          }
        }
      }
      const alertNameFilter = (req.query?.alertName ?? '').toString().trim();
      if (alertNameFilter) {
        rows = rows.filter((r) => {
          let spec: any = {};
          let meta: any = {};
          try {
            spec = JSON.parse(r.specJson || '{}');
            meta = JSON.parse(r.metadataJson || '{}');
          } catch {
            return false;
          }
          const annotations = meta?.annotations && typeof meta.annotations === 'object' ? meta.annotations : {};
          const names = extractAlertNamesFromSpec(spec, annotations);
          return names.includes(alertNameFilter);
        });
      }
      const list = rows.map((r) => {
        let meta: any = {};
        let spec: any = {};
        try {
          meta = JSON.parse(r.metadataJson || '{}');
          spec = JSON.parse(r.specJson || '{}');
        } catch {
          /* ignore */
        }
        return {
          id: `${r.namespace}/${r.policyName}`,
          metadata: {
            name: r.policyName,
            namespace: r.namespace,
            ...meta,
            creator: r.creator ?? undefined,
            creationTimestamp: r.createdAt ? (r.createdAt as Date).toISOString?.() ?? String(r.createdAt) : undefined,
          },
          spec,
        };
      });
      res.json({ data: list });
    } catch (e: any) {
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

  /** 告警通知对象：从本地数据库读取，不再请求 Harvester */
  router.get('/:id/monitoring/alertmanagerconfigs/receivers', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const namespaces = parseQueryArray(req.query?.namespaces);
      let receiverNames = parseQueryArray(req.query?.receiverName);
      if (receiverNames.length === 0) receiverNames = [...DEFAULT_RECEIVER_NAMES];
      const tenant = await requireTenantAccess(req, res, cloudId, { namespaces });
      if (!tenant) return;
      const receivers: any[] = [];
      const nsFilter = namespaces.length > 0 ? namespaces : null;

      if (receiverNames.includes(EMAIL_RECEIVER)) {
        const emailRepo = AppDataSource.getRepository(EmailReceiver);
        const emailWhere: any = { cloudId };
        if (nsFilter?.length) emailWhere.namespace = In(nsFilter);
        const emailRows = await emailRepo.find({ where: emailWhere });
        const byNs: Record<string, any[]> = {};
        for (const r of emailRows) {
          if (nsFilter?.length && !nsFilter.includes(r.namespace)) continue;
          if (!byNs[r.namespace]) byNs[r.namespace] = [];
          const ec = {
            to: r.emailTo,
            from: r.emailFrom,
            smarthost: r.smarthost,
            authUsername: r.smtpAuthUsername,
            authPassword: r.smtpAuthPasswordSecretName
              ? { name: r.smtpAuthPasswordSecretName, key: r.smtpAuthPasswordSecretKey || 'password' }
              : undefined,
            requireTLS: r.smtpRequireTls,
            sendResolved: r.sendResolved,
          };
          byNs[r.namespace].push({
            id: r.id,
            name: r.specReceiverName,
            emailConfigs: [ec],
            creator: r.creator ?? undefined,
            createdAt: r.createdAt ? (r.createdAt as Date).toISOString?.() ?? String(r.createdAt) : undefined,
          });
        }
        for (const [ns, specReceivers] of Object.entries(byNs)) {
          receivers.push({ namespace: ns, receiverName: EMAIL_RECEIVER, specReceivers });
        }
      }

      if (receiverNames.includes(DINGTALK_RECEIVER)) {
        const dingtalkRepo = AppDataSource.getRepository(DingtalkReceiver);
        const dingtalkWhere: any = { cloudId };
        if (nsFilter?.length) dingtalkWhere.namespace = In(nsFilter);
        const dingtalkRows = await dingtalkRepo.find({ where: dingtalkWhere });
        const byNs: Record<string, any[]> = {};
        for (const r of dingtalkRows) {
          if (nsFilter?.length && !nsFilter.includes(r.namespace)) continue;
          if (!byNs[r.namespace]) byNs[r.namespace] = [];
          const robotAccount = r.robotAccount || `${r.namespace}_${r.specReceiverName}`;
          byNs[r.namespace].push({
            id: r.id,
            name: r.specReceiverName,
            webhookConfigs: [{
              url: r.url,
              robotUrl: r.robotUrl,
              robotAccount,
              robotAccessToken: r.robotAccessToken,
              sendResolved: r.sendResolved,
            }],
            creator: r.creator ?? undefined,
            createdAt: r.createdAt ? (r.createdAt as Date).toISOString?.() ?? String(r.createdAt) : undefined,
          });
        }
        for (const [ns, specReceivers] of Object.entries(byNs)) {
          receivers.push({ namespace: ns, receiverName: DINGTALK_RECEIVER, specReceivers });
        }
      }

      if (receiverNames.includes(WEBSITE_RECEIVER)) {
        const websiteRepo = AppDataSource.getRepository(WebsiteReceiver);
        const websiteWhere: any = { cloudId };
        if (nsFilter?.length) websiteWhere.namespace = In(nsFilter);
        const websiteRows = await websiteRepo.find({ where: websiteWhere });
        const byNs: Record<string, any[]> = {};
        for (const r of websiteRows) {
          if (nsFilter?.length && !nsFilter.includes(r.namespace)) continue;
          if (!byNs[r.namespace]) byNs[r.namespace] = [];
          byNs[r.namespace].push({
            id: r.id,
            name: r.specReceiverName,
            creator: r.creator ?? undefined,
            createdAt: r.createdAt ? (r.createdAt as Date).toISOString?.() ?? String(r.createdAt) : undefined,
          });
        }
        for (const [ns, specReceivers] of Object.entries(byNs)) {
          if (specReceivers.length > 0) receivers.push({ namespace: ns, receiverName: WEBSITE_RECEIVER, specReceivers });
        }
      }

      res.json({ receivers });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '获取通知对象列表失败' });
    }
  });

  // GET /:id/monitoring/alertmanagerconfigs/receivers/check — 通过数据库验证通知对象名称是否已存在（不调用 Harvester）
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
      let exists = false;
      if (receiverType === EMAIL_RECEIVER) {
        const emailRepo = AppDataSource.getRepository(EmailReceiver);
        const found = await emailRepo.findOne({ where: { cloudId, namespace, specReceiverName } });
        exists = !!found;
      } else if (receiverType === DINGTALK_RECEIVER) {
        const dingtalkRepo = AppDataSource.getRepository(DingtalkReceiver);
        const found = await dingtalkRepo.findOne({ where: { cloudId, namespace, specReceiverName } });
        exists = !!found;
      }
      res.json({ exists });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '校验失败' });
    }
  });

  // GET /:id/monitoring/alertmanagerconfigs/policy-receivers — 查询 policy 与 receiver 关联（支持 emailReceiverId/dingtalkReceiverId/websiteReceiverId 按 ID 查询）
  router.get('/:id/monitoring/alertmanagerconfigs/policy-receivers', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const policyName = req.query?.policyName as string | undefined;
      const receiverType = req.query?.receiverType as string | undefined;
      const namespace = req.query?.namespace as string | undefined;
      const emailReceiverId = req.query?.emailReceiverId as string | undefined;
      const dingtalkReceiverId = req.query?.dingtalkReceiverId as string | undefined;
      const websiteReceiverId = req.query?.websiteReceiverId as string | undefined;
      const tenant = await requireTenantAccess(req, res, cloudId);
      if (!tenant) return;
      const repo = AppDataSource.getRepository(AlertPolicyReceiver);
      const where: any = { cloudId };
      if (namespace && String(namespace).trim()) where.namespace = String(namespace).trim();
      if (policyName && String(policyName).trim()) where.policyName = String(policyName).trim();
      if (receiverType && String(receiverType).trim()) where.receiverType = String(receiverType).trim();
      if (emailReceiverId && String(emailReceiverId).trim()) where.emailReceiverId = String(emailReceiverId).trim();
      if (dingtalkReceiverId && String(dingtalkReceiverId).trim()) where.dingtalkReceiverId = String(dingtalkReceiverId).trim();
      if (websiteReceiverId && String(websiteReceiverId).trim()) where.websiteReceiverId = String(websiteReceiverId).trim();
      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedNs = new Set(tenant.namespaces);
        if (namespace && String(namespace).trim()) {
          if (!allowedNs.has(String(namespace).trim())) return res.json({ data: [] });
          where.namespace = String(namespace).trim();
        } else {
          where.namespace = In(tenant.namespaces);
        }
      }
      const list = await repo.find({ where, order: { namespace: 'ASC', policyName: 'ASC' } });
      res.json({ data: list });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '查询失败' });
    }
  });

  /** 告警通知策略：从数据库读取详情；若 DB 无则尝试从 Harvester 拉取并写入 DB */
  router.get('/:id/monitoring/alertmanagerconfigs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const { namespace, name } = req.params;
      const tenant = await requireTenantAccess(req, res, cloudId, { namespaces: [namespace] });
      if (!tenant) return;
      const policyRepo = AppDataSource.getRepository(AlertPolicy);
      let row = await policyRepo.findOne({ where: { cloudId, namespace, policyName: name } });
      if (!row) {
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;
        const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
        try {
          const raw = await getJsonOnce(`${conn.origin}/${path}`, conn.token, conn.insecure, true);
          const inner = (raw as any)?.data ?? raw;
          if (inner?.metadata) {
            const meta = inner.metadata ?? {};
            const spec = inner.spec ?? {};
            await policyRepo.upsert(
              {
                cloudId,
                namespace,
                policyName: name,
                description: (meta?.annotations?.description ?? '').toString().trim(),
                specJson: JSON.stringify(spec),
                metadataJson: JSON.stringify(meta),
                resourceVersion: meta?.resourceVersion,
              },
              { conflictPaths: ['cloudId', 'namespace', 'policyName'] }
            );
            row = await policyRepo.findOne({ where: { cloudId, namespace, policyName: name } });
          }
        } catch {
          /* ignore */
        }
        if (!row) {
          return res.status(404).json({ message: '告警通知策略不存在' });
        }
      }
      let meta: any = {};
      let spec: any = {};
      try {
        meta = JSON.parse(row.metadataJson || '{}');
        spec = JSON.parse(row.specJson || '{}');
      } catch {
        /* ignore */
      }
      const annotations = meta?.annotations && typeof meta.annotations === 'object' ? { ...meta.annotations } : {};
      if (annotations.description == null || annotations.description === '') {
        annotations.description = (row.description ?? '').toString().trim();
      }
      const creationTimestamp = row.createdAt ? (row.createdAt as Date).toISOString?.() ?? String(row.createdAt) : undefined;
      const data = {
        apiVersion: 'monitoring.coreos.com/v1alpha1',
        kind: 'AlertmanagerConfig',
        metadata: {
          name: row.policyName,
          namespace: row.namespace,
          resourceVersion: row.resourceVersion,
          creator: row.creator ?? undefined,
          creationTimestamp,
          ...meta,
          annotations,
        },
        spec,
      };
      res.json({ data });
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '请求配置详情失败' });
    }
  });

  /** 删除通知对象：从本地数据库删除，不再请求 Harvester */
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
      if (!isValidReceiverConfigName(name)) {
        return res.status(400).json({ message: '通知方式必须是邮件、钉钉或站内信之一' });
      }
      if (name === WEBSITE_RECEIVER) {
        const websiteRepo = AppDataSource.getRepository(WebsiteReceiver);
        const policyReceiverRepo = AppDataSource.getRepository(AlertPolicyReceiver);
        const specReceiverName = (req.query.specReceiverName ?? '').toString().trim() || WEBSITE_RECEIVER;
        const row = await websiteRepo.findOne({ where: { cloudId, namespace, specReceiverName } });
        if (!row) {
          return res.status(404).json({ message: '未找到该通知对象名称' });
        }
        const associations = await policyReceiverRepo.find({ where: { websiteReceiverId: row.id }, select: ['policyName'] });
        if (associations.length > 0) {
          const policyNames = [...new Set(associations.map((a) => a.policyName))].join('、');
          return res.status(400).json({
            message: `该通知对象已被以下告警通知策略引用，请先解除关联后再关闭：${policyNames}`,
          });
        }
        await websiteRepo.delete({ id: row.id });
        res.status(204).send();
        return;
      }
      if (name === EMAIL_RECEIVER) {
        const emailRepo = AppDataSource.getRepository(EmailReceiver);
        const result = await emailRepo.delete({ cloudId, namespace, specReceiverName });
        if (result.affected === 0) {
          return res.status(404).json({ message: '未找到该通知对象名称' });
        }
      } else if (name === DINGTALK_RECEIVER) {
        const dingtalkRepo = AppDataSource.getRepository(DingtalkReceiver);
        const row = await dingtalkRepo.findOne({ where: { cloudId, namespace, specReceiverName } });
        if (!row) {
          return res.status(404).json({ message: '未找到该通知对象名称' });
        }
        const robotAccount = (row.robotAccount || `${namespace}_${row.specReceiverName}`).trim();
        const conn = await getCloudConnOnly(cloudId);
        if (!conn) {
          return res.status(503).json({ message: '无法连接到 Harvester，已阻止删除以避免与 dingtalkWebhookConfig 不一致' });
        }
        // 强一致：先删 dingtalkWebhookConfig.targets 中对应 robotAccount，成功后再删 DB
        await syncDingtalkWebhookConfig(conn, [robotAccount], []);
        await dingtalkRepo.delete({ cloudId, namespace, specReceiverName });
      }
      res.status(204).send();
    } catch (e: any) {
      if (Number((e as any)?.status) === 404) {
        return res.status(404).json({ message: e?.message || '未找到该通知对象名称' });
      }
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '删除通知对象失败' });
    }
  });

  /** 新增/更新通知对象：保存到本地数据库，不再写入 Harvester */
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
      const body = req.body || {};
      const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : [];

      const specNames = rawReceivers.map((r: any) => (r?.name ?? '').toString().trim()).filter(Boolean);
      const uniqueNames = new Set(specNames);
      if (specNames.length !== uniqueNames.size) {
        return res.status(400).json({ message: '存在重复的通知对象名称，请使用不同名称' });
      }

      if (name === EMAIL_RECEIVER) {
        const emailRepo = AppDataSource.getRepository(EmailReceiver);
        await emailRepo.delete({ cloudId, namespace: ns });
        const creator = getCreatorFromReq(req);
        for (const r of rawReceivers) {
          const specName = (r?.name ?? '').toString().trim();
          if (!specName) continue;
          const ec = Array.isArray(r?.emailConfigs) ? r.emailConfigs[0] : undefined;
          const row = emailRepo.create({
            cloudId,
            namespace: ns,
            specReceiverName: specName,
            emailTo: (ec?.to ?? '').toString().trim(),
            emailFrom: (ec?.from ?? '').toString().trim(),
            smarthost: (ec?.smarthost ?? '').toString().trim() || undefined,
            smtpAuthUsername: (ec?.authUsername ?? '').toString().trim() || undefined,
            smtpAuthPasswordSecretName: (ec?.authPassword as any)?.name,
            smtpAuthPasswordSecretKey: (ec?.authPassword as any)?.key,
            smtpRequireTls: (ec?.requireTLS ?? true) !== false,
            sendResolved: (ec?.sendResolved ?? true) !== false,
          });
          await emailRepo.save(row);
        }
        try {
          await regenerateAffectedPolicies(cloudId, ns, EMAIL_RECEIVER);
        } catch (regenErr) {
          console.warn('[alertmanagerconfigs/receivers] regenerate affected policies failed:', regenErr);
        }
        return res.status(201).json({ message: '创建成功' });
      }

      if (name === DINGTALK_RECEIVER) {
        const dingtalkRepo = AppDataSource.getRepository(DingtalkReceiver);
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;

        const oldRows = await dingtalkRepo.find({ where: { cloudId, namespace: ns } });
        const oldRobotAccounts = oldRows.map((r) => (r.robotAccount || `${ns}_${r.specReceiverName}`).trim()).filter(Boolean);

        const newTargets: Array<{ robotAccount: string; robotUrl?: string; robotAccessToken?: string }> = [];
        const rowsToSave: Partial<DingtalkReceiver>[] = [];
        for (const r of rawReceivers) {
          const specName = (r?.name ?? '').toString().trim();
          if (!specName) continue;
          const wc = Array.isArray(r?.webhookConfigs) ? r.webhookConfigs[0] : undefined;
          const robotAccount = (wc?.robotAccount ?? `${ns}_${specName}`).toString().trim();
          const urlVal = (wc?.url ?? '').toString().trim();
          if (!urlVal) {
            return res.status(400).json({ message: `钉钉通知对象「${specName}」的 webhook 地址(url)不能为空` });
          }
          const robotUrl = (wc?.robotUrl ?? '').toString().trim() || undefined;
          const robotAccessToken = (wc?.robotAccessToken ?? '').toString().trim() || undefined;
          newTargets.push({ robotAccount: robotAccount || `${ns}_${specName}`, robotUrl, robotAccessToken });
          rowsToSave.push({
            cloudId,
            namespace: ns,
            specReceiverName: specName,
            url: urlVal,
            robotUrl,
            robotAccount: robotAccount || undefined,
            robotAccessToken,
            sendResolved: (wc?.sendResolved ?? true) !== false,
            creator: getCreatorFromReq(req) || undefined,
          });
        }

        try {
          await syncDingtalkWebhookConfig(conn, oldRobotAccounts, newTargets);
        } catch (syncErr: any) {
          console.error('[alertmanagerconfigs/receivers] sync dingtalkWebhookConfig failed:', syncErr);
          return res.status(500).json({ message: syncErr?.message || '同步钉钉 Webhook 配置失败' });
        }

        await dingtalkRepo.delete({ cloudId, namespace: ns });
        for (const row of rowsToSave) {
          const entity = dingtalkRepo.create(row as DingtalkReceiver);
          await dingtalkRepo.save(entity);
        }
        try {
          await regenerateAffectedPolicies(cloudId, ns, DINGTALK_RECEIVER);
        } catch (regenErr) {
          console.warn('[alertmanagerconfigs/receivers] regenerate affected policies failed:', regenErr);
        }
        return res.status(201).json({ message: '创建成功' });
      }

      if (name === WEBSITE_RECEIVER) {
        const websiteRepo = AppDataSource.getRepository(WebsiteReceiver);
        const creator = getCreatorFromReq(req);
        const specName = (rawReceivers[0]?.name ?? WEBSITE_RECEIVER).toString().trim() || WEBSITE_RECEIVER;
        await websiteRepo.upsert(
          {
            cloudId,
            namespace: ns,
            specReceiverName: specName,
            creator: creator || undefined,
          },
          { conflictPaths: ['cloudId', 'namespace'] }
        );
        return res.status(201).json({ message: '创建成功' });
      }
      return res.status(400).json({ message: '不支持的通知方式' });
    } catch (e: any) {
      const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
      const msg = e?.message || '创建或更新告警通知对象失败';
      if (status >= 500) console.error('[alertmanagerconfigs/receivers]', e);
      res.status(status).json({ message: msg });
    }
  });

  /** 告警通知策略：新增时先存 DB，再全量同步到 Harvester */
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
      const meta = body?.metadata ?? {};
      const annotations = meta?.annotations && typeof meta.annotations === 'object' ? { ...meta.annotations } : {};
      if (!('description' in annotations)) annotations.description = '';
      const payload = { ...body, metadata: { ...meta, annotations } };

      const policyRepo = AppDataSource.getRepository(AlertPolicy);
      const desc = (payload?.metadata?.annotations?.description ?? '').toString().trim();
      const creator = getCreatorFromReq(req);
      const existingPolicy = await policyRepo.findOne({ where: { cloudId, namespace: ns, policyName: name } });
      if (!existingPolicy) {
        await policyRepo.insert({
          cloudId,
          namespace: ns,
          policyName: name,
          description: desc,
          specJson: JSON.stringify(payload?.spec ?? {}),
          metadataJson: JSON.stringify(payload?.metadata ?? {}),
          creator: creator || undefined,
        });
      } else {
        await policyRepo.update(
          { cloudId, namespace: ns, policyName: name },
          { description: desc, specJson: JSON.stringify(payload?.spec ?? {}), metadataJson: JSON.stringify(payload?.metadata ?? {}) }
        );
      }

      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      try {
        const harvesterPayload = toHarvesterAlertmanagerConfigPayload(payload, { creator: creator || undefined });
        const data = await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, harvesterPayload);
        try {
          await syncAlertPolicyReceivers(cloudId, ns, name, payload);
        } catch (syncErr) {
          console.warn('[alertmanagerconfigs] sync policy-receivers failed:', syncErr);
        }
        const created = (data as any)?.data ?? data;
        await policyRepo.update(
          { cloudId, namespace: ns, policyName: name },
          { resourceVersion: created?.metadata?.resourceVersion }
        );
        return res.status(201).json(data);
      } catch (harvesterErr: any) {
        await policyRepo.delete({ cloudId, namespace: ns, policyName: name });
        throw harvesterErr;
      }
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '创建告警配置失败' });
    }
  });

  /** 告警通知策略：修改时先更新 DB，再全量同步到 Harvester */
  router.put('/:id/monitoring/alertmanagerconfigs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const { namespace, name } = req.params;
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权修改该命名空间下的告警通知策略',
      });
      if (!tenant) return;
      const policyRepo = AppDataSource.getRepository(AlertPolicy);
      const oldRow = await policyRepo.findOne({ where: { cloudId, namespace, policyName: name } });
      if (!oldRow) {
        return res.status(404).json({ message: '告警通知策略不存在' });
      }
      const meta = req.body?.metadata ?? {};
      const annotations = meta?.annotations && typeof meta.annotations === 'object' ? { ...meta.annotations } : {};
      if (!('description' in annotations)) annotations.description = '';
      const payload = { ...req.body, metadata: { ...meta, annotations } };
      const desc = (payload?.metadata?.annotations?.description ?? '').toString().trim();

      await policyRepo.update(
        { cloudId, namespace, policyName: name },
        {
          description: desc,
          specJson: JSON.stringify(payload?.spec ?? {}),
          metadataJson: JSON.stringify(payload?.metadata ?? {}),
        }
      );

      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      let resourceVersion = oldRow.resourceVersion;
      if (!resourceVersion) {
        try {
          const raw = await getJsonOnce(`${conn.origin}/${path}`, conn.token, conn.insecure, true);
          const existing = (raw as any)?.data ?? raw;
          resourceVersion = existing?.metadata?.resourceVersion;
        } catch {
          /* Harvester 可能不存在，用 POST 创建 */
        }
      }
      try {
        const creatorForSync = oldRow.creator ?? undefined;
        const payloadWithVersion = { ...payload, metadata: { ...payload.metadata, resourceVersion } };
        const payloadForPut = toHarvesterAlertmanagerConfigPayload(payloadWithVersion, { creator: creatorForSync });
        const payloadForPost = toHarvesterAlertmanagerConfigPayload(payload, { creator: creatorForSync });
        const data = resourceVersion
          ? await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, payloadForPut)
          : await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, payloadForPost);
        try {
          await syncAlertPolicyReceivers(cloudId, namespace, name, payload);
        } catch (syncErr) {
          console.warn('[alertmanagerconfigs] sync policy-receivers failed:', syncErr);
        }
        const updated = (data as any)?.data ?? data;
        await policyRepo.update(
          { cloudId, namespace, policyName: name },
          { resourceVersion: updated?.metadata?.resourceVersion }
        );
        return res.json(data);
      } catch (harvesterErr: any) {
        await policyRepo.update(
          { cloudId, namespace, policyName: name },
          {
            description: oldRow.description,
            specJson: oldRow.specJson,
            metadataJson: oldRow.metadataJson,
          }
        );
        throw harvesterErr;
      }
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '更新告警通知策略失败' });
    }
  });

  /** 告警通知策略：删除时先删除 Harvester AlertmanagerConfig，再删除 DB */
  router.delete('/:id/monitoring/alertmanagerconfigs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const cloudId = req.params.id;
      const { namespace, name } = req.params;
      const tenant = await requireTenantAccess(req, res, cloudId, {
        namespaces: [namespace],
        forbiddenMessage: '无权删除该命名空间下的告警通知策略',
      });
      if (!tenant) return;
      const policyRepo = AppDataSource.getRepository(AlertPolicy);
      const row = await policyRepo.findOne({ where: { cloudId, namespace, policyName: name } });
      if (!row) {
        return res.status(404).json({ message: '告警通知策略不存在' });
      }
      const conn = await getCloudAndConn(cloudId, res);
      if (!conn) return;
      const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
      try {
        await requestJson('DELETE', `${conn.origin}/${path}`, conn.token, conn.insecure);
      } catch (delErr: any) {
        if (Number((delErr as any)?.status) !== 404) throw delErr;
      }
      await AppDataSource.getRepository(AlertPolicyReceiver).delete({ cloudId, namespace, policyName: name });
      await policyRepo.delete({ cloudId, namespace, policyName: name });
      res.status(204).send();
    } catch (e: any) {
      const status = (e as any).status || 500;
      res.status(status).json({ message: e?.message || '删除告警通知策略失败' });
    }
  });
}
