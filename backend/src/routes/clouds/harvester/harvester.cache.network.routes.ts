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
import { KubeOvnIngressInventory } from '../../../entities/kubeovn/KubeOvnIngressInventory';
import {
  syncHarvesterClusterNetworks,
  syncHarvesterNads,
  syncKubeOvnVpcs,
  syncKubeOvnSubnets,
  syncHarvesterServices,
  syncHarvesterIngresses,
} from '../../../services/clouds/harvester/inventory';
import { requestJson } from '../../../services/clouds/harvester/utils';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

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
 * 1. GET /:id/resources/cluster_networks
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
 * 
 * 9. GET /:id/resources/harvester/ingresses
 *    - 获取路由 (Ingress) 列表 (支持租户过滤)。
 * ==============================================================================
 */
export const registerHarvesterNetworkRoutes = (router: Router, checkAdminPermission: any) => {
  router.get(
    '/:id/resources/cluster_networks',
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

  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
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

        if (count === 0 || String(force) === 'true') {
          try {
            await syncKubeOvnVpcs(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync VPCs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
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

  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
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

  router.get(
    '/:id/resources/harvester/nads',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtNadInventory);

        let whereCondition: any = { cloudId: id };
        
        // [租户过滤] NAD 可见性控制
        // 租户仅能看到分配给自己的 Namespace 下的 NAD。
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) {
            whereCondition.namespace = us.namespace;
          }
        }

        const count = await repo.count({ where: whereCondition });

        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterNads(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync NADs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
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

        console.log(
          `[NAD Create] Payload for ${namespace}:`,
          JSON.stringify(req.body, null, 2),
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
        for (const url of candidates) {
          try {
            const data = await requestJson(
              'POST',
              url,
              cloud.secretKey || '',
              insecure,
              req.body,
            );
            res.json({ message: '创建成功', data });
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
      } catch (error: any) {
        const rawError = error.body || error.message;
        res
          .status(500)
          .json({ message: '创建网络附件定义失败', error: rawError });
      }
    },
  );

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

  router.get(
    '/:id/resources/harvester/ingresses',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubeOvnIngressInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        
        // [租户过滤] 命名空间隔离
        // 租户仅能查看其 UserSpace 中定义命名空间下的 Ingress 资源。
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        
        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterIngresses(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Ingresses failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询路由(Ingress)失败', error: error.message });
      }
    },
  );
};
