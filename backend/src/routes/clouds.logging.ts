import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { UserSpace } from '../entities/UserSpace';
import { getJsonOnce, requestJson } from '../services/clouds/harvester/utils';

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
    res.status(400).json({ message: '仅支持 Harvester/Cloudmap 资源池的日志配置' });
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

const CLUSTERFLOW_BASE = 'apis/logging.banzaicloud.io/v1beta1/clusterflows';
const CLUSTEROUTPUT_BASE = 'apis/logging.banzaicloud.io/v1beta1/clusteroutputs';
const FLOW_BASE = 'apis/logging.banzaicloud.io/v1beta1/flows';
const OUTPUT_BASE = 'apis/logging.banzaicloud.io/v1beta1/outputs';

export function registerLoggingRoutes(router: Router, _checkAdminPermission: any) {
  // --- ClusterFlows ---
  router.get('/:id/logging/clusterflows', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      // Only admin can see cluster flows? Or tenant with read access?
      // Assuming tenant can read cluster flows but maybe not create?
      // For simplicity, allow read if they have access to cloud, but maybe strictly check permissions?
      // Using getTenantAccess to check basic cloud access
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });
      
      const url = `${conn.origin}/${CLUSTERFLOW_BASE}?limit=1000`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.get('/:id/logging/clusterflows/:name', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

      const url = `${conn.origin}/${CLUSTERFLOW_BASE}/${req.params.name}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.post('/:id/logging/clusterflows', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      // Strictly admin for ClusterFlow?
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed || !tenant.isAdmin) return res.status(403).json({ message: '仅管理员可操作集群日志' });

      const url = `${conn.origin}/${CLUSTERFLOW_BASE}`;
      const data = await requestJson('POST', url, conn.token, conn.insecure, req.body);
      res.status(201).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '创建失败' });
    }
  });

  router.put('/:id/logging/clusterflows/:name', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed || !tenant.isAdmin) return res.status(403).json({ message: '仅管理员可操作集群日志' });

      const url = `${conn.origin}/${CLUSTERFLOW_BASE}/${req.params.name}`;
      const data = await requestJson('PUT', url, conn.token, conn.insecure, req.body);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '更新失败' });
    }
  });

  router.delete('/:id/logging/clusterflows/:name', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed || !tenant.isAdmin) return res.status(403).json({ message: '仅管理员可操作集群日志' });

      const url = `${conn.origin}/${CLUSTERFLOW_BASE}/${req.params.name}`;
      await requestJson('DELETE', url, conn.token, conn.insecure);
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '删除失败' });
    }
  });

  // --- ClusterOutputs ---
  router.get('/:id/logging/clusteroutputs', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

      const url = `${conn.origin}/${CLUSTEROUTPUT_BASE}?limit=1000`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.get('/:id/logging/clusteroutputs/:name', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

      const url = `${conn.origin}/${CLUSTEROUTPUT_BASE}/${req.params.name}`;
      const data = await getJsonOnce(url, conn.token, conn.insecure, true);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '请求失败' });
    }
  });

  router.post('/:id/logging/clusteroutputs', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed || !tenant.isAdmin) return res.status(403).json({ message: '仅管理员可操作集群日志' });

      const url = `${conn.origin}/${CLUSTEROUTPUT_BASE}`;
      const data = await requestJson('POST', url, conn.token, conn.insecure, req.body);
      res.status(201).json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '创建失败' });
    }
  });

  router.put('/:id/logging/clusteroutputs/:name', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed || !tenant.isAdmin) return res.status(403).json({ message: '仅管理员可操作集群日志' });

      const url = `${conn.origin}/${CLUSTEROUTPUT_BASE}/${req.params.name}`;
      const data = await requestJson('PUT', url, conn.token, conn.insecure, req.body);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '更新失败' });
    }
  });

  router.delete('/:id/logging/clusteroutputs/:name', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed || !tenant.isAdmin) return res.status(403).json({ message: '仅管理员可操作集群日志' });

      const url = `${conn.origin}/${CLUSTEROUTPUT_BASE}/${req.params.name}`;
      await requestJson('DELETE', url, conn.token, conn.insecure);
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '删除失败' });
    }
  });

  // --- Flows (Namespace Scoped) ---
  router.get('/:id/logging/flows', async (req: any, res: Response) => {
    try {
      const conn = await getCloudAndConn(req.params.id, res);
      if (!conn) return;
      const tenant = await getTenantAccess(req, req.params.id);
      if (!tenant.allowed) return res.status(403).json({ message: '无权访问' });

      const url = `${conn.origin}/${FLOW_BASE}?limit=1000`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      let list: any[] = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);

      // Filter by tenant namespaces
      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedSet = new Set(tenant.namespaces);
        list = list.filter((item: any) => {
          const ns = (item?.metadata?.namespace ?? '').toString().trim();
          return allowedSet.has(ns);
        });
      }
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/flows/${name}`;
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/flows`;
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/flows/${name}`;
      const data = await requestJson('PUT', url, conn.token, conn.insecure, req.body);
      res.json(data);
    } catch (e: any) {
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/flows/${name}`;
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

      const url = `${conn.origin}/${OUTPUT_BASE}?limit=1000`;
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      let list: any[] = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);

      // Filter by tenant namespaces
      if (!tenant.isAdmin && tenant.namespaces.length > 0) {
        const allowedSet = new Set(tenant.namespaces);
        list = list.filter((item: any) => {
          const ns = (item?.metadata?.namespace ?? '').toString().trim();
          return allowedSet.has(ns);
        });
      }
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/outputs/${name}`;
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/outputs`;
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/outputs/${name}`;
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

      const url = `${conn.origin}/apis/logging.banzaicloud.io/v1beta1/namespaces/${namespace}/outputs/${name}`;
      await requestJson('DELETE', url, conn.token, conn.insecure);
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e?.message || '删除失败' });
    }
  });
}
