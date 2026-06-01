import { logger } from '../../utils/logger';
import { Cloud } from '../../entities/Cloud';
import { Organization } from '../../entities/Organization';
import { Tenant } from '../../entities/Tenant';
import { UserSpace } from '../../entities/UserSpace';
import { assertIamCrdTargetCloud, isIamCrdTargetCloud } from './iamCrdCloud';
import {
  deleteOrganizationCrd,
  deleteTenantCrd,
  deleteUserSpaceCrd,
  upsertOrganizationCrd,
  upsertTenantCrd,
  upsertUserSpaceCrd,
} from './iamCrdClient';

const iamLog = logger.child('iam-crd');

export type IamCrdSyncResult =
  | { synced: false; reason: 'skipped' }
  | { synced: true; cloudId: string; cloudName: string };

/**
 * 组织绑定 Cloudmap/Harvester 资源池时：向该资源池集群写入 Tenant、Organization、UserSpace CRD。
 * metadata.name 与 Tower SQLite 主键（UUID）对齐，便于库丢失后从底座回扫。
 */
export async function syncIamOnResourcePoolBind(
  cloud: Cloud,
  tenant: Tenant,
  organizations: Organization[],
  userSpace: UserSpace,
): Promise<IamCrdSyncResult> {
  if (!isIamCrdTargetCloud(cloud)) {
    return { synced: false, reason: 'skipped' };
  }

  assertIamCrdTargetCloud(cloud);

  await upsertTenantCrd(cloud, {
    id: tenant.id,
    name: tenant.name,
    description: tenant.description,
    status: tenant.status,
    rootOrganizationId: tenant.rootOrganizationId,
  });

  for (const org of organizations) {
    await upsertOrganizationCrd(cloud, {
      id: org.id,
      name: org.name,
      description: org.description,
      level: org.level,
      orderIndex: org.orderIndex,
      tenantId: org.tenantId,
      parentId: org.parentId,
      status: org.status,
    });
  }

  await upsertUserSpaceCrd(cloud, {
    id: userSpace.id,
    name: userSpace.name,
    description: userSpace.description,
    tenantId: userSpace.tenantId,
    organizationId: userSpace.organizationId,
    cloudId: userSpace.cloudId,
    namespace: userSpace.namespace,
    permissions: userSpace.permissions,
    cpuQuota: userSpace.cpuQuota,
    memoryQuota: userSpace.memoryQuota,
    storageQuota: userSpace.storageQuota,
    status: userSpace.status,
  });

  iamLog.info(
    `租户 ${tenant.name} 绑定资源池 ${cloud.name}：IAM CRD 已同步（UserSpace ${userSpace.id}）`,
  );
  return { synced: true, cloudId: cloud.id, cloudName: cloud.name };
}

/** 解除资源池绑定时：删除 UserSpace CR；若该租户在此池上已无其它绑定，则清理 Tenant/Organization CR。 */
export async function syncIamOnResourcePoolUnbind(
  cloud: Cloud,
  userSpace: Pick<UserSpace, 'id' | 'tenantId'>,
  organizations: Organization[],
  remainingUserSpacesOnCloud: number,
): Promise<IamCrdSyncResult> {
  if (!isIamCrdTargetCloud(cloud)) {
    return { synced: false, reason: 'skipped' };
  }

  assertIamCrdTargetCloud(cloud);

  await deleteUserSpaceCrd(cloud, userSpace.id);

  if (remainingUserSpacesOnCloud <= 0) {
    await deleteTenantCrd(cloud, userSpace.tenantId);
    const sortedOrgs = [...organizations].sort((a, b) => b.level - a.level);
    for (const org of sortedOrgs) {
      await deleteOrganizationCrd(cloud, org.id);
    }
    iamLog.info(
      `租户 ${userSpace.tenantId} 在资源池 ${cloud.name} 上已无绑定，已清理 IAM Tenant/Organization CRD`,
    );
  }

  return { synced: true, cloudId: cloud.id, cloudName: cloud.name };
}
