/**
 * Harvester Meta Handlers
 * 
 * 从 harvester.cache.meta.routes.ts 中提取的 Meta 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { In } from 'typeorm';
import { UserSpace } from '../../../../entities/UserSpace';
import {
  HarvesterSshKeyInventory,
} from '../../../../entities/harvester/HarvesterSshKeyInventory';
import {
  HarvesterCloudInitInventory,
} from '../../../../entities/harvester/HarvesterCloudInitInventory';
import {
  HarvesterTemplateInventory,
} from '../../../../entities/harvester/HarvesterTemplateInventory';
import {
  syncHarvesterSshKeys,
  syncHarvesterCloudInits,
  syncHarvesterTemplates,
} from '../../../../services/clouds/harvester/inventory';
import {
  buildTenantNamespaceInventoryWhere,
  getPublicScenarioNamespaceNames,
  mergePublicScenarioNamespacesFromQuery,
} from '../../../../services/clouds/harvester/publicNamespaces';
import {
  createHarvesterSshKey,
  deleteHarvesterSshKey,
} from '../../../../services/clouds/harvester/storage';

/**
 * GET /:id/resources/harvester/sshkeys - 获取 SSH 密钥列表
 */
export async function harvesterSshKeyListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force, skipSync } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(HarvesterSshKeyInventory);

    const reqAny = req as any;
    const isTenant =
      reqAny.user?.role === 'tenant' ||
      (reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device');

    // [缓存策略] 自动同步逻辑
    const totalCount = await repo.count({ where: { cloudId: id } });
    const shouldSync = totalCount === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    
    if (shouldSync) {
      try {
        await syncHarvesterSshKeys(cloud, insecure);
        console.log(`[SSHKeys-Query] 同步完成，cloudId: ${id}`);
      } catch (e: any) {
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

    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const orgId = reqAny.user?.organizationId;
      const whereUs: any = { tenantId: reqAny.user.tenantId, cloudId: id, status: 'active' };
      if (orgId) whereUs.organizationId = orgId;
      const us = await userSpaceRepo.findOne({ where: whereUs });
      if (!us) {
        list = [];
      } else {
        const nsFromUs = (us.namespace || '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        const orgNs = orgId ? `ns-${orgId}` : '';
        const merged = new Set(nsFromUs);
        if (orgNs) merged.add(orgNs);
        if (mergePublicScenarioNamespacesFromQuery(req)) {
          (await getPublicScenarioNamespaceNames(id)).forEach((n) => merged.add(n));
        }
        list = list.filter((item: any) => merged.has(String(item?.metadata?.namespace || '').trim()));
      }
    }

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询SSH密钥失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/sshkeys - 创建 SSH 密钥
 */
export async function harvesterSshKeyCreateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id } = req.params;
    const { namespace, name, publicKey, annotations } = req.body;
    
    const insecure = !!(cloud.config as any)?.ignoreTls;
    
    const result = await createHarvesterSshKey({
        endpoint: cloud.endpoint || '',
        token: cloud.secretKey || '',
        insecure
    }, namespace, { name, publicKey, annotations });
    
    // [数据同步] 创建成功后，直接使用返回的数据入库
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
    if (res.headersSent) return;
    console.error('[Harvester] Create SSH Key Error:', error);
    res.status(500).json({ message: '创建SSH密钥失败', error: error.message || String(error) });
  }
}

/**
 * DELETE /:id/resources/harvester/sshkeys/:namespace/:name - 删除 SSH 密钥
 */
export async function harvesterSshKeyDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, name } = req.params;
    
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
    if (res.headersSent) return;
    console.error('[Harvester] Delete SSH Key Error:', error);
    res.status(500).json({ message: '删除SSH密钥失败', error: error.message || String(error) });
  }
}

/**
 * GET /:id/resources/harvester/cloudinits - 获取 Cloud Init 模板列表
 */
export async function harvesterCloudInitListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
    
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(HarvesterCloudInitInventory);

    // [多租户权限] 逻辑同 SSH Key
    let whereCondition: any = { cloudId: id };
    const reqAny = req as any;
    const isTenant =
      reqAny.user?.role === 'tenant' ||
      (reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device');
            
    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const orgId = reqAny.user?.organizationId;
      const whereUs: any = {
        tenantId: reqAny.user.tenantId,
        cloudId: id,
        status: 'active',
      };
      if (orgId) whereUs.organizationId = orgId;
      const us = await userSpaceRepo.findOne({ where: whereUs });
      if (!us) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }
      const allowed = (us.namespace || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      whereCondition = await buildTenantNamespaceInventoryWhere(id, allowed, {
        mergePublicScenarioNamespaces: mergePublicScenarioNamespacesFromQuery(req),
      });
      if (Array.isArray(whereCondition) && whereCondition.length === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }
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
    if (res.headersSent) return;
    res.status(500).json({ message: '查询Cloud Init模板失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/templates - 获取虚拟机模板列表
 */
export async function harvesterTemplateListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force, skipSync } = req.query;
    
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(HarvesterTemplateInventory);

    let whereCondition: any = { cloudId: id };
    
    // [多租户权限] 模板查询逻辑较复杂
    // 租户不仅可以看到自己的模板，通常还可以看到公共模板 (public)
    const reqAny = req as any;
    const isTenantUser =
      reqAny.user?.tenantId &&
      reqAny.user?.role !== 'sase_device';
    const isTenantRole = reqAny.user?.role === 'tenant';
    const isTenant = isTenantUser || isTenantRole;

    if (isTenant) {
      const tenantId = reqAny.user.tenantId;
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);

      const orgId = reqAny.user?.organizationId;
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

      const mergePublic = mergePublicScenarioNamespacesFromQuery(req);
      const allowedNamespaces = Array.from(
        new Set([
          ...namespacesFromUserSpace,
          ...(mergePublic ? await getPublicScenarioNamespaceNames(id) : []),
        ]),
      );

      if (allowedNamespaces.length === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }
      whereCondition = { cloudId: id, namespace: In(allowedNamespaces) };
    }

    const totalCount = await repo.count({ where: { cloudId: id } });
    const shouldSync =
      totalCount === 0 ||
      (String(force) === 'true' && String(skipSync) !== 'true');

    // [缓存策略] 同步模板数据
    if (shouldSync) {
      try {
        await syncHarvesterTemplates(cloud, insecure);
      } catch (e: any) {
        console.warn(
          'Sync Templates failed, falling back to empty/stale',
          e,
        );
        if (totalCount === 0) throw e;
      }
    } else if (String(skipSync) === 'true') {
      console.log(
        `[Templates-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`,
      );
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData);

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询模板失败', error: error.message });
  }
}
