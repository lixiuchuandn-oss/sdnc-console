import type { Request, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { Organization } from '../../entities/Organization';
import { ResourcePoolAssignment } from '../../entities/ResourcePoolAssignment';
import { UserSpace } from '../../entities/UserSpace';
import { UserSpaceAllocation } from '../../entities/UserSpaceAllocation';
import { VpcNetwork } from '../../entities/VpcNetwork';
import { listKubevirtVMsRawWithMeta } from '../../services/clouds/harvester/client';
import { listHarvesterPVCRaw } from '../../services/clouds/harvester/storage';
import { getPublicNamespaceNameSetForUnbind } from '../../services/clouds/harvester/publicNamespaces';
import { isIamCrdTargetCloud } from '../../services/iam/iamCrdCloud';
import { syncIamOnResourcePoolUnbind } from '../../services/iam/iamCrdSync';
import {
  UNBIND_RESOURCE_POOL_HAS_RESOURCES_MSG,
  deleteHarvesterTenantNamespacesOnOrgUnbind,
  isHarvesterLikeCloudProvider,
  isKubeVirtOrInfraPod,
  kubeOvnInventoryVpcConflictRows,
  kubePodWorkloadDisplayName,
  kubeTowerAliasDisplay,
  listK8sPodsClusterWideRaw,
  mergeVpcUnbindRowsByName,
  podLooksLikeDatabase,
  type VpcUnbindConflictRow,
} from './tenantKubeUnbind';
import { tenantLog } from './tenantRouteLogger';

const RESOURCE_CHECK_TIMEOUT_MS = 15000;

/** DELETE /organizations/:orgId/resource-pools/:poolId */
export async function handleDeleteOrganizationResourcePool(req: Request, res: Response): Promise<void> {
  try {
    const { orgId, poolId } = req.params;

    const userSpaceRepository = AppDataSource.getRepository(UserSpace);
    const allocationRepository = AppDataSource.getRepository(UserSpaceAllocation);
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);

    const userSpace = await userSpaceRepository.findOne({
      where: {
        organizationId: orgId,
        cloudId: poolId,
      },
      relations: ['cloud'],
    });

    if (userSpace) {
      const vpcNetworkRepository = AppDataSource.getRepository(VpcNetwork);
      const vpcRowsForOrgPool = await vpcNetworkRepository.find({
        where: { organizationId: orgId, cloudId: poolId },
      });

      if (userSpace.cloud && userSpace.name) {
        const config = (userSpace.cloud as any).config || {};
        if (isHarvesterLikeCloudProvider(config.provider)) {
          const namespaces = userSpace.namespace
            ? userSpace.namespace.split(',').map((s) => s.trim()).filter(Boolean)
            : [userSpace.name];

          const publicNamespacesSet = await getPublicNamespaceNameSetForUnbind(userSpace.cloudId);
          const tenantNamespaces = namespaces.filter((ns: string) => !publicNamespacesSet.has(ns));
          const hasPublicNamespace = namespaces.some((ns: string) => publicNamespacesSet.has(ns));

          if (tenantNamespaces.length === 0) {
            tenantLog.debug(
              `Unbind: skip cluster resource scan for userSpace ${userSpace.id}: only public namespaces (${namespaces.join(', ')})`,
            );
            const towerVpcRows: VpcUnbindConflictRow[] = vpcRowsForOrgPool.map((v) => ({
              displayName: String(v.name || '').trim() || '—',
              name: v.name,
              cidrBlock: v.cidrBlock,
            }));
            const kubeOvnRows = await kubeOvnInventoryVpcConflictRows(poolId, namespaces);
            const mergedPublicNsVpcs = mergeVpcUnbindRowsByName(towerVpcRows, kubeOvnRows);
            if (mergedPublicNsVpcs.length > 0) {
              res.status(409).json({
                message: UNBIND_RESOURCE_POOL_HAS_RESOURCES_MSG,
                vpcs: mergedPublicNsVpcs,
                vpcCount: mergedPublicNsVpcs.length,
              });
              return;
            }
          } else {
            let activeVms: any[] = [];
            let activeVolumes: any[] = [];
            let podsInTenantNamespaces: any[] = [];

            try {
              const timeoutPromise = new Promise<[null | { items?: any[] }, any[], any[]]>((resolve) => {
                setTimeout(() => {
                  tenantLog.warn(
                    `Unbind: resource check timeout after ${RESOURCE_CHECK_TIMEOUT_MS}ms for userSpace ${userSpace.id}`,
                  );
                  resolve([null, [], []]);
                }, RESOURCE_CHECK_TIMEOUT_MS);
              });

              const endpoint = userSpace.cloud!.endpoint!;
              const token = userSpace.cloud!.secretKey || '';
              const insecure = !!config.ignoreTls;

              const [vmsResult, volumesResult, podsResult] = await Promise.race([
                Promise.all([
                  listKubevirtVMsRawWithMeta({
                    endpoint,
                    token,
                    insecure,
                  }).catch(() => null),
                  listHarvesterPVCRaw({
                    endpoint,
                    token,
                    insecure,
                  }).catch(() => []),
                  listK8sPodsClusterWideRaw(endpoint, token, insecure).catch(() => []),
                ]),
                timeoutPromise,
              ]);

              if (vmsResult && vmsResult.items) {
                activeVms = vmsResult.items.filter(
                  (vm: any) =>
                    vm.metadata?.namespace && tenantNamespaces.includes(vm.metadata.namespace),
                );
              }

              if (Array.isArray(volumesResult)) {
                activeVolumes = volumesResult.filter(
                  (vol: any) =>
                    vol.metadata?.namespace && tenantNamespaces.includes(vol.metadata.namespace),
                );
              }

              if (Array.isArray(podsResult)) {
                podsInTenantNamespaces = podsResult.filter((p: any) => {
                  const ns = p?.metadata?.namespace;
                  if (!ns || !tenantNamespaces.includes(ns)) return false;
                  return !isKubeVirtOrInfraPod(p);
                });
              }
            } catch (e: any) {
              tenantLog.error(
                `Unbind: failed to check resources for userSpace ${userSpace.id}:`,
                e instanceof Error ? e.message : String(e),
              );
              if (hasPublicNamespace) {
                tenantLog.debug(
                  `Unbind: resource check failed but contains public namespace(s), allowing unbind for userSpace ${userSpace.id}`,
                );
              } else {
                const isTimeout = e?.message?.includes('timeout') || e?.message?.includes('超时');
                if (isTimeout) {
                  res.status(504).json({
                    message: '资源检查超时，请稍后重试',
                    error: `系统在 ${RESOURCE_CHECK_TIMEOUT_MS}ms 内无法完成资源检查，可能是资源池连接状态不佳。请检查资源池连接状态后重试，或联系管理员。`,
                  });
                  return;
                }
                res.status(503).json({
                  message: '无法验证资源池状态，请稍后重试',
                  error:
                    '系统无法验证命名空间内的资源使用情况，为安全起见已终止解绑操作。请检查资源池连接状态后重试。',
                });
                return;
              }
            }

            const databasePods = podsInTenantNamespaces.filter(podLooksLikeDatabase);
            const containerPods = podsInTenantNamespaces.filter((p: any) => !podLooksLikeDatabase(p));

            const towerVpcDisplay: VpcUnbindConflictRow[] = vpcRowsForOrgPool.map((v) => ({
              displayName: String(v.name || '').trim() || '—',
              name: v.name,
              cidrBlock: v.cidrBlock,
            }));
            const kubeOvnVpcDisplay = await kubeOvnInventoryVpcConflictRows(
              userSpace.cloudId,
              tenantNamespaces,
            );
            const vpcDisplayRowsMerged = mergeVpcUnbindRowsByName(towerVpcDisplay, kubeOvnVpcDisplay);

            const shouldBlockRemoving =
              activeVms.length > 0 ||
              activeVolumes.length > 0 ||
              containerPods.length > 0 ||
              databasePods.length > 0 ||
              vpcDisplayRowsMerged.length > 0;

            if (shouldBlockRemoving) {
              const vmRows = activeVms.map((vm: any) => ({
                displayName: kubeTowerAliasDisplay(vm.metadata),
                name: vm.metadata?.name || '未知',
                namespace: vm.metadata?.namespace || '未知',
                status: vm.status?.printableStatus || vm.status?.phase || '未知',
              }));
              const volumeRows = activeVolumes.map((vol: any) => ({
                displayName: kubeTowerAliasDisplay(vol.metadata),
                name: vol.metadata?.name || '未知',
                namespace: vol.metadata?.namespace || '未知',
                status: vol.status?.phase || vol.status?.state || '未知',
                size:
                  vol.status?.capacity?.storage ||
                  vol.spec?.resources?.requests?.storage ||
                  '未知',
              }));
              const containerRows = containerPods.map((p: any) => ({
                displayName: kubePodWorkloadDisplayName(p),
                name: p?.metadata?.name || '—',
                namespace: p?.metadata?.namespace || '—',
                status: p.status?.phase || '—',
              }));
              const databaseRows = databasePods.map((p: any) => ({
                displayName: kubePodWorkloadDisplayName(p),
                name: p?.metadata?.name || '—',
                namespace: p?.metadata?.namespace || '—',
                status: p.status?.phase || '—',
              }));

              res.status(409).json({
                message: UNBIND_RESOURCE_POOL_HAS_RESOURCES_MSG,
                vms: vmRows,
                vmCount: activeVms.length,
                volumes: volumeRows,
                volumeCount: activeVolumes.length,
                containers: containerRows,
                containerCount: containerRows.length,
                databases: databaseRows,
                databaseCount: databaseRows.length,
                vpcs: vpcDisplayRowsMerged,
                vpcCount: vpcDisplayRowsMerged.length,
              });
              return;
            }
          }

          const poolToken =
            config.token ||
            config.apiToken ||
            userSpace.cloud.secretKey ||
            userSpace.cloud.accessKey ||
            '';
          const poolEndpoint = userSpace.cloud.endpoint || config.endpoint;
          const poolInsecure = !!(config.ignoreTls ?? config.insecure);
          if (poolEndpoint && poolToken) {
            await deleteHarvesterTenantNamespacesOnOrgUnbind({
              endpoint: poolEndpoint,
              token: poolToken,
              insecure: poolInsecure,
              cloudId: poolId,
              organizationId: orgId,
              namespaceCsv: userSpace.namespace ?? null,
              fallbackName: userSpace.name,
            });
          } else {
            tenantLog.warn(
              `Unbind: cloud ${userSpace.cloudId} missing endpoint/token; skipping namespace deletion on cluster`,
            );
          }
        } else if (vpcRowsForOrgPool.length > 0) {
          const vpcDisplayList = vpcRowsForOrgPool.map((v) => ({
            displayName: String(v.name || '').trim() || '—',
            name: v.name,
            cidrBlock: v.cidrBlock,
          }));
          res.status(409).json({
            message: UNBIND_RESOURCE_POOL_HAS_RESOURCES_MSG,
            vpcs: vpcDisplayList,
            vpcCount: vpcDisplayList.length,
          });
          return;
        }
      }

      const allocations = await allocationRepository.find({
        where: { userSpaceId: userSpace.id },
      });
      if (allocations.length > 0) {
        await allocationRepository.remove(allocations);
      }

      const cloudForCrd = userSpace.cloud;
      const tenantIdForCrd = userSpace.tenantId;
      const userSpaceIdForCrd = userSpace.id;

      await userSpaceRepository.remove(userSpace);

      if (cloudForCrd && isIamCrdTargetCloud(cloudForCrd)) {
        try {
          const organizationRepository = AppDataSource.getRepository(Organization);
          const organizations = await organizationRepository.find({
            where: { tenantId: tenantIdForCrd },
          });
          const remainingOnCloud = await userSpaceRepository.count({
            where: { tenantId: tenantIdForCrd, cloudId: poolId },
          });
          await syncIamOnResourcePoolUnbind(
            cloudForCrd,
            { id: userSpaceIdForCrd, tenantId: tenantIdForCrd },
            organizations,
            remainingOnCloud,
          );
        } catch (crdError) {
          tenantLog.error(
            '资源池本地已解绑但 IAM CRD 清理失败:',
            crdError instanceof Error ? crdError.message : String(crdError),
          );
        }
      }
    }

    const assignment = await assignmentRepository.findOne({
      where: {
        organizationId: orgId,
        cloudId: poolId,
      },
    });

    if (assignment) {
      await assignmentRepository.remove(assignment);
    }

    if (!userSpace && !assignment) {
      res.status(404).json({ message: '资源池分配记录不存在' });
      return;
    }

    res.json({ message: '资源池分配已移除' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    tenantLog.error('移除资源池分配失败:', detail);
    res.status(500).json({
      message: '移除资源池分配失败',
      error: detail,
    });
  }
}
