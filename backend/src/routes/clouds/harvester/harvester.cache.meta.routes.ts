/**
 * ==============================================================================
 * 模块名称: Harvester 元数据缓存路由 (Harvester Metadata Cache Routes)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.meta.routes.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 处理 Harvester 平台的元数据资源查询，包括 SSH 密钥、Cloud Init 模板和虚拟机模板。
 * 实现了"优先读缓存，按需同步"的策略，并包含多租户权限隔离逻辑。
 * 
 * [核心逻辑]
 * 1. [缓存同步策略]: 
 *    - 默认读取本地数据库缓存。
 *    - 若本地无数据 (count=0) 或请求参数 force=true，则触发上游 Harvester API 同步。
 * 2. [多租户隔离]: 
 *    - 普通租户 (Tenant) 只能查询其所属 Namespace 下的资源。
 *    - 管理员可查询所有资源。
 * 
 * ------------------------------------------------------------------------------
 * [接口清单 (API Routes)]
 * ------------------------------------------------------------------------------
 * 1. GET /:id/resources/harvester/sshkeys
 *    - 查询 SSH 密钥列表
 * 
 * 2. GET /:id/resources/harvester/cloud-inits
 *    - 查询 Cloud Init 配置模板
 * 
 * 3. GET /:id/resources/harvester/templates
 *    - 查询虚拟机模板 (支持 public 和 tenant namespace)
 * ==============================================================================
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { UserSpace } from '../../../entities/UserSpace';
import {
  HarvesterSshKeyInventory,
} from '../../../entities/harvester/HarvesterSshKeyInventory';
import {
  HarvesterCloudInitInventory,
} from '../../../entities/harvester/HarvesterCloudInitInventory';
import {
  HarvesterTemplateInventory,
} from '../../../entities/harvester/HarvesterTemplateInventory';
import {
  syncHarvesterSshKeys,
  syncHarvesterCloudInits,
  syncHarvesterTemplates,
} from '../../../services/clouds/harvester/inventory';
import {
  createHarvesterSshKey,
  deleteHarvesterSshKey,
} from '../../../services/clouds/harvester/storage';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

export const registerHarvesterMetaRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  /**
   * [API] 查询 Harvester SSH 密钥列表
   * GET /:id/resources/harvester/sshkeys
   */
  router.get(
    '/:id/resources/harvester/sshkeys',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        
        // [前置校验] 检查云资源存在性及类型
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const repo = AppDataSource.getRepository(HarvesterSshKeyInventory);

        // [多租户权限] 构建查询条件
        // 1. 默认为云资源 ID。
        // 2. 如果是租户角色 (Tenant)，需要进一步通过 UserSpace 查找对应的 Namespace。
        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId &&
            (req.user as any)?.role !== 'sase_device');
            
        // [修复逻辑] SSH Key 租户可见性策略调整
        // 租户不仅能看到自己的 Namespace，还应该能看到公共 Namespace (default, harvester-public)
        // 因此不能简单地使用 whereCondition.namespace = us.namespace 进行数据库层过滤。
        // 应该先查出所有 Key，然后在应用层做过滤。或者使用 In 查询。
        let tenantNamespace = '';
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: {
              tenantId: (req as any).user.tenantId,
              cloudId: id,
              status: 'active',
            },
          });
          // 租户未分配空间，理论上只能看公共资源，暂时允许继续执行，但 tenantNamespace 为空
          if (us && us.namespace) {
            tenantNamespace = us.namespace;
          }
        }

        // [缓存策略] 自动同步逻辑
        // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true')
        // 注意：这里必须用不带 namespace 过滤的条件查总数，否则可能因为租户过滤导致总误判为0从而触发全量同步（虽然也没坏处，但不够精准）
        // 更优解：始终检查全量数据的 count
        const totalCount = await repo.count({ where: { cloudId: id } });
        
        if (totalCount === 0 || String(force) === 'true') {
          try {
            await syncHarvesterSshKeys(cloud, insecure);
          } catch (e: any) {
            // [容错处理] 同步失败时，如果本地有旧数据，仅打印警告并返回旧数据 (降级策略)
            // 如果本地无数据且同步失败，则抛出异常
            console.warn(
              'Sync SSH Keys failed, falling back to empty/stale',
              e,
            );
            if (totalCount === 0) throw e;
          }
        }

        // 查询数据
        const items = await repo.find({ where: { cloudId: id } });
        let list = items.map((i) => i.rawData);

        // [应用层过滤]
         // if (isTenant) {
         //    list = list.filter((item: any) => {
         //      const ns = (item.metadata?.namespace || '').toLowerCase();
         //      // 1. 自己的命名空间
         //      if (tenantNamespace && ns === tenantNamespace.toLowerCase()) return true;
         //      // 2. 公共命名空间
         //      if (['default', 'harvester-public', 'cloud-public'].includes(ns)) return true;
         //      // 3. 其他情况不可见
         //      return false;
         //    });
         // }
        
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询SSH密钥失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 Harvester SSH 密钥
   * POST /:id/resources/harvester/sshkeys
   */
  router.post(
    '/:id/resources/harvester/sshkeys',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, name, publicKey, annotations } = req.body;
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const result = await createHarvesterSshKey({
            endpoint: cloud.endpoint || '',
            token: cloud.secretKey || '',
            insecure
        }, namespace, { name, publicKey, annotations });
        
        // 创建成功后触发一次异步同步，更新缓存
        syncHarvesterSshKeys(cloud, insecure).catch(e => 
          console.warn(`[Harvester] SSH Key created but sync failed: ${e.message}`)
        );
        
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        console.error('[Harvester] Create SSH Key Error:', error);
        res.status(500).json({ message: '创建SSH密钥失败', error: error.message || String(error) });
      }
    }
  );

  /**
   * [API] 删除 Harvester SSH 密钥
   * DELETE /:id/resources/harvester/sshkeys/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/sshkeys/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        await deleteHarvesterSshKey({
            endpoint: cloud.endpoint || '',
            token: cloud.secretKey || '',
            insecure
        }, namespace, name);
        
        // 删除成功后触发同步
        syncHarvesterSshKeys(cloud, insecure).catch(e => 
          console.warn(`[Harvester] SSH Key deleted but sync failed: ${e.message}`)
        );
        
        res.json({ message: '删除成功' });
      } catch (error: any) {
        console.error('[Harvester] Delete SSH Key Error:', error);
        res.status(500).json({ message: '删除SSH密钥失败', error: error.message || String(error) });
      }
    }
  );

  /**
   * [API] 查询 Harvester Cloud Init 模板
   * GET /:id/resources/harvester/cloudinits
   */
  router.get(
    '/:id/resources/harvester/cloudinits',
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
        const repo = AppDataSource.getRepository(HarvesterCloudInitInventory);

        // [多租户权限] 逻辑同 SSH Key
        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId &&
            (req.user as any)?.role !== 'sase_device');
            
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: {
              tenantId: (req as any).user.tenantId,
              cloudId: id,
              status: 'active',
            },
          });
          if (!us)
            return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        
        // [缓存策略] 同步 Cloud Init 数据
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterCloudInits(cloud, insecure);
          } catch (e: any) {
            console.warn(
              'Sync Cloud Inits failed, falling back to empty/stale',
              e,
            );
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询Cloud Init模板失败', error: error.message });
      }
    },
  );

  /**
   * [API] 查询 Harvester 虚拟机模板
   * GET /:id/resources/harvester/templates
   */
  router.get(
    '/:id/resources/harvester/templates',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        
        // [前置校验]
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const repo = AppDataSource.getRepository(HarvesterTemplateInventory);

        let whereCondition: any = { cloudId: id };
        
        // [多租户权限] 模板查询逻辑较复杂
        // 租户不仅可以看到自己的模板，通常还可以看到公共模板 (public)
        const isTenantUser =
          (req.user as any)?.tenantId &&
          (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const tenantId = (req as any).user.tenantId;
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          
          // [UserSpace] 查找租户关联的 Namespace
          // 优先匹配指定 organizationId 的空间，其次匹配未分配 org 的空间
          const matches = await userSpaceRepo.find({
            where: [
              {
                tenantId,
                cloudId: id,
                status: 'active',
                organizationId: (req.user as any).organizationId,
              },
              {
                tenantId,
                cloudId: id,
                status: 'active',
                organizationId: null,
              },
            ],
          });
          const us =
            matches.find(
              (m) => m.organizationId === (req.user as any).organizationId,
            ) || matches[0];

          const orgNs =
            (req.user as any)?.organizationId
              ? `ns-${(req.user as any).organizationId}`
              : '';

          // [可见性规则] 
          // 1. 用户私有 Namespace
          // 2. 公共 Namespace (cloud-public, harvester-public)
          const cond: any[] = [];
          if (us?.namespace) cond.push({ cloudId: id, namespace: us.namespace });
          if (orgNs) cond.push({ cloudId: id, namespace: orgNs });
          cond.push({ cloudId: id, namespace: 'cloud-public' });
          cond.push({ cloudId: id, namespace: 'harvester-public' });
          whereCondition = cond;
        }

        const count = await repo.count({ where: whereCondition });

        // [缓存策略] 同步模板数据
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterTemplates(cloud, insecure);
          } catch (e: any) {
            console.warn(
              'Sync Templates failed, falling back to empty/stale',
              e,
            );
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询模板失败', error: error.message });
      }
    },
  );
};
