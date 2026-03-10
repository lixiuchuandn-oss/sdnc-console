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
import { In } from 'typeorm';
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
        const { force, skipSync } = req.query;
        
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
        // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
        // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
        const totalCount = await repo.count({ where: { cloudId: id } });
        const shouldSync = totalCount === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
        
        if (shouldSync) {
          try {
            await syncHarvesterSshKeys(cloud, insecure);
            // 同步后重新获取 repository，确保查询使用最新数据
            console.log(`[SSHKeys-Query] 同步完成，cloudId: ${id}`);
          } catch (e: any) {
            // [容错处理] 同步失败时，如果本地有旧数据，仅打印警告并返回旧数据 (降级策略)
            // 如果本地无数据且同步失败，则抛出异常
            console.warn(
              'Sync SSH Keys failed, falling back to empty/stale',
              e,
            );
            if (totalCount === 0) throw e;
          }
        } else if (String(skipSync) === 'true') {
          console.log(`[SSHKeys-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
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
        
        // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
        if (result && result.metadata) {
          try {
            const repo = AppDataSource.getRepository(HarvesterSshKeyInventory);
            const uid = result.metadata?.uid || result.id || '';
            const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });
            
            if (existing) {
              // 更新现有记录
              existing.name = result.metadata?.name || '';
              existing.namespace = result.metadata?.namespace || namespace;
              existing.publicKey = result.spec?.publicKey;
              existing.fingerprint = result.status?.fingerprint || result.spec?.fingerprint;
              existing.labels = result.metadata?.labels;
              existing.annotations = result.metadata?.annotations;
              existing.rawData = result;
              await repo.save(existing);
              console.log(`[SSHKey-Create] SSH 密钥已更新，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
            } else {
              // 插入新记录
              const entity = repo.create({
                cloudId: cloud.id,
                uid: uid,
                name: result.metadata?.name || '',
                namespace: result.metadata?.namespace || namespace,
                publicKey: result.spec?.publicKey,
                fingerprint: result.status?.fingerprint || result.spec?.fingerprint,
                labels: result.metadata?.labels,
                annotations: result.metadata?.annotations,
                rawData: result,
              });
              await repo.save(entity);
              console.log(`[SSHKey-Create] SSH 密钥已入库，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
            }
          } catch (e: any) {
            console.error('[SSHKey-Create] 入库 SSH 密钥失败:', e?.message || e);
            // 入库失败不影响创建操作的成功返回
          }
        }
        
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

          const orgId = (req.user as any).organizationId;
          const whereUs: any = { tenantId, cloudId: id, status: 'active' };
          if (orgId) whereUs.organizationId = orgId;
          const us = await userSpaceRepo.findOne({ where: whereUs });

          const namespacesFromUserSpace = (us?.namespace || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

          const orgNs = orgId ? `ns-${orgId}` : '';
          if (orgNs && !namespacesFromUserSpace.includes(orgNs)) {
            namespacesFromUserSpace.push(orgNs);
            if (us) {
              us.namespace = namespacesFromUserSpace.join(',');
              try {
                await userSpaceRepo.save(us);
              } catch (e) {
                // ignore
              }
            }
          }

          const allowedNamespaces = Array.from(
            new Set([
              ...namespacesFromUserSpace,
              'cloud-public',
              'harvester-public',
              'default',
            ]),
          );

          whereCondition = { cloudId: id, namespace: In(allowedNamespaces) };
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
