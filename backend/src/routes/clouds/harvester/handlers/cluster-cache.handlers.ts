/**
 * Harvester Cluster Handlers
 * 
 * 从 harvester.cache.cluster.routes.ts 中提取的 Cluster 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterNodeInventory } from '../../../../entities/harvester/HarvesterNodeInventory';
import {
  harvesterHealthCheck,
  getHarvesterCapabilities,
} from '../../../../services/clouds/harvester/client';
import { syncHarvesterNodes } from '../../../../services/clouds/harvester/inventory';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';

/**
 * GET /:id/resources/harvester/nodes - 获取节点列表
 */
export async function harvesterNodeListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
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
      // rawData 中包含入库用的 hmsNics / hmsHardware；对外响应统一为 nics / hardware
      const { hmsNics: _hmsNics, hmsHardware: _hmsHardware, ...restRaw } = n || {};
      const name = n?.metadata?.name || n?.name || item.name || '';
      const viewUrl = name
        ? `${origin}/api/v1/nodes/${encodeURIComponent(name)}`
        : undefined;
      return {
        ...restRaw,
        // 兼容：HMS 入库到 rawData；对外字段名稳定
        nics: Array.isArray(n?.hmsNics) ? n.hmsNics : [],
        hardware: n?.hmsHardware && typeof n.hmsHardware === 'object' ? n.hmsHardware : null,
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
    if (res.headersSent) return;
    res.status(500).json({ message: '查询节点失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/nodes/:name - 获取单个节点详情
 * 
 * [实现原理]
 * 由于 Harvester/Rancher API 路径结构复杂 (可能包含 cluster ID)，
 * 此接口尝试通过多种可能的 URL 路径去探测节点详情。
 */
export async function harvesterNodeDetailHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, name } = req.params;
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
    if (res.headersSent) return;
    res.status(500).json({ message: '查询节点详情失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/health - 健康检查
 */
export async function harvesterHealthHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    
    // [实时调用] 调用 SDK 进行健康检查
    const data = await harvesterHealthCheck({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    } as any);
    res.json({ message: '查询成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '健康检查失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/capabilities - 获取集群能力
 */
export async function harvesterCapabilitiesHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    // [实时调用] 获取集群版本及特性
    const data = await getHarvesterCapabilities({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    } as any);

    res.json({ message: '查询成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '获取集群能力失败', error: error.message });
  }
}
