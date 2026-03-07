import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { In } from 'typeorm';
import { HarvesterNamespaceInventory } from '../../../entities/harvester/HarvesterNamespaceInventory';
import { HarvesterNamespace } from '../../../entities/harvester/HarvesterNamespace';
import { UserSpace } from '../../../entities/UserSpace';
import { syncHarvesterNamespaces } from '../../../services/clouds/harvester/inventory';
import { isProtectedNamespace } from '../../../services/clouds/harvester/namespace';
import { requestJson, getJsonOnce } from '../../../services/clouds/harvester/utils';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

/**
 * ==============================================================================
 * 组件名称: Harvester 命名空间管理 (Harvester Namespace Management)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.namespace.routes.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 负责 Harvester 平台命名空间 (Namespace) 的增删改查操作。
 * 实现了本地数据库缓存读取与远程实时同步的结合，并强制执行多租户隔离策略。
 * 
 * [核心逻辑]
 * 1. [查询列表]: 
 *    - 优先读取本地数据库 (HarvesterNamespaceInventory)。
 *    - 支持 force=true 强制触发远程同步。
 *    - 租户视图下，自动过滤仅展示 UserSpace 授权的命名空间。
 * 2. [租户隔离]: 
 *    - 租户用户仅能访问 UserSpace 中定义的 namespace。
 *    - 自动修复逻辑：确保租户的 UserSpace 包含其 Organization 对应的默认命名空间。
 * 3. [多路径兼容]: 
 *    - 写操作 (POST/PATCH/DELETE) 尝试多种 API 路径格式，以兼容不同版本的 Harvester/Rancher 代理环境。
 * 
 * ------------------------------------------------------------------------------
 * [API 接口说明]
 * ------------------------------------------------------------------------------
 * 1. GET /:id/resources/harvester/namespaces
 *    - 查询命名空间列表 (支持分页/过滤)。
 * 
 * 2. GET /:id/resources/harvester/namespaces/:name
 *    - 查询单个命名空间详情。
 * 
 * 3. PATCH /:id/resources/harvester/namespaces/:name
 *    - 更新命名空间 (支持 Merge Patch)。
 * 
 * 4. POST /:id/resources/harvester/namespaces
 *    - 创建命名空间。
 * 
 * 5. DELETE /:id/resources/harvester/namespaces/:name
 *    - 删除命名空间。
 * ==============================================================================
 */
export const registerHarvesterNamespaceRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  router.get(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force, excludeSystem } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId &&
            (req.user as any)?.role !== 'sase_device');
        
        // [租户隔离] 命名空间可见性过滤
        // 1. 租户只能看到分配给自己的 Namespace (UserSpace.namespace)。
        // 2. 包含自动修复逻辑：如果租户所属 Organization 的 Namespace 不在列表中，自动添加并更新 DB。
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const userOrgId = (req.user as any).organizationId;
          const whereClause: any[] = [];

          // [UserSpace Query] 查询当前用户所属组织的 UserSpace 记录（组织隔离）
          // 组织级用户：只查询 organizationId = userOrgId 的记录
          // 租户级用户（无 organizationId）：查询 organizationId = null 的记录
          if (userOrgId) {
            whereClause.push({
              tenantId: (req.user as any).tenantId,
              cloudId: id,
              status: 'active',
              organizationId: userOrgId, // 严格限制：只查询当前组织的 UserSpace
            });
          } else {
            whereClause.push({
              tenantId: (req.user as any).tenantId,
              cloudId: id,
              status: 'active',
              organizationId: null, // 租户级用户：查询租户级的 UserSpace
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
        // 如果本地数据库为空，或者用户显式请求 force=true，则触发远程同步。
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterNamespaces(cloud, insecure);
          } catch (e: any) {
            console.warn(
              'Sync Namespaces failed, falling back to empty/stale',
              e,
            );
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
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
        res
          .status(500)
          .json({ message: '查询命名空间失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        
        // 禁止删除系统或公共命名空间
        if (isProtectedNamespace(name)) {
          return res.status(403).json({ message: '禁止删除系统或公共命名空间' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
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
        res
          .status(500)
          .json({ message: '查询命名空间详情失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源更新')) return;
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

        res.json({ message: '更新成功', data: json });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '更新命名空间失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建')) return;
        
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
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '创建命名空间失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
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
            res
              .status(409)
              .send(
                `不能删除此命名空间，因为存在虚拟机 ${names
                  .slice(0, 5)
                  .join('，')}${names.length > 5 ? ' 等' : ''}`,
              );
            return;
          }
        } catch (e: any) {
          console.warn('[DeleteNamespace] VM usage check failed:', e?.message || e);
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
        res
          .status(500)
          .json({ message: '删除命名空间失败', error: error.message });
      }
    },
  );
};
