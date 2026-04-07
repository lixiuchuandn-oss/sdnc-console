/**
 * ⚠️ 已迁移到新架构
 * 
 * 本文件的所有路由已迁移到：
 * - handlers/logging.handlers.ts - 业务逻辑 handlers
 * - harvester.service.routes.provider.ts - 路由注册（使用 provider-router 中间件）
 * 
 * 新的路由已在 clouds.ts 中通过 registerHarvesterServiceRoutesProvider 注册。
 * 
 * 保留此文件仅用于向后兼容，实际路由已不再使用。
 * 待确认所有功能正常后，可删除此文件。
 */

import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { UserSpace } from '../../../entities/UserSpace';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { checkTenantAccess, isNamespaceAllowed } from './harvester.direct.helpers';

/** 获取 API 基地址，保留 /k8s/clusters/xxx 路径，仅去除 /v1/harvester 等版本后缀 */
function getEndpointBase(endpoint: string): string {
  let base = String(endpoint || '').replace(/\/+$/, '');
  if (!base.includes('/k8s/clusters/')) {
    base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }
  return base || '';
}

async function getCloudAndConn(
  id: string,
  res: Response,
): Promise<{
  cloud: Cloud;
  origin: string;
  token: string;
  insecure: boolean;
} | null> {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String((cloud as any)?.config?.provider || '').toLowerCase();

  const isHarvesterLike = [
    'harvester',
    'cloudmap',
    'cloudmap.private',
    'cloudmap.edge',
  ].includes(provider);
  if (!isHarvesterLike) {
    res
      .status(400)
      .json({ message: '仅支持 Harvester/Cloudmap 资源池的日志配置' });
    return null;
  }
  const origin = getEndpointBase(cloud.endpoint || '');
  const token =
    cloud.secretKey ||
    (cloud as any).config?.token ||
    (cloud as any).config?.apiToken ||
    '';
  const insecure = !!(
    (cloud as any).config?.ignoreTls ??
    (cloud as any).config?.insecure
  );
  if (!token) {
    res.status(400).json({ message: '资源池未配置访问凭证' });
    return null;
  }
  return { cloud, origin, token, insecure };
}

async function getTenantAccess(
  req: any,
  cloudId: string,
): Promise<{ allowed: boolean; namespaces: string[]; isAdmin: boolean }> {
  const isTenantUser =
    (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
  const isTenantRole = req.user?.role === 'tenant';
  const isTenant = !!(isTenantUser || isTenantRole);
  if (!isTenant) return { allowed: true, namespaces: [], isAdmin: true };

  const userSpaceRepo = AppDataSource.getRepository(UserSpace);
  const userOrgId = (req.user as any)?.organizationId;
  const whereClause: any[] = [];
  if (userOrgId) {
    whereClause.push({
      tenantId: (req.user as any).tenantId,
      cloudId,
      status: 'active',
      organizationId: userOrgId,
    });
  } else {
    whereClause.push({
      tenantId: (req.user as any).tenantId,
      cloudId,
      status: 'active',
      organizationId: null,
    });
  }
  const matches = await userSpaceRepo.find({
    where: whereClause,
    select: ['namespace'],
  });
  const uniqueNamespaces = new Set<string>();
  matches.forEach((m) => {
    if (m.namespace) {
      m.namespace.split(',').forEach((ns) => {
        const trimmed = ns.trim();
        if (trimmed) uniqueNamespaces.add(trimmed);
      });
    }
  });
  if (uniqueNamespaces.size === 0)
    return { allowed: false, namespaces: [], isAdmin: false };
  return {
    allowed: true,
    namespaces: Array.from(uniqueNamespaces),
    isAdmin: false,
  };
}

const CATTLE_LOGGING_SYSTEM_NS = 'cattle-logging-system';
const LOG_PAGESIZE = 'pagesize=100000';
const LOG_EXCLUDE = 'exclude=metadata.managedFields';
const HARVESTER_CLUSTERFLOW_BASE = 'v1/harvester/logging.banzaicloud.io.clusterflows';
const HARVESTER_CLUSTEROUTPUT_BASE = 'v1/harvester/logging.banzaicloud.io.clusteroutputs';
const HARVESTER_FLOW_BASE = 'v1/harvester/logging.banzaicloud.io.flows';
const HARVESTER_OUTPUT_BASE = 'v1/harvester/logging.banzaicloud.io.outputs';

/**
 * ⚠️ 已废弃：路由已迁移到 harvester.service.routes.provider.ts
 * 保留此函数仅用于向后兼容，实际不会被调用
 */
/**
 * ⚠️ 已废弃：路由已迁移到 harvester.service.routes.provider.ts
 * 保留此函数仅用于向后兼容，实际不会被调用
 */
export function registerLoggingRoutes(
  router: Router,
  _checkAdminPermission: any,
) {
  // 所有路由已迁移到 harvester.service.routes.provider.ts
  // 此函数不再注册任何路由，保留仅为向后兼容
  return;
  
  /* eslint-disable */
  // 以下代码已迁移，不再执行
  router.get(
    '/:id/logging/clusterflows',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed)
          return res.status(403).json({ message: '无权访问' });

        const url = `${conn.origin}/${HARVESTER_CLUSTERFLOW_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        res.status(500).json({ message: e?.message || '请求失败' });
      }
    },
  );

  router.get(
    '/:id/logging/clusterflows/:name',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed)
          return res.status(403).json({ message: '无权访问' });

        const url = `${conn.origin}/${HARVESTER_CLUSTERFLOW_BASE}/${encodeURIComponent(
          CATTLE_LOGGING_SYSTEM_NS,
        )}/${encodeURIComponent(req.params.name)}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        res.status(500).json({ message: e?.message || '请求失败' });
      }
    },
  );

  router.post(
    '/:id/logging/clusterflows',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed || !tenant.isAdmin)
          return res
            .status(403)
            .json({ message: '仅管理员可操作集群日志' });

        const body = req.body || {};
        body.metadata = body.metadata || {};
        body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;

        const url = `${conn.origin}/${HARVESTER_CLUSTERFLOW_BASE}`;
        const data = await requestJson(
          'POST',
          url,
          conn.token,
          conn.insecure,
          body,
        );
        res.status(201).json(data);
      } catch (e: any) {
        res.status(500).json({ message: e?.message || '创建失败' });
      }
    },
  );

  router.put(
    '/:id/logging/clusterflows/:name',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed || !tenant.isAdmin)
          return res
            .status(403)
            .json({ message: '仅管理员可操作集群日志' });

        const url = `${conn.origin}/${HARVESTER_CLUSTERFLOW_BASE}/${encodeURIComponent(
          CATTLE_LOGGING_SYSTEM_NS,
        )}/${encodeURIComponent(req.params.name)}`;
        const body = req.body || {};
        body.metadata = body.metadata || {};
        body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;
        const data = await requestJson(
          'PUT',
          url,
          conn.token,
          conn.insecure,
          body,
        );
        res.json(data);
      } catch (e: any) {
        res.status(500).json({ message: e?.message || '更新失败' });
      }
    },
  );

  router.delete(
    '/:id/logging/clusterflows/:name',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed || !tenant.isAdmin)
          return res
            .status(403)
            .json({ message: '仅管理员可操作集群日志' });

        const url = `${conn.origin}/${HARVESTER_CLUSTERFLOW_BASE}/${encodeURIComponent(
          CATTLE_LOGGING_SYSTEM_NS,
        )}/${encodeURIComponent(req.params.name)}`;
        await requestJson(
          'DELETE',
          url,
          conn.token,
          conn.insecure,
        );
        res.status(204).send();
      } catch (e: any) {
        if (e?.status) {
          return res.status(e.status).json({
            message: e?.message || '删除失败',
            details: e?.body,
          });
        }
        res.status(500).json({ message: e?.message || '删除失败' });
      }
    },
  );

  router.get(
    '/:id/logging/clusteroutputs',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed)
          return res.status(403).json({ message: '无权访问' });

        const url = `${conn.origin}/${HARVESTER_CLUSTEROUTPUT_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
        const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
        const DESCRIPTION_ANNOTATION = 'cloudhci.io/description';
        const items = Array.isArray((raw as any)?.data) ? (raw as any).data : Array.isArray((raw as any)?.items) ? (raw as any).items : [];
        const mapped = items.map((item: any) => {
          const meta = item?.metadata ?? {};
          const annotations = meta.annotations ?? {};
          const description = annotations[DESCRIPTION_ANNOTATION] ?? annotations.description ?? '';
          return { ...item, description };
        });
        const data = Array.isArray((raw as any)?.data)
          ? { ...(raw as any), data: mapped }
          : Array.isArray((raw as any)?.items)
            ? { ...(raw as any), items: mapped }
            : raw;
        res.json(data);
      } catch (e: any) {
        res.status(500).json({ message: e?.message || '请求失败' });
      }
    },
  );

  router.post(
    '/:id/logging/clusteroutputs',
    async (req: any, res: Response) => {
      let targetUrl = '';
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed || !tenant.isAdmin)
          return res
            .status(403)
            .json({ message: '仅管理员可操作集群日志' });

        const body = req.body || {};
        body.metadata = body.metadata || {};
        body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;

        const url = `${conn.origin}/${HARVESTER_CLUSTEROUTPUT_BASE}`;
        targetUrl = url;
        const data = await requestJson(
          'POST',
          url,
          conn.token,
          conn.insecure,
          body,
        );
        res.status(201).json(data);
      } catch (e: any) {
        if (e?.status) {
          console.error('[Harvester][clusteroutputs][POST] request failed', {
            url: targetUrl,
            status: e.status,
            body: e.body,
          });
          return res.status(e.status).json({
            message: e?.message || '创建失败',
            details: { url: targetUrl, body: e?.body },
          });
        }
        res.status(500).json({ message: e?.message || '创建失败' });
      }
    },
  );

  router.put(
    '/:id/logging/clusteroutputs/:name',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed || !tenant.isAdmin)
          return res
            .status(403)
            .json({ message: '仅管理员可操作集群日志' });

        const body = req.body || {};
        body.metadata = body.metadata || {};
        body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;
        body.metadata.name = req.params.name;

        const url = `${conn.origin}/${HARVESTER_CLUSTEROUTPUT_BASE}/${encodeURIComponent(
          CATTLE_LOGGING_SYSTEM_NS,
        )}/${encodeURIComponent(req.params.name)}`;
        const data = await requestJson(
          'PUT',
          url,
          conn.token,
          conn.insecure,
          body,
        );
        res.json(data);
      } catch (e: any) {
        if (e?.status) {
          return res.status(e.status).json({
            message: e?.message || '更新失败',
            details: e?.body,
          });
        }
        res.status(500).json({ message: e?.message || '更新失败' });
      }
    },
  );

  router.delete(
    '/:id/logging/clusteroutputs/:name',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed || !tenant.isAdmin)
          return res
            .status(403)
            .json({ message: '仅管理员可操作集群日志' });

        const url = `${conn.origin}/${HARVESTER_CLUSTEROUTPUT_BASE}/${encodeURIComponent(
          CATTLE_LOGGING_SYSTEM_NS,
        )}/${encodeURIComponent(req.params.name)}`;
        await requestJson(
          'DELETE',
          url,
          conn.token,
          conn.insecure,
        );
        res.status(204).send();
      } catch (e: any) {
        if (e?.status) {
          return res.status(e.status).json({
            message: e?.message || '删除失败',
            details: e?.body,
          });
        }
        res.status(500).json({ message: e?.message || '删除失败' });
      }
    },
  );

  // 预置日志采集端模板（YAML，供前端「日志采集端」页直接展示）
  const PRESET_LOGGING_TEMPLATE_YAML = `# 预置日志采集端模板 (Preset Logging Template)
# 基于 Banzai Cloud Logging Operator：ClusterFlow 定义采集策略，ClusterOutput 定义输出目标
---
apiVersion: logging.banzaicloud.io/v1beta1
kind: ClusterFlow
metadata:
  name: default-flow
  namespace: cattle-logging-system
spec:
  match:
    - select:
        labels: {}
  globalOutputRefs:
    - default-output
---
apiVersion: logging.banzaicloud.io/v1beta1
kind: ClusterOutput
metadata:
  name: default-output
  namespace: cattle-logging-system
spec:
  nullout: {}
`;

  router.get(
    '/:id/logging/templates',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed) {
          return res.status(403).json({ message: '无权访问' });
        }
        res.json({ yaml: PRESET_LOGGING_TEMPLATE_YAML });
      } catch (e: any) {
        res.status(500).json({ message: e?.message || '请求失败' });
      }
    },
  );

  router.get(
    '/:id/logging/clusteroutputs/:name',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed)
          return res.status(403).json({ message: '无权访问' });

        // Harvester 详情/更新/删除 需带 namespace：.../clusteroutputs/{namespace}/{name}
        const url = `${conn.origin}/${HARVESTER_CLUSTEROUTPUT_BASE}/${encodeURIComponent(
          CATTLE_LOGGING_SYSTEM_NS,
        )}/${encodeURIComponent(req.params.name)}?${LOG_EXCLUDE}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        res.status(500).json({ message: e?.message || '请求失败' });
      }
    },
  );

  // --- Flows (Namespace Scoped) ---
  router.get('/:id/logging/flows', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

      // namespace 优先按查询参数转发到 Harvester；未指定时再按租户的第一个命名空间决定是否加前缀
      const nsQuery = (req.query?.namespace ?? '').toString().trim();

      let harvesterNs: string | undefined;
      if (nsQuery) {
        // 显式 namespace：非管理员需校验是否有权访问该命名空间
        if (!tenant.isAdmin && Array.isArray(tenant.namespaces) && tenant.namespaces.length > 0) {
          if (!tenant.namespaces.includes(nsQuery)) {
            return res.status(403).json({ message: '无权访问该命名空间' });
          }
        }
        harvesterNs = nsQuery;
      } else {
        // 未指定 namespace：租户时仅使用第一个命名空间前缀；管理员则查询全部
        const namespaces: string[] = Array.isArray(tenant.namespaces) ? tenant.namespaces : [];
        const firstNs = (namespaces[0] ?? '').toString().trim();
        harvesterNs = firstNs || undefined;
      }

      const url = harvesterNs
        ? `${conn.origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(harvesterNs)}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`
        : `${conn.origin}/${HARVESTER_FLOW_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
      console.log('flow url: ', url);
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      // Harvester collection 可能返回 { items: [...] } 或 { data: [...] } 或直接是数组
      const list: any[] = Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw)
            ? raw
            : [];
      res.json({ items: list });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.get('/:id/logging/flows/:namespace/:name', async (req: any, res: Response) => {
    try {
      const { namespace, name } = req.params;
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权访问该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(
        namespace,
      )}/${encodeURIComponent(name)}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.post('/:id/logging/flows', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const body = req.body || {};
      const namespace = body?.metadata?.namespace;
      if (!namespace) return res.status(400).json({ message: '缺少命名空间' });

      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权操作该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(namespace)}`;
      const data = await requestJson('POST', url, conn.token, conn.insecure, body);
      res.status(201).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '创建失败' });
    }
  });

  router.put('/:id/logging/flows/:namespace/:name', async (req: any, res: Response) => {
    try {
      const { namespace, name } = req.params;
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权操作该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(
        namespace,
      )}/${encodeURIComponent(name)}`;
      const data = await requestJson('PUT', url, conn.token, conn.insecure, req.body);
      res.json(data);
    } catch (e: any) {
      // 调试用：输出 Harvester 返回的详细错误，便于定位 Flow 更新失败原因
      // eslint-disable-next-line no-console
      console.error(
        '[Logging] Update Flow failed:',
        e?.status ?? e?.code ?? '',
        e?.message ?? '',
        e?.body ?? '',
      );
      if (e?.status) {
        return res.status(e.status).json({
          message: e?.message || '更新失败',
          details: e?.body,
        });
      }
      res.status(500).json({ message: e?.message || '更新失败' });
    }
  });

  router.delete('/:id/logging/flows/:namespace/:name', async (req: any, res: Response) => {
    try {
      const { namespace, name } = req.params;
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权操作该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(
        namespace,
      )}/${encodeURIComponent(name)}`;
      await requestJson('DELETE', url, conn.token, conn.insecure);
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '删除失败' });
    }
  });

  // --- Outputs (Namespace Scoped) ---
  router.get('/:id/logging/outputs', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

      const url = `${conn.origin}/${HARVESTER_OUTPUT_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      const getNs = (item: any) =>
        (item?.metadata?.namespace ?? item?.data?.metadata?.namespace ?? '').toString().trim();
      let list: any[] = Array.isArray((raw as any)?.data)
        ? (raw as any).data
        : Array.isArray((raw as any)?.items)
          ? (raw as any).items
          : Array.isArray(raw)
            ? raw
            : [];

      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedSet = new Set(tenant.namespaces);
        list = list.filter((item: any) => allowedSet.has(getNs(item)));
      }
      const queryNs = (req.query?.namespace ?? '').toString().trim();
      if (queryNs) {
        list = list.filter((item: any) => getNs(item) === queryNs);
      }
      res.json({ items: list });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.get('/:id/logging/outputs/:namespace', async (req: any, res: Response) => {
    try {
      const namespace = (req.params?.namespace ?? '').toString().trim();
      if (!namespace) return res.status(400).json({ message: '缺少命名空间' });

      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权访问该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_OUTPUT_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      const getNs = (item: any) =>
        (item?.metadata?.namespace ?? item?.data?.metadata?.namespace ?? '').toString().trim();
      let list: any[] = Array.isArray((raw as any)?.data)
        ? (raw as any).data
        : Array.isArray((raw as any)?.items)
          ? (raw as any).items
          : Array.isArray(raw)
            ? raw
            : [];

      list = list.filter((item: any) => getNs(item) === namespace);
      res.json({ items: list });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.get('/:id/logging/outputs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const { namespace, name } = req.params;
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权访问该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(
        namespace,
      )}/${encodeURIComponent(name)}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.post('/:id/logging/outputs', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const body = req.body || {};
      const namespace = body?.metadata?.namespace;
      if (!namespace) return res.status(400).json({ message: '缺少命名空间' });

      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权操作该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(namespace)}`;
      const data = await requestJson('POST', url, conn.token, conn.insecure, body);
      res.status(201).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '创建失败' });
    }
  });

  router.put('/:id/logging/outputs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const { namespace, name } = req.params;
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权操作该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(
        namespace,
      )}/${encodeURIComponent(name)}`;
      const data = await requestJson('PUT', url, conn.token, conn.insecure, req.body);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '更新失败' });
    }
  });

  router.delete('/:id/logging/outputs/:namespace/:name', async (req: any, res: Response) => {
    try {
      const { namespace, name } = req.params;
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权操作该命名空间' });
      }

      const url = `${conn.origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(
        namespace,
      )}/${encodeURIComponent(name)}`;
      await requestJson('DELETE', url, conn.token, conn.insecure);
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '删除失败' });
    }
  });

  // ---------- Harvester VM virt-launcher Pod (for log stream) ----------
  router.get('/:id/logging/harvester/vm-pod', async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const { namespace, vmName } = req.query;
      const ns = typeof namespace === 'string' ? namespace : '';
      const vm = typeof vmName === 'string' ? vmName : '';

      const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
      if (!allowed) return res.status(403).json({ message: '无权访问' });
      if (isTenant || tenantNamespace) {
        if (!ns || !isNamespaceAllowed(tenantNamespace, ns)) {
          return res.status(403).json({ message: '无权访问该命名空间' });
        }
      }

      if (!ns || !vm) {
        return res.status(400).json({ message: '缺少 namespace 或 vmName' });
      }

      const conn = await getCloudAndConn(id, res);
      if (!conn) return;

      // virt-launcher pod name: virt-launcher-{vmName}-{random}
      // 多种方式查找：labelSelector、全量列表按前缀过滤、VMI 关联、Harvester Steve API
      const labelSelector = `kubevirt.io%2Fdomain%3D${encodeURIComponent(vm)}`;
      const candidates: string[] = [
        `${conn.origin}/api/v1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${labelSelector}&limit=100`,
        `${conn.origin}/k8s/clusters/local/api/v1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${labelSelector}&limit=100`,
        `${conn.origin}/api/v1/namespaces/${encodeURIComponent(ns)}/pods?limit=500`,
        `${conn.origin}/k8s/clusters/local/api/v1/namespaces/${encodeURIComponent(ns)}/pods?limit=500`,
        `${conn.origin}/v1/harvester/core.pods?limit=500`,
        `${conn.origin}/v1/harvester/core.v1.pods?limit=500`,
      ];

      const getPodMeta = (p: any) => {
        const data = p?.data || p;
        const m = p?.metadata || data?.metadata || p;
        return m;
      };
      const matchVirtLauncher = (p: any): boolean => {
        const m = getPodMeta(p);
        const name = (m?.name ?? '').toString().trim();
        const pns = (m?.namespace ?? '').toString().trim();
        const phase = (p?.status?.phase ?? p?.data?.status?.phase ?? '').toString();
        const labels = m?.labels || {};
        const matchDomain = labels['kubevirt.io/domain'] === vm;
        const matchPrefix = name.startsWith(`virt-launcher-${vm}-`);
        const phaseOk = !phase || phase === 'Running';
        return (matchPrefix || matchDomain) && (!pns || pns === ns) && phaseOk;
      };
      const extractPodName = (p: any): string =>
        (getPodMeta(p)?.name ?? '').toString().trim();

      let podName: string | null = null;
      for (const url of candidates) {
        try {
          const json = await getJsonOnce(url, conn.token, conn.insecure, true);
          const items = json?.items || json?.data || [];
          const arr = Array.isArray(items) ? items : [];
          const virtLauncher = arr.find(matchVirtLauncher);
          if (virtLauncher) {
            podName = extractPodName(virtLauncher);
            if (podName) break;
          }
        } catch {
          continue;
        }
      }

      if (!podName) {
        return res.status(404).json({ message: '未找到运行中的 virt-launcher Pod，请确认 VM 已启动且命名空间/名称正确' });
      }
      res.json({ podName });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '查询失败' });
    }
  });

  // ---------- Harvester Events ----------
  // 多路径尝试：Harvester Steve API、K8s API（不同 base path）
  router.get('/:id/logging/harvester/events', async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const { namespace, name, kind } = req.query;
      const ns = typeof namespace === 'string' ? namespace : '';
      const n = typeof name === 'string' ? name : '';
      const k = typeof kind === 'string' ? kind : '';

      const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
      if (!allowed) return res.status(403).json({ message: '无权访问' });

      if (isTenant || tenantNamespace) {
        if (!ns) {
          return res.status(400).json({ message: '缺少命名空间' });
        }
        if (!isNamespaceAllowed(tenantNamespace, ns)) {
          return res.status(403).json({ message: '无权访问该命名空间' });
        }
      }

      const conn = await getCloudAndConn(id, res);
      if (!conn) return;

      // 构建 fieldSelector：involvedObject.kind,involvedObject.namespace,involvedObject.name
      let fieldSelector = '';
      if (k && ns && n) {
        fieldSelector = `involvedObject.kind=${k},involvedObject.namespace=${ns},involvedObject.name=${n}`;
      } else if (k && ns) {
        fieldSelector = `involvedObject.kind=${k},involvedObject.namespace=${ns}`;
      } else if (k && n) {
        fieldSelector = `involvedObject.kind=${k},involvedObject.name=${n}`;
      } else if (k) {
        fieldSelector = `involvedObject.kind=${k}`;
      }

      const fs = fieldSelector ? `&fieldSelector=${fieldSelector}` : '';
      const baseParams = 'pagesize=100000&exclude=metadata.managedFields';
      const url = `${conn.origin}/v1/harvester/events?${baseParams}${fs}`;
      let items: any[] = [];
      try {
        const json = await getJsonOnce(url, conn.token, conn.insecure);
        console.log('event items:', json);
        let extracted = json?.data || json?.items || [];
        if (!Array.isArray(extracted)) extracted = [];
        items = extracted.map((it: any) => {
          const ev = it?.data && typeof it.data === 'object' ? it.data : it;
          if (ev && ev._type != null && ev.type == null) {
            ev.type = ev._type;
          }
          return ev;
        });
      } catch (e: any) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[HarvesterEvents] URL failed: ${url}`, e?.message || e);
        }
      }

      res.json({ data: items });
    } catch (error: any) {
      res.status(500).json({
        message: '查询事件失败',
        error: error?.body || error?.message,
      });
    }
  });
}
