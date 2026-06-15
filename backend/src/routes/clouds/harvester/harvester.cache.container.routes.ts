/**
 * ==============================================================================
 * 模块名称: Harvester 容器资源路由 (Harvester Container Resource Routes)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.container.routes.ts
 * ==============================================================================
 *
 * [功能描述]
 * 处理 Harvester/Kubernetes 容器相关资源查询和操作，包括：
 * 1. 工作负载管理 (Deployments, StatefulSets, DaemonSets)
 * 2. Pod 管理
 * 3. 任务管理 (Jobs, CronJobs)
 * 4. 配置管理 (ConfigMaps, Secrets)
 * 5. 镜像凭证管理
 *
 * [核心逻辑]
 * 各主题路由按子模块注册；本文件仅负责装配。
 *
 * ------------------------------------------------------------------------------
 * [API 版本说明]
 * ------------------------------------------------------------------------------
 * - v1: Pod, Service, ConfigMap, Secret, PVC 等
 * - apps/v1: Deployment, StatefulSet, DaemonSet
 * - batch/v1: Job, CronJob
 * - networking.k8s.io/v1: Ingress
 * ==============================================================================
 */
import { Router } from 'express';
import { registerHarvesterContainerPodRoutes } from './harvester.cache.container-pods.routes';
import { registerHarvesterContainerWorkloadRoutes } from './harvester.cache.container-workloads.routes';
import { registerHarvesterContainerJobRoutes } from './harvester.cache.container-jobs.routes';
import { registerHarvesterContainerConfigRoutes } from './harvester.cache.container-config.routes';
import { registerHarvesterContainerImagePullRoutes } from './harvester.cache.container-imagepull.routes';
import { registerHarvesterContainerServiceRoutes } from './harvester.cache.container-services.routes';
import { registerHarvesterContainerNetworkPolicyRoutes } from './harvester.cache.container-networkpolicy.routes';
import { registerHarvesterContainerPdbRoutes } from './harvester.cache.container-pdb.routes';
import { registerHarvesterContainerGatewayRoutes } from './harvester.cache.container-gateway.routes';
import { registerHarvesterContainerCrudRoutes } from './harvester.cache.container-crud.routes';
import { registerHarvesterContainerDockerRegistryRoutes } from './harvester.cache.container-docker-registry.routes';
import { registerHarvesterContainerContainerdRegistryRoutes } from './harvester.cache.container-containerd-registry.routes';
import { registerHarvesterLocalRegistryRoutes } from './harvester.local-registry.routes';

export const registerHarvesterContainerRoutes = (router: Router, checkAdminPermission: any) => {
  registerHarvesterContainerWorkloadRoutes(router, checkAdminPermission);
  registerHarvesterContainerPodRoutes(router, checkAdminPermission);
  registerHarvesterContainerJobRoutes(router, checkAdminPermission);
  registerHarvesterContainerConfigRoutes(router, checkAdminPermission);
  registerHarvesterContainerImagePullRoutes(router, checkAdminPermission);
  registerHarvesterContainerServiceRoutes(router, checkAdminPermission);
  registerHarvesterContainerNetworkPolicyRoutes(router, checkAdminPermission);
  registerHarvesterContainerPdbRoutes(router, checkAdminPermission);
  registerHarvesterContainerGatewayRoutes(router, checkAdminPermission);
  registerHarvesterContainerCrudRoutes(router, checkAdminPermission);
  registerHarvesterContainerDockerRegistryRoutes(router, checkAdminPermission);
  registerHarvesterContainerContainerdRegistryRoutes(router, checkAdminPermission);
  registerHarvesterLocalRegistryRoutes(router, checkAdminPermission);
};
