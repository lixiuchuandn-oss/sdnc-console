import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { In } from 'typeorm';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import {
  listHarvesterLoadBalancers,
  createHarvesterLoadBalancer,
} from '../../../../services/clouds/harvester/client';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';
import { KubevirtLoadBalancerInventory } from '../../../../entities/kubevirt/KubevirtLoadBalancerInventory';
import { HarvesterLoadBalancerIPPoolInventory } from '../../../../entities/harvester/HarvesterLoadBalancerIPPoolInventory';
import {
  syncHarvesterLoadBalancers,
  syncHarvesterLoadBalancerIPPools,
} from '../../../../services/clouds/harvester/inventory';
import {
  buildTenantNamespaceInventoryWhere,
  mergePublicScenarioNamespacesFromQuery,
} from '../../../../services/clouds/harvester/publicNamespaces';

function getEndpointBase(endpoint: string): string {
  let endpointBase = (endpoint || '').replace(/\/+$/, '');
  if (!endpointBase.includes('/k8s/clusters/')) {
    endpointBase = endpointBase.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }
  return endpointBase;
}

export async function harvesterLbListHandler(req: any, res: Response, next: any) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(KubevirtLoadBalancerInventory);

    let whereCondition: any = { cloudId: id };
    if (isTenant) {
      const allowedNamespaces = tenantNamespace
        ? tenantNamespace
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
      whereCondition = await buildTenantNamespaceInventoryWhere(id, allowedNamespaces, {
        mergePublicScenarioNamespaces: mergePublicScenarioNamespacesFromQuery(req),
      });
      if (Array.isArray(whereCondition) && whereCondition.length === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }
    } else if (tenantNamespace) {
      const allowedNamespaces = tenantNamespace.split(',').map((s: string) => s.trim());
      if (allowedNamespaces.length > 0) whereCondition.namespace = In(allowedNamespaces);
    }

    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      try {
        await syncHarvesterLoadBalancers(cloud, insecure);
      } catch (e: any) {
        if (count === 0) throw e;
      }
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData).filter((item) => item != null);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res
      .status(500)
      .json({ message: '查询 Harvester 负载均衡失败', error: error.body || error.message });
  }
}

export async function harvesterLbCreateHandler(req: any, res: Response, next: any) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const payload = req.body;
    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s: string) => s.trim());
      if (!allowedNs.includes(payload.namespace)) {
        return res.status(403).json({ message: 'Access denied to this namespace' });
      }
    }
    const result = await createHarvesterLoadBalancer(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      payload,
    );
    res.json({ message: '创建成功', data: result });
  } catch (error: any) {
    res.status(500).json({ message: '创建负载均衡失败', error: error.body || error.message });
  }
}

export async function harvesterServiceDirectListHandler(req: any, res: Response, next: any) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const items = await listHarvesterLoadBalancers({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    });
    let filteredItems = items;
    if (isTenant) {
      filteredItems = tenantNamespace
        ? items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace))
        : [];
    } else if (tenantNamespace) {
      filteredItems = items.filter((i: any) =>
        isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
      );
    }
    res.json({ message: '查询成功', data: { items: filteredItems } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询Services失败', error: error.body || error.message });
  }
}

export async function harvesterLbDeleteHandler(req: any, res: Response, next: any) {
  try {
    const { id, namespace, name } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const endpointBase = getEndpointBase(cloud.endpoint || '');
    const url = `${endpointBase}/apis/loadbalancer.harvesterhci.io/v1beta1/namespaces/${namespace}/loadbalancers/${name}`;
    const data = await requestJson('DELETE', url, cloud.secretKey || '', insecure);
    return res.json({ message: '删除成功', data });
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `删除负载均衡失败 | ${error.body || error.message}`, error: error.body });
  }
}

export async function harvesterIpPoolListHandler(req: any, res: Response, next: any) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(HarvesterLoadBalancerIPPoolInventory);
    let whereCondition: any = { cloudId: id };
    if (isTenant) {
      const allowedNamespaces = tenantNamespace
        ? tenantNamespace
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
      whereCondition = await buildTenantNamespaceInventoryWhere(id, allowedNamespaces, {
        mergePublicScenarioNamespaces: mergePublicScenarioNamespacesFromQuery(req),
      });
      if (Array.isArray(whereCondition) && whereCondition.length === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }
    } else if (tenantNamespace) {
      const allowedNamespaces = tenantNamespace.split(',').map((s: string) => s.trim());
      if (allowedNamespaces.length > 0) whereCondition.namespace = In(allowedNamespaces);
    }
    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      try {
        await syncHarvesterLoadBalancerIPPools(cloud, insecure);
      } catch (e: any) {
        if (count === 0) throw e;
      }
    }
    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData).filter((item) => item != null);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询地址池失败', error: error.body || error.message });
  }
}

export async function harvesterIpPoolCreateHandler(req: any, res: Response, next: any) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const endpointBase = getEndpointBase(cloud.endpoint || '');
    const ns = req.body?.metadata?.namespace || 'default';
    const payload: any = {
      type: 'loadbalancer.harvesterhci.io.ippool',
      metadata: {
        name: req.body.metadata?.name,
        annotations: req.body.metadata?.annotations || {},
      },
      spec: {
        selector: {
          network: req.body.spec?.selector?.network,
          scope: req.body.spec?.selector?.scope || [{ namespace: '*', guestCluster: '' }],
        },
      },
    };
    payload.spec.ranges = [];
    if (req.body.spec?.cidrs && Array.isArray(req.body.spec.cidrs)) {
      payload.spec.ranges = req.body.spec.cidrs.map((cidr: string) => ({
        subnet: cidr,
        type: 'cidr',
      }));
    } else if (req.body.spec?.ranges && Array.isArray(req.body.spec.ranges)) {
      payload.spec.ranges = req.body.spec.ranges.map((r: any) => ({
        rangeStart: r.start,
        rangeEnd: r.end,
        subnet: r.subnet,
        gateway: r.gateway,
        type: 'range',
      }));
    }
    const url = `${endpointBase}/v1/harvester/loadbalancer.harvesterhci.io.ippools`;
    const data = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
    if (data && data.metadata) {
      try {
        const repo = AppDataSource.getRepository(HarvesterLoadBalancerIPPoolInventory);
        const uid = data.metadata?.uid || data.id || '';
        const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
        if (existing) {
          existing.name = data.metadata?.name || '';
          existing.namespace = data.metadata?.namespace || ns;
          existing.links = data.links;
          existing.ipam = data.spec?.ipam;
          existing.selector = data.spec?.selector;
          existing.subnet = data.status?.allocated?.subnet;
          existing.gateway = data.status?.allocated?.gateway;
          existing.rawData = data;
          await repo.save(existing);
        } else {
          const entity = repo.create({
            cloudId: cloud.id,
            uid,
            name: data.metadata?.name || '',
            namespace: data.metadata?.namespace || ns,
            links: data.links,
            ipam: data.spec?.ipam,
            selector: data.spec?.selector,
            subnet: data.status?.allocated?.subnet,
            gateway: data.status?.allocated?.gateway,
            rawData: data,
          });
          await repo.save(entity);
        }
      } catch (e: any) {
        console.error('[IPPool-Create] 入库地址池失败:', e?.message || e);
      }
    }
    return res.json({ message: '创建成功', data });
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `创建 IP 池失败 | ${error.body || error.message}`, error: error.body });
  }
}

export async function harvesterIpPoolDeleteHandler(req: any, res: Response, next: any) {
  try {
    const { id, name } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const endpointBase = getEndpointBase(cloud.endpoint || '');
    const url = `${endpointBase}/v1/harvester/loadbalancer.harvesterhci.io.ippools/${encodeURIComponent(name)}`;
    const data = await requestJson('DELETE', url, cloud.secretKey || '', insecure);
    return res.json({ message: '删除成功', data });
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `删除 IP 池失败 | ${error.body || error.message}`, error: error.body });
  }
}
