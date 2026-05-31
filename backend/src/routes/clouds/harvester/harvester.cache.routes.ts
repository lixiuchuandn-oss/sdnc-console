/**
 * Harvester 缓存路由入口
 *
 * 功能：
 * 1. 提供通用 API 代理工具路由
 * 2. 注册所有缓存资源路由（通过 provider-router 模式）
 *
 * 路由：
 * - ALL /:id/resources/harvester/proxy?path=string - Harvester/K8s API 代理
 *   支持绝对路径（http/https）和相对路径，自动处理 K8s API 路径前缀
 */
import { Router, Response } from 'express';
import { requestJson } from '../../../services/clouds/harvester/utils';
import { getHarvesterNodeResourceUsage } from '../../../services/clouds/harvester/nodeResourceUsage';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { registerHarvesterCacheRoutesProvider } from './harvester.cache.routes.provider';
import { registerHarvesterContainerRoutes } from './harvester.cache.container.routes';
import {
  harvesterAswCtlProbeHandler,
  harvesterAswCtlSwitchesHandler,
  harvesterAswCtlSyncHandler,
} from './handlers/asw-ctl.handlers';
import {
  harvesterHmsSwitchCrCreateHandler,
  harvesterHmsSwitchCrDeleteHandler,
  harvesterHmsSwitchCrGetHandler,
  harvesterHmsSwitchCrListHandler,
  harvesterHmsSwitchCrUpdateHandler,
} from './handlers/hms-switch-cr.handlers';

/**
 * 注册 Harvester 缓存路由
 */
export const registerHarvesterRoutes = (router: Router, checkAdminPermission: any) => {
  // API 代理：转发请求到 Harvester/K8s API
  router.all(
    '/:id/resources/harvester/proxy',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { path } = req.query;
        if (!path || typeof path !== 'string') {
          return res.status(400).json({ message: 'Missing path parameter' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next)) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;

        // 构建目标 URL
        let target = '';
        if (path.startsWith('http://') || path.startsWith('https://')) {
          target = path;
        } else {
          const cleanPath = path.startsWith('/') ? path : `/${path}`;
          let base = cloud.endpoint.replace(/\/+$/, '');

          // 处理 K8s 原生 API 路径：自动去除 endpoint 版本后缀
          if (
            (cleanPath.startsWith('/api/') || cleanPath.startsWith('/apis/')) &&
            !base.includes('/k8s/clusters/')
          ) {
            base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
          }

          target = `${base}${cleanPath}`;
        }

        const data = await requestJson(
          req.method,
          target,
          cloud.secretKey || '',
          insecure,
          req.method === 'POST' || req.method === 'PUT' ? req.body : undefined,
        );
        res.json(data);
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: 'Proxy request failed',
          error: error.message || String(error),
        });
      }
    },
  );

  // 节点 CPU/内存资源聚合：服务端读取 metrics/nodes/全量 Pod 并聚合，仅回小结果，
  // 避免把全集群 Pod 列表传回浏览器（物理节点列表 CPU/内存列刷新慢的根因）
  router.get(
    '/:id/resources/harvester/node-resource-usage',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next)) return;
        const force = req.query?.force === 'true' || req.query?.force === '1';
        const data = await getHarvesterNodeResourceUsage(cloud, { force });
        res.json({ ok: true, ...data });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '聚合节点资源失败',
          error: error?.message || String(error),
        });
      }
    },
  );

  // 物理交换机 / HSM：默认同资源池 API Endpoint；可选 config.aswCtl 覆盖
  router.get(
    '/:id/resources/harvester/asw-ctl/switches',
    checkAdminPermission,
    harvesterAswCtlSwitchesHandler,
  );
  router.post(
    '/:id/resources/harvester/asw-ctl/sync',
    checkAdminPermission,
    harvesterAswCtlSyncHandler,
  );
  router.post(
    '/:id/resources/harvester/asw-ctl/probe',
    checkAdminPermission,
    harvesterAswCtlProbeHandler,
  );

  // HMS Switch CR（hms.rivercloud.com/v1 Switch）声明式配置
  router.get(
    '/:id/resources/harvester/hms/switches',
    checkAdminPermission,
    harvesterHmsSwitchCrListHandler,
  );
  router.post(
    '/:id/resources/harvester/hms/switches',
    checkAdminPermission,
    harvesterHmsSwitchCrCreateHandler,
  );
  router.get(
    '/:id/resources/harvester/hms/switches/:name',
    checkAdminPermission,
    harvesterHmsSwitchCrGetHandler,
  );
  router.put(
    '/:id/resources/harvester/hms/switches/:name',
    checkAdminPermission,
    harvesterHmsSwitchCrUpdateHandler,
  );
  router.delete(
    '/:id/resources/harvester/hms/switches/:name',
    checkAdminPermission,
    harvesterHmsSwitchCrDeleteHandler,
  );

  // 注册所有缓存资源路由（VMs、Volumes、Subnets、Namespaces 等）
  registerHarvesterCacheRoutesProvider(router, checkAdminPermission);

  // 注册容器资源路由（独立模块）
  registerHarvesterContainerRoutes(router, checkAdminPermission);
};
