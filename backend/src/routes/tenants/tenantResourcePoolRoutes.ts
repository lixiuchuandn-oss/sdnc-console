import { Router } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { HarvesterNamespaceInventory } from '../../entities/harvester/HarvesterNamespaceInventory';
import { Organization } from '../../entities/Organization';
import { ResourcePoolAssignment } from '../../entities/ResourcePoolAssignment';
import { Tenant } from '../../entities/Tenant';
import { UserSpace } from '../../entities/UserSpace';
import { UserSpaceAllocation } from '../../entities/UserSpaceAllocation';
import { AuthRequest } from '../../middleware/auth';
import {
  createHarvesterNamespace,
  isProtectedNamespace,
  patchHarvesterNamespaceMetadata,
} from '../../services/clouds/harvester/client';
import { isIamCrdTargetCloud } from '../../services/iam/iamCrdCloud';
import { syncIamOnResourcePoolBind } from '../../services/iam/iamCrdSync';
import { isHarvesterLikeCloudProvider } from './tenantKubeUnbind';
import { handleDeleteOrganizationResourcePool } from './tenantPoolUnbindHandler';
import { tenantLog } from './tenantRouteLogger';

export function registerTenantResourcePoolRoutes(router: Router): void {
  router.post('/organizations/:orgId/resource-pools', async (req: AuthRequest, res) => {
    try {
      const { orgId } = req.params;
      const { resourcePoolIds, permissions } = req.body;

      const normalizedPoolIds = [
        ...new Set(
          (Array.isArray(resourcePoolIds) ? resourcePoolIds : [])
            .map((id: unknown) => String(id).trim())
            .filter(Boolean),
        ),
      ];
      if (normalizedPoolIds.length === 0) {
        return res.status(400).json({ message: '请选择要分配的资源池' });
      }

      const organizationRepository = AppDataSource.getRepository(Organization);
      const organization = await organizationRepository.findOne({
        where: { id: orgId },
      });

      if (!organization) {
        return res.status(404).json({ message: '组织不存在' });
      }

      const cloudRepository = AppDataSource.getRepository(Cloud);
      const resourcePools = await cloudRepository.find({
        where: { id: In(normalizedPoolIds) },
      });

      if (resourcePools.length !== normalizedPoolIds.length) {
        return res.status(400).json({ message: '部分资源池不存在' });
      }

      const tenantRepository = AppDataSource.getRepository(Tenant);
      const tenant = await tenantRepository.findOne({ where: { id: organization.tenantId } });
      if (!tenant) {
        return res.status(404).json({ message: '租户不存在' });
      }
      const tenantName = tenant.name;

      const tenantOrganizations = await organizationRepository.find({
        where: { tenantId: organization.tenantId },
      });

      const userSpaceRepository = AppDataSource.getRepository(UserSpace);
      const allocationRepository = AppDataSource.getRepository(UserSpaceAllocation);
      const rpaRepository = AppDataSource.getRepository(ResourcePoolAssignment);
      const nsRepo = AppDataSource.getRepository(HarvesterNamespaceInventory);

      const { tenantNamespaceMode, existingTenantNamespace: existingNsBody } = req.body as {
        tenantNamespaceMode?: string;
        existingTenantNamespace?: string;
      };
      const tenantNsMode =
        String(tenantNamespaceMode || 'auto').toLowerCase() === 'existing' ? 'existing' : 'auto';

      let targetNamespace: string | undefined;
      const harvesterPools = resourcePools.filter((c) =>
        isHarvesterLikeCloudProvider((c as any)?.config?.provider),
      );

      const isValidK8sNamespaceName = (n: string) =>
        n.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(n);

      if (harvesterPools.length > 0) {
        const namespacesToCreate: string[] = [];

        if (tenantNsMode === 'existing') {
          const primaryNs = String(existingNsBody || '').trim();
          if (!primaryNs) {
            return res.status(400).json({ message: '请指定要绑定的已有命名空间' });
          }
          if (!isValidK8sNamespaceName(primaryNs)) {
            return res.status(400).json({ message: '命名空间名称格式无效' });
          }

          if (isProtectedNamespace(primaryNs)) {
            return res.status(400).json({
              message:
                '不可绑定系统命名空间或平台预留命名空间（含 default、kube-system、kube-public、cattle-*、fleet-* 等）',
            });
          }

          for (const pool of harvesterPools) {
            const inv = await nsRepo.findOne({
              where: { cloudId: pool.id, name: primaryNs },
            });
            if (!inv) {
              return res.status(400).json({
                message: `命名空间「${primaryNs}」在资源池「${pool.name}」中不存在或未同步，请先同步命名空间`,
              });
            }
            const labels = inv.rawData?.metadata?.labels ?? inv.labels ?? {};
            const sc = String(labels['tower.io/scenario'] ?? '').toLowerCase();
            if (sc === 'public' || sc === 'admin') {
              return res.status(400).json({ message: '不可绑定公共或管理员场景命名空间' });
            }

            const others = await userSpaceRepository.find({
              where: { cloudId: pool.id },
            });
            for (const us of others) {
              if (us.organizationId === orgId) continue;
              const nss = (us.namespace || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              if (nss.includes(primaryNs)) {
                return res.status(400).json({
                  message: `命名空间「${primaryNs}」在资源池「${pool.name}」上已被其他组织绑定`,
                });
              }
            }
          }

          namespacesToCreate.push(primaryNs);
        } else {
          namespacesToCreate.push(`ns-${orgId}`);
        }

        targetNamespace = namespacesToCreate.join(',');

        tenantLog.debug(
          `Harvester/Cloudmap 资源池需确保 Namespace: ${namespacesToCreate.join(', ')}`,
        );

        for (const pool of harvesterPools) {
          try {
            const config = (pool as any).config || {};
            const token = config.token || config.apiToken || pool.secretKey || pool.accessKey;
            const endpoint = pool.endpoint || config.endpoint;
            const insecure =
              config.insecure !== undefined
                ? config.insecure
                : config.ignoreTls !== undefined
                  ? config.ignoreTls
                  : false;

            if (endpoint && token) {
              for (const ns of namespacesToCreate) {
                const scenario = 'tenant' as const;
                const annotations = {
                  'tower.io/tenant': tenantName,
                  'tower.io/organization': organization.name,
                };
                const bindingLabels: Record<string, string> = {
                  'tower.io/cloud-id': pool.id,
                  'tower.io/tenant-id': organization.tenantId,
                  'tower.io/organization-id': orgId,
                };

                try {
                  await createHarvesterNamespace({ endpoint, token, insecure }, ns, annotations, {
                    scenario,
                    addFinalizer: true,
                    bindingLabels,
                  });
                  tenantLog.info(
                    `已在资源池 ${pool.name} 中自动创建/确认 Namespace: ${ns} (场景: ${scenario})`,
                  );

                  try {
                    const existing = await nsRepo.findOne({
                      where: { cloudId: pool.id, name: ns },
                    });
                    if (!existing) {
                      await nsRepo.save({
                        cloudId: pool.id,
                        name: ns,
                        rawData: { metadata: { name: ns, uid: 'pending-sync' } },
                      });
                    }
                  } catch (e) {
                    tenantLog.warn(
                      `Failed to update local inventory for namespace ${ns}`,
                      e instanceof Error ? e.message : String(e),
                    );
                  }
                } catch (err: any) {
                  const isConflict =
                    err?.response?.status === 409 ||
                    String(err?.message || '')
                      .toLowerCase()
                      .includes('already exists');
                  if (isConflict) {
                    tenantLog.debug(`Namespace ${ns} 已存在于资源池 ${pool.name}`);
                    try {
                      await patchHarvesterNamespaceMetadata({ endpoint, token, insecure }, ns, {
                        labels: bindingLabels,
                        annotations,
                      });
                    } catch (patchErr: any) {
                      tenantLog.warn(
                        `补齐 Namespace ${ns} 标签/注解失败:`,
                        patchErr instanceof Error ? patchErr.message : String(patchErr),
                      );
                    }
                  } else {
                    tenantLog.warn(
                      `在资源池 ${pool.name} 创建 Namespace ${ns} 失败:`,
                      err instanceof Error ? err.message : String(err),
                    );
                  }
                }
              }
            } else {
              tenantLog.warn(`资源池 ${pool.name} 缺少连接信息，无法自动创建 Namespace`);
            }
          } catch (err: any) {
            tenantLog.warn(
              `处理资源池 ${pool.name} Namespace 时发生错误:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }

      const assignments = [];
      const crdSyncResults: Array<{ cloudId: string; cloudName: string }> = [];
      const permStr = permissions ? JSON.stringify(permissions) : JSON.stringify(['read', 'use']);
      const assignedBy = req.user?.id ? String(req.user.id) : undefined;

      for (const resourcePoolId of normalizedPoolIds) {
        const resourcePool = resourcePools.find((p) => p.id === resourcePoolId);
        if (!resourcePool) continue;

        const existingAssignment = await userSpaceRepository.findOne({
          where: {
            organizationId: orgId,
            cloudId: resourcePoolId,
          },
        });

        if (existingAssignment) {
          tenantLog.info(
            `资源池已绑定到该组织，跳过重复创建: org=${orgId} cloud=${resourcePoolId}`,
          );
          const existingRpa = await rpaRepository.findOne({
            where: { organizationId: orgId, cloudId: resourcePoolId },
          });
          if (!existingRpa) {
            await rpaRepository.save(
              rpaRepository.create({
                organizationId: orgId,
                cloudId: resourcePoolId,
                namespace: existingAssignment.namespace,
                permissions: existingAssignment.permissions || permStr,
                status: 'active',
                cpuQuota: existingAssignment.cpuQuota ?? 0,
                memoryQuota: existingAssignment.memoryQuota ?? 0,
                storageQuota: existingAssignment.storageQuota ?? 0,
                assignedAt: new Date(),
                assignedBy,
              }),
            );
          }
          continue;
        }

        const finalNamespace = targetNamespace || `ns-${orgId}`;

        const userSpace = userSpaceRepository.create({
          name: finalNamespace,
          tenantId: organization.tenantId,
          organizationId: orgId,
          cloudId: resourcePoolId,
          namespace: finalNamespace,
          permissions: permStr,
          status: 'active',
          cpuQuota: 0,
          memoryQuota: 0,
          storageQuota: 0,
        });

        const savedUserSpace = await userSpaceRepository.save(userSpace);
        assignments.push(savedUserSpace);

        await rpaRepository.save(
          rpaRepository.create({
            organizationId: orgId,
            cloudId: resourcePoolId,
            namespace: finalNamespace,
            permissions: permStr,
            status: 'active',
            cpuQuota: 0,
            memoryQuota: 0,
            storageQuota: 0,
            assignedAt: new Date(),
            assignedBy,
          }),
        );

        const allocationTypes: ('cpu' | 'memory' | 'storage')[] = ['cpu', 'memory', 'storage'];
        for (const type of allocationTypes) {
          const allocation = allocationRepository.create({
            userSpaceId: savedUserSpace.id,
            type,
            cpu: 0,
            memory: 0,
            storage: 0,
          });
          await allocationRepository.save(allocation);
        }

        if (isIamCrdTargetCloud(resourcePool)) {
          try {
            const crdSync = await syncIamOnResourcePoolBind(
              resourcePool,
              tenant,
              tenantOrganizations,
              savedUserSpace,
            );
            if (crdSync.synced) {
              crdSyncResults.push({ cloudId: crdSync.cloudId, cloudName: crdSync.cloudName });
            }
          } catch (crdError) {
            await allocationRepository.delete({ userSpaceId: savedUserSpace.id });
            await rpaRepository.delete({ organizationId: orgId, cloudId: resourcePoolId });
            await userSpaceRepository.remove(savedUserSpace);

            const idx = assignments.findIndex((a) => a.id === savedUserSpace.id);
            if (idx >= 0) assignments.splice(idx, 1);

            const detail = crdError instanceof Error ? crdError.message : String(crdError);
            tenantLog.error(
              `资源池 ${resourcePool.name} IAM CRD 同步失败，已回滚本地绑定:`,
              detail,
            );
            return res.status(502).json({
              message: '资源池分配失败：无法同步 IAM CRD 到底座集群',
              error: detail,
              cloudId: resourcePool.id,
              cloudName: resourcePool.name,
            });
          }
        }
      }

      if (assignments.length > 0) {
        tenantLog.debug(`新增 UserSpace 绑定 ${assignments.length} 条`);
      }

      const assignedCount = assignments.length;
      const skippedCount = normalizedPoolIds.length - assignedCount;
      let message = '资源池分配成功';
      if (assignedCount === 0 && skippedCount > 0) {
        message = '所选资源池已与当前组织绑定，未新增记录（请勿重复分配同一资源池）';
      } else if (assignedCount > 0 && skippedCount > 0) {
        message = `资源池分配成功：新增 ${assignedCount}，跳过已绑定 ${skippedCount}`;
      }

      res.json({
        message,
        assignedCount,
        skippedCount,
        crdSync: crdSyncResults.length > 0 ? crdSyncResults : undefined,
      });
    } catch (error) {
      tenantLog.error('资源池分配失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '资源池分配失败' });
    }
  });

  router.get('/organizations/:orgId/resource-pools/occupied-namespaces', async (req, res) => {
    try {
      const { orgId } = req.params;
      const cloudId = String(req.query.cloudId || '').trim();
      if (!cloudId) {
        return res.status(400).json({ message: '缺少查询参数 cloudId' });
      }

      const organizationRepository = AppDataSource.getRepository(Organization);
      const organization = await organizationRepository.findOne({ where: { id: orgId } });
      if (!organization) {
        return res.status(404).json({ message: '组织不存在' });
      }

      const userSpaceRepository = AppDataSource.getRepository(UserSpace);
      const rows = await userSpaceRepository.find({ where: { cloudId } });
      const names = new Set<string>();
      for (const us of rows) {
        if (us.organizationId === orgId) continue;
        const raw = us.namespace || '';
        for (const part of raw.split(',')) {
          const s = part.trim();
          if (s) names.add(s);
        }
      }

      res.json({ names: [...names].sort((a, b) => a.localeCompare(b)) });
    } catch (error) {
      tenantLog.error(
        '获取已占用命名空间失败:',
        error instanceof Error ? error.message : String(error),
      );
      res.status(500).json({ message: '获取已占用命名空间失败' });
    }
  });

  router.get('/organizations/:orgId/resource-pools', async (req, res) => {
    try {
      const { orgId } = req.params;

      tenantLog.debug('获取组织资源池分配请求, orgId:', orgId);
      const userSpaceRepository = AppDataSource.getRepository(UserSpace);
      const assignments = await userSpaceRepository.find({
        where: { organizationId: orgId },
        relations: ['cloud'],
      });

      tenantLog.debug('找到的 UserSpace 记录数量:', assignments.length);
      const normalized = assignments.map((a: any) => {
        const v = a?.permissions;
        let arr: string[] = [];
        if (Array.isArray(v)) {
          arr = v as string[];
        } else if (typeof v === 'string') {
          try {
            const parsed = JSON.parse(v);
            if (Array.isArray(parsed)) arr = parsed as string[];
          } catch {
            /* ignore */
          }
          if (!arr.length) {
            arr = String(v)
              .split(',')
              .map((s: string) => s.trim())
              .filter((s: string) => !!s);
          }
        }
        return { ...a, permissions: arr };
      });
      res.json(normalized);
    } catch (error) {
      tenantLog.error(
        '获取资源池分配失败:',
        error instanceof Error ? error.message : String(error),
      );
      res.status(500).json({ message: '获取资源池分配失败' });
    }
  });

  router.delete(
    '/organizations/:orgId/resource-pools/:poolId',
    handleDeleteOrganizationResourcePool,
  );
}
