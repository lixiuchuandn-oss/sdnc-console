import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { listCsmVms, listCsmHosts, operateCsmVm, getCsmVmConsole, listCsmElementGroups, listCsmServiceChains, deleteCsmServiceChain } from '../services/clouds/csm/client';
import { ServiceChain } from '../entities/ServiceChain';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) { res.status(404).json({ message: '云资源不存在' }); return null; }
  return cloud;
};

const ensureCsm = (cloud: any, res: Response, msg: string) => {
  const pv = String((cloud as any)?.config?.provider || '').toLowerCase().trim();
  const ok = pv === 'cloudmap' || pv.startsWith('cloudmap') || pv === 'csm';
  if (!ok) {
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

export const registerCsmRoutes = (router: Router, checkAdminPermission: any) => {
  router.get('/:id/csm/security/virtual-elements', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const queryObj: any = {};
      if (req.query.host_id) queryObj.host_id = String(req.query.host_id).trim();

      const items = await listCsmVms(config, queryObj);
      res.json({
        message: '查询成功',
        data: { items },
        capabilities: { isCsm: true }
      });
    } catch (error: any) {
      console.error('CSM Route Error:', error);
      res.status(500).json({ message: 'CSM 查询失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/physical-elements', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;

      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const queryObj: any = {};
      // Add any specific query params for hosts if needed
      
      const items = await listCsmHosts(config);
      res.json({ message: '查询成功', data: { items }, capabilities: { isCsm: true } });
    } catch (error: any) {
      console.error('CSM Host Route Error:', error);
      res.status(500).json({ message: '查询物理安全网元失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/element-groups', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const items = await listCsmElementGroups(config);
      res.json({ message: '查询成功', data: { items }, capabilities: { isCsm: true } });
    } catch (error: any) {
      res.status(500).json({ message: '查询安全网元组失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/service-chains', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const queryObj: any = {};
      if (req.query.page_size) queryObj.page_size = Number(req.query.page_size);
      if (req.query.page_num) queryObj.page_num = Number(req.query.page_num);
      if (req.query.pool_id) queryObj.pool_id = String(req.query.pool_id).trim();
      const items = await listCsmServiceChains(config, queryObj);
      if (Array.isArray(items) && items.length) {
        return res.json({ message: '查询成功', data: { items }, capabilities: { isCsm: true } });
      }
      const repo = AppDataSource.getRepository(ServiceChain);
      const filtered = await repo.find({ where: { clusterName: cloud.name }, order: { createdAt: 'DESC' } });
      if (Array.isArray(filtered) && filtered.length) {
        return res.json({ message: '查询成功', data: { items: filtered }, capabilities: { isCsm: true } });
      }
      const all = await repo.find({ order: { createdAt: 'DESC' } });
      res.json({ message: '查询成功', data: { items: all }, capabilities: { isCsm: true } });
    } catch (error: any) {
      res.status(500).json({ message: '查询服务链失败', error: error.message });
    }
  });

  router.post('/:id/csm/security/virtual-elements/:vmId/action', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id, vmId } = req.params;
      const { action } = req.body; // start, stop, reboot
      
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      await operateCsmVm(config, vmId, action);
      res.json({ message: '操作成功', data: { success: true } });
    } catch (error: any) {
      console.error('CSM Action Error:', error);
      res.status(500).json({ message: '操作失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/virtual-elements/:vmId/console', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id, vmId } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const result = await getCsmVmConsole(config, vmId);
      res.json({ message: '获取控制台成功', data: result });
    } catch (error: any) {
      console.error('CSM Console Error:', error);
      res.status(500).json({ message: '获取控制台失败', error: error.message });
    }
  });

  router.delete('/:id/csm/security/service-chains/:chainId', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id, chainId } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const queryObj: any = {};
      if (req.query.pool_id) queryObj.pool_id = String(req.query.pool_id).trim();
      const result = await deleteCsmServiceChain(config, chainId, queryObj);
      res.json({ message: '删除成功', data: result });
    } catch (error: any) {
      console.error('CSM Delete Service Chain Error:', error);
      res.status(500).json({ message: '删除服务链失败', error: error.message });
    }
  });
};
