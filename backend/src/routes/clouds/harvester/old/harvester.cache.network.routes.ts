import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { In } from 'typeorm';
import { UserSpace } from '../../../entities/UserSpace';
import { HarvesterClusterNetworkInventory } from '../../../entities/harvester/HarvesterClusterNetworkInventory';
import { HarvesterVlanConfigInventory } from '../../../entities/harvester/HarvesterVlanConfigInventory';
import { KubevirtNadInventory } from '../../../entities/kubevirt/KubevirtNadInventory';
import { KubeOvnVpcInventory } from '../../../entities/kubeovn/KubeOvnVpcInventory';
import { KubeOvnSubnetInventory } from '../../../entities/kubeovn/KubeOvnSubnetInventory';
import { HarvesterServiceInventory } from '../../../entities/harvester/HarvesterServiceInventory';
import {
  syncHarvesterClusterNetworks,
  syncHarvesterNads,
  syncKubeOvnVpcs,
  syncKubeOvnSubnets,
  syncHarvesterServices,
} from '../../../services/clouds/harvester/inventory';
import {
  createKubeOvnVpc,
  deleteKubeOvnVpc,
  updateKubeOvnVpc,
} from '../../../services/clouds/harvester/client';
import { requestJson, getJsonOnce } from '../../../services/clouds/harvester/utils';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { licenseService } from '../../../services/LicenseService';

/**
 * ==============================================================================
 * 组件名称: Harvester 网络资源管理 (Harvester Network Management)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.network.routes.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 负责 Harvester 平台底层网络资源的查询与管理，包括集群网络、VPC、子网、NAD 等。
 * 聚合了 Harvester 原生网络 (ClusterNetwork) 和 Kube-OVN 网络组件。
 * 
 * [核心逻辑]
 * 1. [资源聚合]: 
 *    - ClusterNetworks 接口会自动聚合关联的 VlanConfig 信息。
 * 2. [租户网络隔离]: 
 *    - VPC/Subnet 查询会根据 Kube-OVN 的 spec.namespaces 字段进行权限校验。
 *    - 租户仅能看到授权给其 Namespace 的 VPC/Subnet，以及公共 (cloud-public) 资源。
 * 3. [NAD 管理]:
 *    - 提供 Network Attachment Definition (NAD) 的增删查功能。
 *    - 创建/删除操作采用多路径重试机制，确保在不同 K8s/Rancher 环境下的兼容性。
 * 
 * ------------------------------------------------------------------------------
 * [API 接口说明]
 * ------------------------------------------------------------------------------
 * 1. GET /:id/resources/cluster-networks
 *    - 获取集群网络配置及 VLAN 映射。
 * 
 * 2. GET /:id/resources/vpcs
 *    - 获取 VPC 列表 (支持租户过滤)。
 * 
 * 3. GET /:id/resources/subnets
 *    - 获取子网列表 (支持 VPC 关联查询)。
 * 
 * 4. GET /:id/resources/harvester/nads
 *    - 获取网络附件定义 (NAD) 列表。
 * 
 * 5. GET /:id/resources/harvester/nads/:namespace/:name
 *    - 获取网络附件定义详情。
 * 
 * 6. POST /:id/resources/harvester/nads
 *    - 创建网络附件定义 (支持多路径尝试)。
 * 
 * 7. DELETE /:id/resources/harvester/nads/:namespace/:name
 *    - 删除网络附件定义 (支持多路径尝试)。
 * 
 * 8. GET /:id/resources/harvester/services
 *    - 获取服务 (Service) 列表 (支持租户过滤)。
 * ==============================================================================
 */
export const registerHarvesterNetworkRoutes = (router: Router, checkAdminPermission: any) => {
  // [已迁移] 以下路由已迁移到 harvester.cache.routes.provider.ts，使用策略模式+中间件架构
  // 实际路由已在新文件中注册，旧代码已禁用
  // 如需查看新实现，请参考: backend/src/routes/clouds/harvester/harvester.cache.routes.provider.ts
  return;
  
  /* 旧代码已禁用，保留用于参考
  // [已迁移] GET /:id/resources/cluster-networks
  router.get(
    '/:id/resources/cluster-networks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterClusterNetworkInventory);
        const vlanConfigRepo = AppDataSource.getRepository(HarvesterVlanConfigInventory);
        const count = await repo.count({ where: { cloudId: id } });

        // [同步策略] 缓存优先 + 按需同步
        // 如果本地数据库为空，或者用户显式请求 force=true，则触发远程同步。
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterClusterNetworks(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync ClusterNetworks failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const [items, vlanConfigs] = await Promise.all([
          repo.find({ where: { cloudId: id } }),
          vlanConfigRepo.find({ where: { cloudId: id } }),
        ]);

        // [资源聚合] 将 ClusterNetwork 与 VlanConfig 进行关联
        const list = items.map((i: any) => {
          const configs = vlanConfigs.filter((c: any) => c.clusterNetwork === i.name);
          return {
            ...(i.rawData || {}),
            view: i.links?.view || i.rawData?.links?.view,
            vlanConfigs: configs.map((c: any) => ({
              ...c,
              ...(c.rawData || {}),
            })),
          };
        });

        res.json({ items: list });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询集群网络失败', error: error.message });
      }
    },
  );

  // [已迁移] GET /:id/resources/vpcs
  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { force, skipSync } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubeOvnVpcInventory);

        let whereCondition: any = { cloudId: id };
        let tenantNamespace: string | undefined;
        const isTenantUser =
          (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        // [租户上下文] 获取租户的授权命名空间
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = {
            tenantId: (req as any).user.tenantId,
            cloudId: id,
            status: 'active',
          };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
          }
          const us = await userSpaceRepo.findOne({ where });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          tenantNamespace = us.namespace;

          // Auto-Fix: Ensure organization namespace is included in UserSpace
          if ((req.user as any).organizationId) {
             const orgNs = `ns-${(req.user as any).organizationId}`;
             const nsList = tenantNamespace ? tenantNamespace.split(',').map((s) => s.trim()).filter(Boolean) : [];
             if (!nsList.includes(orgNs)) {
                nsList.push(orgNs);
                tenantNamespace = nsList.join(',');
                us.namespace = tenantNamespace;
                try {
                   await userSpaceRepo.save(us);
                } catch (e) {
                   console.warn('Failed to auto-update UserSpace namespace', e);
                }
             }
          }
        }

        const count = await repo.count({ where: whereCondition });

        // 如果数据库为空或强制刷新且未跳过同步，则进行全量同步
        const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        if (shouldSync) {
          try {
            await syncKubeOvnVpcs(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync VPCs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[VPC-Refresh] 跳过全量同步（创建后刷新），直接查询数据库`);
        }

        const items = await repo.find({ where: whereCondition });
        let list = items.map((i: any) => ({
          ...(i.rawData || {}),
          view: i.view,
        }));

        // [租户过滤] Kube-OVN 资源权限校验
        // 检查 VPC 的 spec.namespaces 字段是否包含租户的命名空间，或是否为公共资源 (cloud-public)。
        if (isTenant) {
          const userNamespaces = tenantNamespace ? tenantNamespace.split(',').map((n) => n.trim()) : [];
          list = list.filter((vpc: any) => {
            const allowed = vpc?.spec?.namespaces || [];
            if (!Array.isArray(allowed)) return false;
            const isAllowed = userNamespaces.some((ns) => allowed.includes(ns));
            const isPublic = allowed.some(
              (n: string) => String(n).toLowerCase() === 'cloud-public',
            );
            return isAllowed || isPublic;
          });
        }

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询VPC失败', error: error.message });
      }
    },
  );

  // [已迁移] POST /:id/resources/vpcs
  router.post(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await createKubeOvnVpc(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          req.body
        );

        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法）
        if (data && data.metadata) {
          try {
            const repo = AppDataSource.getRepository(KubeOvnVpcInventory);
            const entity = repo.create({
              cloudId: cloud.id,
              uid: data.metadata?.uid || '',
              name: data.metadata?.name || '',
              namespace: data.metadata?.namespace,
              status: data.status?.conditions?.[0]?.type || 'Unknown',
              subnets: data.status?.subnets,
              labels: data.metadata?.labels,
              annotations: data.metadata?.annotations,
              rawData: data,
            });
            await repo.save(entity);
          } catch (e: any) {
            console.error('[VPC-Create] 入库失败:', e?.message || e);
          }
        }

        res.json({ message: '创建成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '创建 VPC 失败', error: error.message });
      }
    }
  );

  // [已迁移] DELETE /:id/resources/vpcs/:name
  router.delete(
    '/:id/resources/vpcs/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await deleteKubeOvnVpc(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          name
        );

        res.json({ message: '删除成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '删除 VPC 失败', error: error.message });
      }
    }
  );

  // [已迁移] PUT /:id/resources/vpcs/:name
  router.put(
    '/:id/resources/vpcs/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源更新', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await updateKubeOvnVpc(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          name,
          req.body
        );

        res.json({ message: '更新成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '更新 VPC 失败', error: error.message });
      }
    }
  );

  // [已迁移] GET /:id/resources/subnets
  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { vpcId, force } = req.query as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubeOvnSubnetInventory);

        let whereCondition: any = { cloudId: id };
        let tenantNamespace: string | undefined;
        const isTenantUser =
          (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = {
            tenantId: (req as any).user.tenantId,
            cloudId: id,
            status: 'active',
          };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
          }
          const us = await userSpaceRepo.findOne({ where });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          tenantNamespace = us.namespace;

          // Auto-Fix: Ensure organization namespace is included in UserSpace
          if ((req.user as any).organizationId) {
             const orgNs = `ns-${(req.user as any).organizationId}`;
             const nsList = tenantNamespace ? tenantNamespace.split(',').map((s) => s.trim()).filter(Boolean) : [];
             if (!nsList.includes(orgNs)) {
                nsList.push(orgNs);
                tenantNamespace = nsList.join(',');
                us.namespace = tenantNamespace;
                try {
                   await userSpaceRepo.save(us);
                } catch (e) {
                   console.warn('Failed to auto-update UserSpace namespace', e);
                }
             }
          }
        }

        const count = await repo.count({ where: whereCondition });

        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncKubeOvnSubnets(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Subnets failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const dbItems = await repo.find({ where: whereCondition });
        let list = dbItems.map((i) => i.rawData);

        // [租户过滤] Kube-OVN 子网权限校验
        // 租户只能看到授权给其 Namespace 的子网。
        if (isTenant) {
          const userNamespaces = tenantNamespace ? tenantNamespace.split(',').map((n) => n.trim()) : [];
          list = list.filter((subnet: any) => {
            const allowed = subnet?.spec?.namespaces || [];
            return Array.isArray(allowed) && userNamespaces.some((ns) => allowed.includes(ns));
          });
        }

        let items = list;
        if (vpcId) {
          items = list.filter(
            (s: any) => String(s?.vpc || '').trim() === String(vpcId).trim(),
          );
        }
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询子网失败', error: error.message });
      }
    },
  );

  // [已迁移] GET /:id/resources/harvester/nads
  router.get(
    '/:id/resources/harvester/nads',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtNadInventory);

        let whereCondition: any = { cloudId: id };
        
        // [租户过滤] NAD 可见性控制
        // 租户能看到分配给自己的 Namespace 下的 NAD，以及公共命名空间（default、cloud-public、harvester-public）下的 NAD。
        const isTenantUser =
          (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;
        
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = {
            tenantId: (req as any).user.tenantId,
            cloudId: id,
            status: 'active',
          };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
          }
          const us = await userSpaceRepo.findOne({ where });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          
          if (us.namespace) {
            const allowed = us.namespace.split(',').map((s) => s.trim()).filter(Boolean);
            
            // [自动修复] 确保组织命名空间存在
            if ((req.user as any).organizationId) {
              const orgNs = `ns-${(req.user as any).organizationId}`;
              if (!allowed.includes(orgNs)) {
                allowed.push(orgNs);
                us.namespace = allowed.join(',');
                try {
                  await userSpaceRepo.save(us);
                } catch (e) {
                  console.warn('Failed to auto-update UserSpace namespace', e);
                }
              }
            }
            
            // 使用数组形式的 whereCondition 以支持多个命名空间，并包含公共命名空间
            whereCondition = [
              ...allowed.map((ns) => ({ cloudId: id, namespace: ns })),
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'Cloud-Public' },
              { cloudId: id, namespace: 'harvester-public' },
              { cloudId: id, namespace: 'default' }, // 允许访问 default 命名空间的 NAD
            ];
          } else {
            // 即使 namespace 为空，也允许访问公共命名空间
            whereCondition = [
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'Cloud-Public' },
              { cloudId: id, namespace: 'harvester-public' },
              { cloudId: id, namespace: 'default' },
            ];
          }
        }

        // [缓存策略] 自动同步逻辑
        // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
        // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
        const { force, skipSync } = req.query;
        const count = await repo.count({ where: whereCondition });
        const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        
        if (shouldSync) {
          try {
            await syncHarvesterNads(cloud, insecure);
            console.log(`[NAD-Query] 同步完成，cloudId: ${id}`);
          } catch (e: any) {
            console.warn('Sync NADs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[NAD-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((item: any) => {
          const v = item.rawData || {};
          const name = v?.metadata?.name || item.name || '';
          const namespace = v?.metadata?.namespace || item.namespace || '';
          const displayName = v?.spec?.displayName || item.displayName || name;
          const size = v?.status?.size || item.size || 0;
          const progress = v?.status?.progress || item.progress || 0;
          const storageClassName = v?.spec?.storageClassName || item.storageClassName || '';

          return {
            ...v,
            name,
            namespace,
            displayName,
            size,
            progress,
            storageClassName,
            raw: v,
          };
        });

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询网络附件定义失败', error: error.message });
      }
    },
  );

  // [已迁移] GET /:id/resources/harvester/nads/:namespace/:name
  router.get(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        let path = `/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(
          namespace,
        )}/network-attachment-definitions/${encodeURIComponent(name)}`;

        try {
          const repo = AppDataSource.getRepository(KubevirtNadInventory);
          const item = await repo.findOne({ where: { cloudId: id, namespace, name } });
          if (item?.rawData?.links?.view) {
            const urlObj = new URL(item.rawData.links.view);
            path = urlObj.pathname;
          }
        } catch (e) {}

        const data = await requestJson(
          'GET',
          cloud.endpoint + path,
          cloud.secretKey || '',
          insecure,
        );

        res.json(data);
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '获取网络附件定义详情失败', error: error.message });
      }
    },
  );

  // [已迁移] POST /:id/resources/harvester/nads
  router.post(
    '/:id/resources/harvester/nads',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const namespace = req.body.namespace || req.body.metadata?.namespace;

        if (!namespace) {
          return res.status(400).json({ message: '缺少必要参数: namespace' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        let endpoint = (cloud.endpoint || '').replace(/\/+$/, '');

        if (!endpoint.includes('/k8s/clusters/')) {
          endpoint = endpoint.replace(/\/v[0-9]+(\/harvester)?$/, '');
        }

        const nsEncoded = encodeURIComponent(namespace);

        // [Feature] 平台托管标记 (Platform Managed)
        // 添加 tower.io/managed Finalizer 和 tower.io/creator 标签，与虚拟机保持一致
        const nadPayload = JSON.parse(JSON.stringify(req.body)); // Clone to avoid side effects
        if (!nadPayload.metadata) nadPayload.metadata = {};
        if (!nadPayload.metadata.finalizers) nadPayload.metadata.finalizers = [];
        const managedFinalizer = 'tower.io/managed';
        if (!nadPayload.metadata.finalizers.includes(managedFinalizer)) {
          nadPayload.metadata.finalizers.push(managedFinalizer);
        }
        if (!nadPayload.metadata.labels) nadPayload.metadata.labels = {};
        nadPayload.metadata.labels['tower.io/creator'] = 'compute-tower';

        console.log(
          `[NAD Create] Payload for ${namespace}:`,
          JSON.stringify(nadPayload, null, 2),
        );

        const candidates = [
          `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/network-attachment-definitions`,
          `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/networkattachmentdefinitions`,
          `${endpoint}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`,
          `${endpoint}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
        ];

        let lastError: any = null;
        let success = false;

        // [多路径兼容] 尝试多种 API 路径创建 NAD
        // Harvester 版本差异可能导致 API 路径不同 (K8s 原生 vs Rancher 代理)。
        let createdData: any = null;
        for (const url of candidates) {
          try {
            const data = await requestJson(
              'POST',
              url,
              cloud.secretKey || '',
              insecure,
              nadPayload,
            );
            createdData = data;
            success = true;
            break;
          } catch (innerError: any) {
            const status = Number(innerError.status || 0);
            const msg = String(innerError.message || '');

            if (
              status === 404 ||
              status === 405 ||
              status === 422 ||
              status === 400 ||
              msg.includes('404')
            ) {
              lastError = innerError;
              continue;
            }
            throw innerError;
          }
        }

        if (!success) {
          console.error(
            `[NAD Create Error] All candidates failed. Namespace: ${namespace}. Last Error: ${lastError?.message}`,
          );
          const lastErrorDetail = lastError?.body
            ? ` Details: ${lastError.body}`
            : '';
          throw new Error(
            `Harvester API 404 Not Found. 无法找到有效的创建路径 (尝试了标准K8s API和Rancher API)。请检查命名空间 '${namespace}' 是否存在。${lastErrorDetail}`,
          );
        }

        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
        if (createdData && createdData.metadata) {
          try {
            const repo = AppDataSource.getRepository(KubevirtNadInventory);
            const uid = createdData.metadata?.uid || createdData.id || '';
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            
            if (existing) {
              // 更新现有记录
              existing.name = createdData.metadata?.name || '';
              existing.namespace = createdData.metadata?.namespace || namespace;
              existing.links = createdData.links;
              existing.config = createdData.spec?.config;
              try {
                existing.type = JSON.parse(createdData.spec?.config || '{}').type;
              } catch {
                existing.type = undefined;
              }
              existing.labels = createdData.metadata?.labels;
              existing.annotations = createdData.metadata?.annotations;
              existing.rawData = createdData;
              await repo.save(existing);
              console.log(`[NAD-Create] 网络已更新，cloudId: ${cloud.id}, name: ${createdData.metadata?.name}`);
            } else {
              // 插入新记录
              const entity = repo.create({
                cloudId: cloud.id,
                uid: uid,
                name: createdData.metadata?.name || '',
                namespace: createdData.metadata?.namespace || namespace,
                links: createdData.links,
                config: createdData.spec?.config,
                type: (() => {
                  try {
                    return JSON.parse(createdData.spec?.config || '{}').type;
                  } catch {
                    return undefined;
                  }
                })(),
                labels: createdData.metadata?.labels,
                annotations: createdData.metadata?.annotations,
                rawData: createdData,
              });
              await repo.save(entity);
              console.log(`[NAD-Create] 网络已入库，cloudId: ${cloud.id}, name: ${createdData.metadata?.name}`);
            }
          } catch (e: any) {
            console.error('[NAD-Create] 入库网络失败:', e?.message || e);
            // 入库失败不影响创建操作的成功返回
          }
        }

        res.json({ message: '创建成功', data: createdData });
      } catch (error: any) {
        const rawError = error.body || error.message;
        res
          .status(500)
          .json({ message: '创建网络附件定义失败', error: rawError });
      }
    },
  );

  // [已迁移] DELETE /:id/resources/harvester/nads/:namespace/:name
  router.delete(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        let endpoint = (cloud.endpoint || '').replace(/\/+$/, '');
        if (!endpoint.includes('/k8s/clusters/')) {
          endpoint = endpoint.replace(/\/v[0-9]+(\/harvester)?$/, '');
        }
        const nsEncoded = encodeURIComponent(namespace);

        const candidates = [
          `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/network-attachment-definitions/${name}`,
          `${endpoint}/apis/k8s.cni.cncf.io/v1/namespaces/${nsEncoded}/networkattachmentdefinitions/${name}`,
          `${endpoint}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions/${namespace}/${name}`,
          `${endpoint}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions/${namespace}/${name}`,
        ];

        const managedFinalizer = 'tower.io/managed';
        for (const url of candidates) {
          if (!url.includes('/apis/k8s.cni.cncf.io/')) continue;
          try {
            const current = await getJsonOnce(
              url,
              cloud.secretKey || '',
              insecure,
            );
            const finalizers = current?.metadata?.finalizers;
            if (!Array.isArray(finalizers) || !finalizers.includes(managedFinalizer)) {
              continue;
            }
            const indicesToRemove = finalizers
              .map((f: any, i: number) => (f === managedFinalizer ? i : -1))
              .filter((i: number) => i >= 0)
              .sort((a: number, b: number) => b - a);
            if (indicesToRemove.length > 0) {
              const patchOps = indicesToRemove.map((index: number) => ({
                op: 'remove',
                path: `/metadata/finalizers/${index}`,
              }));
              await requestJson(
                'PATCH',
                url,
                cloud.secretKey || '',
                insecure,
                patchOps,
                { 'Content-Type': 'application/json-patch+json' },
              );
            }
          } catch {}
        }

        let lastError: any = null;
        let success = false;

        // [多路径兼容] 尝试多种 API 路径删除 NAD
        // Harvester 版本差异可能导致 API 路径不同 (K8s 原生 vs Rancher 代理)。
        for (const url of candidates) {
          try {
            await requestJson('DELETE', url, cloud.secretKey || '', insecure);
            success = true;
            break;
          } catch (e: any) {
            lastError = e;
          }
        }

        if (success) {
          syncHarvesterNads(cloud, insecure).catch((e) =>
            console.error('Background sync failed', e),
          );
          return res.json({ message: '删除成功' });
        }

        const rawError = lastError?.body || lastError?.message || '未知错误';
        res.status(500).json({ message: '删除失败', error: rawError });
      } catch (error: any) {
        res.status(500).json({ message: '删除失败', error: error.message });
      }
    },
  );

  // [已迁移] GET /:id/resources/harvester/services
  router.get(
    '/:id/resources/harvester/services',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterServiceInventory);
        const whereCondition: any = { cloudId: id };

        // [租户过滤] 检查租户权限
        // 如果是租户用户，必须先确认其 UserSpace 是否存在且激活。
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
        }

        const count = await repo.count({ where: whereCondition });

        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterServices(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Services failed, falling back', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        let list = items.map((i) => i.rawData);

        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (us?.namespace) {
            const allowed = us.namespace.split(',').map((s) => s.trim());
            list = list.filter((svc: any) =>
              allowed.includes(svc?.metadata?.namespace),
            );
          }
        }

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询服务失败', error: error.message });
      }
    },
  );

  */
};
