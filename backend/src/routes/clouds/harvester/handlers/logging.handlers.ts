/**
 * Harvester Logging Handlers
 * 日志管理相关操作（ClusterFlow, ClusterOutput, Flow, Output 等）
 */

import { Request, Response } from 'express';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import { checkTenantAccess, isNamespaceAllowed, ensureProvider } from '../harvester.direct.helpers';

const CATTLE_LOGGING_SYSTEM_NS = 'cattle-logging-system';
const LOG_PAGESIZE = 'pagesize=100000';
const LOG_EXCLUDE = 'exclude=metadata.managedFields';
const HARVESTER_CLUSTERFLOW_BASE = 'v1/harvester/logging.banzaicloud.io.clusterflows';
const HARVESTER_CLUSTEROUTPUT_BASE = 'v1/harvester/logging.banzaicloud.io.clusteroutputs';
const HARVESTER_FLOW_BASE = 'v1/harvester/logging.banzaicloud.io.flows';
const HARVESTER_OUTPUT_BASE = 'v1/harvester/logging.banzaicloud.io.outputs';

function getEndpointBase(endpoint: string): string {
  let base = String(endpoint || '').replace(/\/+$/, '');
  if (!base.includes('/k8s/clusters/')) {
    base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }
  return base || '';
}

function normalizeOrigin(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(endpoint || '')
      .replace(/\/+$/, '')
      .replace(/\/v[0-9].*$/, '');
  }
}

async function getTenantAccessForLogging(
  req: any,
  cloudId: string,
): Promise<{ allowed: boolean; namespaces: string[]; isAdmin: boolean }> {
  const { allowed, namespace, isTenant } = await checkTenantAccess(req, cloudId);
  if (!allowed) return { allowed: false, namespaces: [], isAdmin: false };
  if (!isTenant) return { allowed: true, namespaces: [], isAdmin: true };
  const namespaces = namespace ? namespace.split(',').map((s) => s.trim()) : [];
  return { allowed: true, namespaces, isAdmin: false };
}

// ClusterFlow Handlers
export async function harvesterClusterFlowListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_CLUSTERFLOW_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterClusterFlowDetailHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_CLUSTERFLOW_BASE}/${encodeURIComponent(CATTLE_LOGGING_SYSTEM_NS)}/${encodeURIComponent(name)}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterClusterFlowCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed, isTenant } = await checkTenantAccess(req as any, id);
    if (!allowed || isTenant) {
      return res.status(403).json({ message: '仅管理员可操作集群日志' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const body = req.body || {};
    body.metadata = body.metadata || {};
    body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;

    const url = `${origin}/${HARVESTER_CLUSTERFLOW_BASE}`;
    const data = await requestJson('POST', url, cloud.secretKey || '', insecure, body);
    res.status(201).json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '创建失败' });
  }
}

export async function harvesterClusterFlowUpdateHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed, isTenant } = await checkTenantAccess(req as any, id);
    if (!allowed || isTenant) {
      return res.status(403).json({ message: '仅管理员可操作集群日志' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_CLUSTERFLOW_BASE}/${encodeURIComponent(CATTLE_LOGGING_SYSTEM_NS)}/${encodeURIComponent(name)}`;
    const body = req.body || {};
    body.metadata = body.metadata || {};
    body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;
    const data = await requestJson('PUT', url, cloud.secretKey || '', insecure, body);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '更新失败' });
  }
}

export async function harvesterClusterFlowDeleteHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed, isTenant } = await checkTenantAccess(req as any, id);
    if (!allowed || isTenant) {
      return res.status(403).json({ message: '仅管理员可操作集群日志' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_CLUSTERFLOW_BASE}/${encodeURIComponent(CATTLE_LOGGING_SYSTEM_NS)}/${encodeURIComponent(name)}`;
    await requestJson('DELETE', url, cloud.secretKey || '', insecure);
    res.status(204).send();
  } catch (e: any) {
    if (res.headersSent) return;
    if (e?.status) {
      return res.status(e.status).json({ message: e?.message || '删除失败', details: e?.body });
    }
    res.status(500).json({ message: e?.message || '删除失败' });
  }
}

// ClusterOutput Handlers
export async function harvesterClusterOutputListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_CLUSTEROUTPUT_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    const DESCRIPTION_ANNOTATION = 'cloudhci.io/description';
    const items = Array.isArray((raw as any)?.data)
      ? (raw as any).data
      : Array.isArray((raw as any)?.items)
        ? (raw as any).items
        : [];
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
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterClusterOutputDetailHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_CLUSTEROUTPUT_BASE}/${encodeURIComponent(CATTLE_LOGGING_SYSTEM_NS)}/${encodeURIComponent(name)}?${LOG_EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterClusterOutputCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed, isTenant } = await checkTenantAccess(req as any, id);
    if (!allowed || isTenant) {
      return res.status(403).json({ message: '仅管理员可操作集群日志' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const body = req.body || {};
    body.metadata = body.metadata || {};
    body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;

    const url = `${origin}/${HARVESTER_CLUSTEROUTPUT_BASE}`;
    const data = await requestJson('POST', url, cloud.secretKey || '', insecure, body);
    res.status(201).json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    if (e?.status) {
      return res
        .status(e.status)
        .json({ message: e?.message || '创建失败', details: { body: e?.body } });
    }
    res.status(500).json({ message: e?.message || '创建失败' });
  }
}

export async function harvesterClusterOutputUpdateHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed, isTenant } = await checkTenantAccess(req as any, id);
    if (!allowed || isTenant) {
      return res.status(403).json({ message: '仅管理员可操作集群日志' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const body = req.body || {};
    body.metadata = body.metadata || {};
    body.metadata.namespace = CATTLE_LOGGING_SYSTEM_NS;
    body.metadata.name = name;

    const url = `${origin}/${HARVESTER_CLUSTEROUTPUT_BASE}/${encodeURIComponent(CATTLE_LOGGING_SYSTEM_NS)}/${encodeURIComponent(name)}`;
    const data = await requestJson('PUT', url, cloud.secretKey || '', insecure, body);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    if (e?.status) {
      return res.status(e.status).json({ message: e?.message || '更新失败', details: e?.body });
    }
    res.status(500).json({ message: e?.message || '更新失败' });
  }
}

export async function harvesterClusterOutputDeleteHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed, isTenant } = await checkTenantAccess(req as any, id);
    if (!allowed || isTenant) {
      return res.status(403).json({ message: '仅管理员可操作集群日志' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_CLUSTEROUTPUT_BASE}/${encodeURIComponent(CATTLE_LOGGING_SYSTEM_NS)}/${encodeURIComponent(name)}`;
    await requestJson('DELETE', url, cloud.secretKey || '', insecure);
    res.status(204).send();
  } catch (e: any) {
    if (res.headersSent) return;
    if (e?.status) {
      return res.status(e.status).json({ message: e?.message || '删除失败', details: e?.body });
    }
    res.status(500).json({ message: e?.message || '删除失败' });
  }
}

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

export async function harvesterLoggingTemplateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });
    res.json({ yaml: PRESET_LOGGING_TEMPLATE_YAML });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

// Flow (Namespace Scoped) Handlers
export async function harvesterFlowListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const nsQuery = (req.query?.namespace ?? '').toString().trim();

    let harvesterNs: string | undefined;
    if (nsQuery) {
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(nsQuery)) {
        return res.status(403).json({ message: '无权访问该命名空间' });
      }
      harvesterNs = nsQuery;
    } else {
      const firstNs = tenant.namespaces[0] || '';
      harvesterNs = firstNs || undefined;
    }

    const url = harvesterNs
      ? `${origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(harvesterNs)}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`
      : `${origin}/${HARVESTER_FLOW_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    const list: any[] = Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(raw)
          ? raw
          : [];
    res.json({ items: list });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterFlowDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权访问该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterFlowCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const namespace = body?.metadata?.namespace;
    if (!namespace) return res.status(400).json({ message: '缺少命名空间' });

    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权操作该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(namespace)}`;
    const data = await requestJson('POST', url, cloud.secretKey || '', insecure, body);
    res.status(201).json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '创建失败' });
  }
}

export async function harvesterFlowUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权操作该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const data = await requestJson('PUT', url, cloud.secretKey || '', insecure, req.body);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    if (e?.status) {
      return res.status(e.status).json({ message: e?.message || '更新失败', details: e?.body });
    }
    res.status(500).json({ message: e?.message || '更新失败' });
  }
}

export async function harvesterFlowDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权操作该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_FLOW_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    await requestJson('DELETE', url, cloud.secretKey || '', insecure);
    res.status(204).send();
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '删除失败' });
  }
}

// Output (Namespace Scoped) Handlers
export async function harvesterOutputListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_OUTPUT_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
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
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterOutputListByNamespaceHandler(req: Request, res: Response) {
  try {
    const { id, namespace } = req.params;
    if (!namespace) return res.status(400).json({ message: '缺少命名空间' });

    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权访问该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_OUTPUT_BASE}?${LOG_PAGESIZE}&${LOG_EXCLUDE}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
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
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterOutputDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权访问该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}

export async function harvesterOutputCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const namespace = body?.metadata?.namespace;
    if (!namespace) return res.status(400).json({ message: '缺少命名空间' });

    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权操作该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(namespace)}`;
    const data = await requestJson('POST', url, cloud.secretKey || '', insecure, body);
    res.status(201).json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '创建失败' });
  }
}

export async function harvesterOutputUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权操作该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const data = await requestJson('PUT', url, cloud.secretKey || '', insecure, req.body);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '更新失败' });
  }
}

export async function harvesterOutputDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForLogging(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(namespace)) {
      return res.status(403).json({ message: '无权操作该命名空间' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = getEndpointBase(cloud.endpoint || '');
    const url = `${origin}/${HARVESTER_OUTPUT_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    await requestJson('DELETE', url, cloud.secretKey || '', insecure);
    res.status(204).send();
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '删除失败' });
  }
}

// VM Pod & Events Handlers
export async function harvesterVmPodHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { namespace, vmName } = req.query;
    const ns = typeof namespace === 'string' ? namespace : '';
    const vm = typeof vmName === 'string' ? vmName : '';

    const {
      allowed,
      namespace: tenantNamespace,
      isTenant,
    } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });
    if (isTenant || tenantNamespace) {
      if (!ns || !isNamespaceAllowed(tenantNamespace, ns)) {
        return res.status(403).json({ message: '无权访问该命名空间' });
      }
    }

    if (!ns || !vm) {
      return res.status(400).json({ message: '缺少 namespace 或 vmName' });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');

    const labelSelector = `kubevirt.io%2Fdomain%3D${encodeURIComponent(vm)}`;
    const candidates: string[] = [
      `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${labelSelector}&limit=100`,
      `${origin}/k8s/clusters/local/api/v1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${labelSelector}&limit=100`,
      `${origin}/api/v1/namespaces/${encodeURIComponent(ns)}/pods?limit=500`,
      `${origin}/k8s/clusters/local/api/v1/namespaces/${encodeURIComponent(ns)}/pods?limit=500`,
      `${origin}/v1/harvester/core.pods?limit=500`,
      `${origin}/v1/harvester/core.v1.pods?limit=500`,
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
    const extractPodName = (p: any): string => (getPodMeta(p)?.name ?? '').toString().trim();

    let podName: string | null = null;
    for (const url of candidates) {
      try {
        const json = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
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
      return res
        .status(404)
        .json({ message: '未找到运行中的 virt-launcher Pod，请确认 VM 已启动且命名空间/名称正确' });
    }
    res.json({ podName });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '查询失败' });
  }
}

export async function harvesterEventsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { namespace, name, kind } = req.query;
    const ns = typeof namespace === 'string' ? namespace : '';
    const n = typeof name === 'string' ? name : '';
    const k = typeof kind === 'string' ? kind : '';

    const {
      allowed,
      namespace: tenantNamespace,
      isTenant,
    } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });

    if (isTenant || tenantNamespace) {
      if (!ns) {
        return res.status(400).json({ message: '缺少命名空间' });
      }
      if (!isNamespaceAllowed(tenantNamespace, ns)) {
        return res.status(403).json({ message: '无权访问该命名空间' });
      }
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池的日志配置'))
      return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');

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
    const url = `${origin}/v1/harvester/events?${baseParams}${fs}`;
    let items: any[] = [];
    try {
      const json = await getJsonOnce(url, cloud.secretKey || '', insecure);
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
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询事件失败',
      error: error?.body || error?.message,
    });
  }
}
