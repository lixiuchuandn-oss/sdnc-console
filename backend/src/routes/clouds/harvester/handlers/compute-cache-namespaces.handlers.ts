/**
 * Harvester Namespaces Handlers
 * 
 * 从 harvester.cache.namespace.routes.ts 中提取的 Namespaces 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { In } from 'typeorm';
import { HarvesterNamespaceInventory } from '../../../../entities/harvester/HarvesterNamespaceInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncHarvesterNamespaces } from '../../../../services/clouds/harvester/inventory';
import { isProtectedNamespace } from '../../../../services/clouds/harvester/namespace';
import { requestJson, getJsonOnce } from '../../../../services/clouds/harvester/utils';

/**
 * GET /:id/resources/harvester/namespaces - 获取命名空间列表
 */
export async function harvesterNamespaceListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force, excludeSystem, skipSync } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    let repo = AppDataSource.getRepository(HarvesterNamespaceInventory);

    let whereCondition: any = { cloudId: id };
    const reqAny = req as any;
    const isTenant =
      reqAny.user?.role === 'tenant' ||
      (reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device');
    
    // [租户隔离] 命名空间可见性过滤
    // 1. 租户只能看到分配给自己的 Namespace (UserSpace.namespace)。
    // 2. 包含自动修复逻辑：如果租户所属 Organization 的 Namespace 不在列表中，自动添加并更新 DB。
    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const userOrgId = reqAny.user?.organizationId;
      const whereClause: any[] = [];

      // [UserSpace Query] 查询当前用户所属组织的 UserSpace 记录（组织隔离）
      //
      // 历史兼容：
      // - 早期数据可能把 UserSpace.organizationId 置为 null（租户级），即使用户当前带 organizationId。
      // - 若只按 organizationId 精确匹配，会导致租户"命名空间列表为空"，从而无法创建 VM。
      //
      // 策略：
      // - 若 userOrgId 存在：同时允许读取 organizationId=userOrgId 与 organizationId=null 的 UserSpace 记录。
      // - 若 userOrgId 不存在：仅读取 organizationId=null 的记录。
      if (userOrgId) {
        whereClause.push({
          tenantId: reqAny.user.tenantId,
          cloudId: id,
          status: 'active',
          organizationId: userOrgId,
        });
        whereClause.push({
          tenantId: reqAny.user.tenantId,
          cloudId: id,
          status: 'active',
          organizationId: null,
        });
      } else {
        whereClause.push({
          tenantId: reqAny.user.tenantId,
          cloudId: id,
          status: 'active',
          organizationId: null,
        });
      }

      const matches = await userSpaceRepo.find({ where: whereClause });

      if (!matches || matches.length === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }

      // [Namespace Aggregation] 聚合同一组织内所有 UserSpace 记录的命名空间
      // 注意：不会跨组织聚合，因为查询条件已限制 organizationId
      const uniqueNamespaces = new Set<string>();
      matches.forEach((m) => {
        if (m.namespace) {
          m.namespace.split(',').forEach((ns) => {
            const trimmed = ns.trim();
            if (trimmed) uniqueNamespaces.add(trimmed);
          });
        }
      });

      // Auto-Fix: Ensure organization namespace is included
      if (userOrgId) {
        const orgNs = `ns-${userOrgId}`;
        if (!uniqueNamespaces.has(orgNs)) {
          uniqueNamespaces.add(orgNs);
          // Update the first matching UserSpace record
          const firstMatch = matches.find(m => m.organizationId === userOrgId) || matches[0];
          if (firstMatch) {
            const nsList = Array.from(uniqueNamespaces);
            firstMatch.namespace = nsList.join(',');
            try {
              await userSpaceRepo.save(firstMatch);
            } catch (e) {
              console.warn('Failed to auto-update UserSpace namespace', e);
            }
          }
        }
      }

      if (uniqueNamespaces.size === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }

      whereCondition.name = In(Array.from(uniqueNamespaces));
    }

    const count = await repo.count({ where: whereCondition });

    // [同步策略] 缓存优先 + 按需同步
    // 如果本地数据库为空，则必须触发远程同步
    // 如果用户显式请求 force=true 且 skipSync!=true，则触发远程同步（确保数据最新）
    // skipSync=true 表示创建后刷新，数据已入库，只需查询数据库，无需全量同步
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      try {
        // 如果强制刷新，等待一小段时间确保远程 API 已更新（特别是刚创建的资源）
        if (String(force) === 'true') {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        await syncHarvesterNamespaces(cloud, insecure);
        // 同步完成后，重新获取 repository 实例确保使用最新的数据库连接
        // 注意：对于租户用户，whereCondition 已经包含了授权限制，所以只会返回授权的命名空间
        console.log(`[Namespace-Refresh] 同步完成，whereCondition:`, JSON.stringify(whereCondition));
        // 同步后重新获取 repository，确保查询使用最新数据
        repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
      } catch (e: any) {
        console.warn(
          'Sync Namespaces failed, falling back to empty/stale',
          e,
        );
        if (count === 0) throw e;
      }
    } else if (String(skipSync) === 'true') {
      console.log(`[Namespace-Refresh] 跳过全量同步（创建后刷新），直接查询数据库`);
    }

    const items = await repo.find({ where: whereCondition });
    console.log(`[Namespace-Refresh] 查询结果数量: ${items.length}, whereCondition:`, JSON.stringify(whereCondition));
    let list = items.map((i) => i.rawData);
    
    // [系统命名空间过滤] 如果 excludeSystem=true，过滤掉系统/受保护的命名空间
    if (String(excludeSystem) === 'true') {
      list = list.filter((item: any) => {
        const name = item?.metadata?.name || item?.name || '';
        return !isProtectedNamespace(name);
      });
    }
    
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询命名空间失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/namespaces/:name - 获取命名空间详情
 */
export async function harvesterNamespaceDetailHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, name } = req.params;
    
    // 禁止删除系统或公共命名空间
    if (isProtectedNamespace(name)) {
      return res.status(403).json({ message: '禁止删除系统或公共命名空间' });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
    const item = await repo.findOne({
      where: { cloudId: id, name },
    });

    if (!item || !item.rawData) {
      return res
        .status(404)
        .json({ message: '命名空间不存在或未同步到本地数据库' });
    }

    res.json({ message: '查询成功', data: item.rawData });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询命名空间详情失败', error: error.message });
  }
}

/**
 * PATCH /:id/resources/harvester/namespaces/:name - 更新命名空间
 */
export async function harvesterNamespaceUpdateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const candidates = [
      `${origin}/api/v1/namespaces/${name}`,
      `${origin}/v1/core.v1.namespaces/${name}`,
      `${origin}/v1/harvester/core.v1.namespaces/${name}`,
      `${origin}/k8s/clusters/local/api/v1/namespaces/${name}`,
    ];

    let json: any = null;
    let lastErr: any = null;
    let success = false;
    const patchBody =
      req.body && Object.keys(req.body).length > 0
        ? req.body
        : { metadata: { labels: {} } };

    // [多路径兼容] 尝试多种 API 路径
    // Harvester 版本差异可能导致 API 路径不同 (K8s 原生 vs Rancher 代理)。
    for (const url of candidates) {
      try {
        json = await requestJson(
          'PATCH',
          url,
          cloud.secretKey || '',
          insecure,
          patchBody,
          { 'Content-Type': 'application/merge-patch+json' },
        );
        success = true;
        break;
      } catch (e: any) {
        lastErr = e;
        const status = Number(e?.status || 0);
        // 如果遇到明确的业务错误（非路径错误），则认为是找到了正确的 API Endpoint，只是操作被拒绝
        // 404/405 通常意味着路径不对
        if (status !== 404 && status !== 405 && status !== 0) {
          break;
        }
      }
    }

    if (!success && lastErr) {
      const status = Number(lastErr?.status || 0);
      const lower = String(lastErr?.message || '').toLowerCase();
      let msg = '更新命名空间失败';
      if (status === 403 || lower.includes('forbidden'))
        msg = '更新失败：权限不足（403）';
      else if (status === 404 || lower.includes('not found'))
        msg = '更新失败：命名空间不存在（404）';
      else if (status === 422 || lower.includes('invalid'))
        msg = '更新失败：参数非法（422）';
      return res
        .status(500)
        .json({ message: msg, error: lastErr?.message });
    }

    // [数据同步] 更新成功后立即同步数据库，确保更新后的命名空间数据立即可见
    try {
      await syncHarvesterNamespaces(cloud, insecure);
    } catch (syncErr: any) {
      console.warn('更新命名空间后同步失败，但不影响更新操作:', syncErr);
      // 同步失败不影响更新操作的成功返回
    }

    res.json({ message: '更新成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '更新命名空间失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/namespaces - 创建命名空间
 */
export async function harvesterNamespaceCreateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    
    // [系统命名空间保护] 禁止创建系统/受保护的命名空间
    const namespaceName = req.body?.metadata?.name || req.body?.name;
    if (namespaceName && isProtectedNamespace(namespaceName)) {
      return res.status(403).json({ 
        message: '禁止创建系统或受保护的命名空间',
        error: `命名空间 "${namespaceName}" 是系统命名空间，不能用于用户资源`
      });
    }
    
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const candidates = [
      `${origin}/api/v1/namespaces`,
      `${origin}/v1/core.v1.namespaces`,
      `${origin}/v1/harvester/core.v1.namespaces`,
      `${origin}/k8s/clusters/local/api/v1/namespaces`,
    ];

    let json: any = null;
    let lastErr: any = null;
    let success = false;

    for (const url of candidates) {
      try {
        json = await requestJson(
          'POST',
          url,
          cloud.secretKey || '',
          insecure,
          req.body,
        );
        success = true;
        break;
      } catch (e: any) {
        lastErr = e;
        const status = Number(e?.status || 0);
        // 如果遇到明确的业务错误（非路径错误），则认为是找到了正确的 API Endpoint，只是操作被拒绝
        // 404/405 通常意味着路径不对
        if (status !== 404 && status !== 405 && status !== 0) {
          break;
        }
      }
    }

    if (!success && lastErr) {
      const status = Number(lastErr?.status || 0);
      const lower = String(lastErr?.message || '').toLowerCase();
      let msg = '创建命名空间失败';
      if (status === 403 || lower.includes('forbidden'))
        msg = '创建失败：权限不足（403）';
      else if (status === 409 || lower.includes('already exists'))
        msg = '创建失败：命名空间已存在（409）';
      else if (status === 422 || lower.includes('invalid'))
        msg = '创建失败：参数非法（422）';
      return res
        .status(500)
        .json({ message: msg, error: lastErr?.message });
    }
    
    // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
    if (json && json.metadata) {
      try {
        const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
        const name = json.metadata?.name || '';
        const existing = await repo.findOne({ where: { cloudId: cloud.id, name } });
        
        if (existing) {
          // 更新现有记录
          existing.labels = json.metadata?.labels;
          existing.annotations = json.metadata?.annotations;
          existing.links = json.links;
          existing.rawData = json;
          await repo.save(existing);
          console.log(`[Namespace-Create] 命名空间已更新，cloudId: ${cloud.id}, name: ${name}`);
        } else {
          // 插入新记录
          const entity = repo.create({
            cloudId: cloud.id,
            name: name,
            labels: json.metadata?.labels,
            annotations: json.metadata?.annotations,
            links: json.links,
            rawData: json,
          });
          await repo.save(entity);
          console.log(`[Namespace-Create] 命名空间已入库，cloudId: ${cloud.id}, name: ${name}`);
        }
      } catch (e: any) {
        console.error('[Namespace-Create] 入库命名空间失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
      }
    }
    
    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建命名空间失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/namespaces/:name - 删除命名空间
 */
export async function harvesterNamespaceDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, name } = req.params;
    
    // [安全检查] 禁止删除系统或公共命名空间
    if (isProtectedNamespace(name)) {
      return res.status(403).json({
        message: '禁止删除系统或公共命名空间',
        error: `命名空间 "${name}" 是系统命名空间，受保护无法删除`,
      });
    }
    
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    // [安全检查] 删除命名空间前必须检查是否有虚拟机占用
    // Fail-Safe 策略：如果检查失败，直接终止操作，防止误删
    try {
      const ecsList = await getJsonOnce(
        `${origin}/v1/harvester/kubevirt.io.virtualmachines`,
        cloud.secretKey || '',
        insecure,
      );
      const vms: any[] = Array.isArray(ecsList?.items)
        ? ecsList.items
        : Array.isArray(ecsList?.data)
        ? ecsList.data
        : [];
      const inNs = vms.filter(
        (vm: any) =>
          (vm?.metadata?.namespace || vm?.namespace) === name,
      );
      if (inNs.length > 0) {
        const names = inNs
          .map(
            (vm: any) =>
              vm?.metadata?.annotations?.['tower.io/alias'] ||
              vm?.metadata?.name ||
              vm?.name,
          )
          .filter((n: any) => typeof n === 'string' && n.trim().length > 0);
        return res
          .status(409)
          .json({
            message: `不能删除此命名空间，因为存在虚拟机 ${names
              .slice(0, 5)
              .join('，')}${names.length > 5 ? ' 等' : ''}`,
            error: '命名空间内存在虚拟机，请先删除或迁移虚拟机后再删除命名空间',
          });
      }
    } catch (e: any) {
      // [Fail-Safe] VM 占用检查失败时，直接终止删除操作，防止误删
      console.error('[DeleteNamespace] VM usage check failed:', e?.message || e);
      return res.status(503).json({
        message: '无法完成命名空间删除操作：虚拟机占用检查失败',
        error: '系统无法验证命名空间内是否存在虚拟机，为安全起见已终止删除操作。请检查资源池连接状态后重试。',
        details: e?.message || String(e),
      });
    }
    const candidates = [
      `${origin}/api/v1/namespaces/${name}`,
      `${origin}/v1/core.v1.namespaces/${name}`,
      `${origin}/v1/harvester/core.v1.namespaces/${name}`,
      `${origin}/k8s/clusters/local/api/v1/namespaces/${name}`,
    ];
    let json: any = null;
    let lastErr: any = null;
    let success = false;
    for (const url of candidates) {
      try {
        json = await requestJson(
          'DELETE',
          url,
          cloud.secretKey || '',
          insecure,
        );
        success = true;
        break;
      } catch (e: any) {
        lastErr = e;
        const status = Number(e?.status || 0);
        if (status === 404) {
          success = true;
          break;
        }
        // 遇到非 404/405 的明确错误，停止尝试
        if (status !== 405 && status !== 0) {
          break;
        }
      }
    }
    if (!success && lastErr) {
      return res
        .status(500)
        .json({ message: '删除命名空间失败', error: lastErr?.message });
    }
    res.json({ message: '删除成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除命名空间失败', error: error.message });
  }
}
