/**
 * ==============================================================================
 * 模块名称: Harvester 集群资源路由 (Harvester Cluster Resource Routes)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.cluster.routes.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 处理 Harvester 集群层面的资源查询，包括集群节点 (Nodes)、健康状态 (Health) 和能力检测 (Capabilities)。
 * 
 * [核心逻辑]
 * 1. [节点管理]: 
 *    - 支持获取所有节点列表 (自动缓存/同步)。
 *    - 支持获取单个节点详情，包含智能 URL 推断逻辑以适配不同 API 路径。
 * 2. [健康检查]: 实时调用 Harvester 接口检查集群健康状态。
 * 3. [能力检测]: 获取集群版本和支持的功能特性。
 * 
 * ------------------------------------------------------------------------------
 * [接口清单 (API Routes)]
 * ------------------------------------------------------------------------------
 * 1. GET /:id/resources/harvester/nodes
 *    - 获取节点列表 (带缓存)
 * 
 * 2. GET /:id/resources/harvester/nodes/:name
 *    - 获取单个节点详情 (实时)
 * 
 * 3. GET /:id/resources/harvester/health
 *    - 健康检查 (实时)
 * 
 * 4. GET /:id/resources/harvester/capabilities
 *    - 能力检测 (实时)
 * ==============================================================================
 */
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
  /**
   * [API] 查询节点列表
   * GET /:id/resources/harvester/nodes
   */
  router.get(
    '/:id/resources/harvester/nodes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        
        // [前置校验]
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNodeInventory);
        const count = await repo.count({ where: { cloudId: id } });

        // [缓存策略] 同步节点数据
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterNodes(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Nodes failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });

        // [数据增强] 构建访问链接 (View Link)
        // 1. 解析基础 URL (Origin)
        // 2. 为每个节点生成跳转到 Harvester 控制台的链接
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

  /**
   * [API] 查询单个节点详情
   * GET /:id/resources/harvester/nodes/:name
   * 
   * [实现原理]
   * 由于 Harvester/Rancher API 路径结构复杂 (可能包含 cluster ID)，
   * 此接口尝试通过多种可能的 URL 路径去探测节点详情。
   */
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
        
        // [基础 URL 解析]
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        
        // [动态 ClusterID 获取] 尝试获取 Rancher 下游集群 ID
        // 优先匹配 'local' 集群，否则取第一个集群
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
        
        // [路径探测] 构造候选 URL 列表
        // 1. Rancher Proxy 路径 (含 clusterId)
        // 2. 标准 K8s API 路径
        // 3. Harvester 专用 API 路径
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
        
        // [请求重试] 依次尝试候选 URL 直到成功
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

  /**
   * [API] 健康检查
   * GET /:id/resources/harvester/health
   */
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
        
        // [实时调用] 调用 SDK 进行健康检查
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

  /**
   * [API] 获取集群能力
   * GET /:id/resources/harvester/capabilities
   */
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

        // [实时调用] 获取集群版本及特性
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
