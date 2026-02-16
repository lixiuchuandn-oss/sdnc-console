import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { HarvesterNodeInventory } from '../../../entities/harvester/HarvesterNodeInventory';
import {
  harvesterHealthCheck,
  getHarvesterCapabilities,
} from '../../../services/clouds/harvester/client';
import { syncHarvesterNodes } from '../../../services/clouds/harvester/inventory';
import { getJsonOnce } from '../../../services/clouds/harvester/utils';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

export const registerHarvesterClusterRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  router.get(
    '/:id/resources/harvester/nodes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNodeInventory);
        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterNodes(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Nodes failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const items = dbItems.map((item: any) => {
          const n = item.rawData || {};
          const name = n?.metadata?.name || n?.name || item.name || '';
          const viewUrl = name
            ? `${origin}/api/v1/nodes/${encodeURIComponent(name)}`
            : undefined;
          return {
            ...n,
            links: viewUrl ? { view: viewUrl } : n?.links,
            name,
            status: item.status,
            nodeInfo: item.nodeInfo,
            kernelVersion: item.kernelVersion,
            osImage: item.osImage,
            containerRuntimeVersion: item.containerRuntimeVersion,
            kubeletVersion: item.kubeletVersion,
            kubeProxyVersion: item.kubeProxyVersion,
            operatingSystem: item.operatingSystem,
            architecture: item.architecture,
            view: item.view,
          };
        });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询节点失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/nodes/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        let clusterId: string | null = null;
        try {
          const clusters = await getJsonOnce(
            `${origin}/v3/clusters`,
            cloud.secretKey || '',
            insecure,
            true,
          );
          const arr = Array.isArray(clusters?.data)
            ? clusters?.data
            : Array.isArray(clusters?.items)
            ? clusters?.items
            : [];
          const local = arr.find(
            (c: any) =>
              String(c?.id || c?.Id || '').toLowerCase() === 'local',
          );
          const any = arr[0];
          clusterId = String(
            local?.id || local?.Id || any?.id || any?.Id || '',
          )
            .trim()
            .toLowerCase();
          if (!clusterId) clusterId = null;
        } catch {}
        const candidates = [
          ...(clusterId
            ? [
                `${origin}/k8s/clusters/${encodeURIComponent(
                  clusterId,
                )}/api/v1/nodes/${encodeURIComponent(name)}`,
              ]
            : []),
          `${origin}/api/v1/nodes/${encodeURIComponent(name)}`,
          `${origin}/v1/harvester/api/v1/nodes/${encodeURIComponent(name)}`,
          `${origin}/v1/core.v1.nodes/${encodeURIComponent(name)}`,
        ];
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await getJsonOnce(
              url,
              cloud.secretKey || '',
              insecure,
              true,
            );
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) throw lastErr;
        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询节点详情失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/health',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterHealthCheck({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '健康检查失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/capabilities',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await getHarvesterCapabilities({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);

        res.json({ message: '查询成功', data });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '获取集群能力失败', error: error.message });
      }
    },
  );
};
