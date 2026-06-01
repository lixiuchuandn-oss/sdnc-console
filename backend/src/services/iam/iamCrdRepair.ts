import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { Organization } from '../../entities/Organization';
import { ResourcePoolAssignment } from '../../entities/ResourcePoolAssignment';
import { Tenant } from '../../entities/Tenant';
import { UserSpace } from '../../entities/UserSpace';
import { UserSpaceAllocation } from '../../entities/UserSpaceAllocation';
import { assertIamCrdTargetCloud } from './iamCrdCloud';
import {
  IAM_ORGANIZATION_PLURAL,
  IAM_TENANT_PLURAL,
  IAM_USER_SPACE_PLURAL,
} from './iamCrdConstants';
import { listIamCrItems } from './iamCrdClient';

type EntityCounter = { created: number; updated: number; skipped: number };

export type TenantCrdRepairResult = {
  cloudId: string;
  cloudName: string;
  tenants: EntityCounter;
  organizations: EntityCounter;
  userSpaces: EntityCounter;
  resourcePoolAssignments: EntityCounter;
  userSpaceAllocations: EntityCounter;
  warnings: string[];
};

function emptyCounter(): EntityCounter {
  return { created: 0, updated: 0, skipped: 0 };
}

function crdRefName(ref: unknown): string {
  if (!ref || typeof ref !== 'object') return '';
  return String((ref as { name?: string }).name || '').trim();
}

function crdPhaseToTenantStatus(phase: unknown): Tenant['status'] {
  const p = String(phase || 'Active');
  if (p === 'Inactive') return 'inactive';
  if (p === 'Suspended') return 'suspended';
  return 'active';
}

function crdPhaseToSimpleStatus(phase: unknown): 'active' | 'inactive' {
  return String(phase || 'Active') === 'Inactive' ? 'inactive' : 'active';
}

function permissionsToDb(raw: unknown): string {
  if (Array.isArray(raw)) {
    return JSON.stringify(raw.map((x) => String(x)));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return JSON.stringify(['read', 'use']);
}

function isUuidLike(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
}

/** 从指定 Cloudmap/Harvester 资源池读取 IAM CRD，回写 Tower SQLite（Tenant / Organization / UserSpace 等）。 */
export async function repairTenantDataFromCloud(cloudId: string): Promise<TenantCrdRepairResult> {
  const cloudRepository = AppDataSource.getRepository(Cloud);
  const cloud = await cloudRepository.findOne({ where: { id: cloudId } });
  if (!cloud) {
    throw Object.assign(new Error('资源池不存在'), { status: 404 });
  }
  assertIamCrdTargetCloud(cloud);

  const [tenantItems, organizationItems, userSpaceItems] = await Promise.all([
    listIamCrItems(cloud, IAM_TENANT_PLURAL),
    listIamCrItems(cloud, IAM_ORGANIZATION_PLURAL),
    listIamCrItems(cloud, IAM_USER_SPACE_PLURAL),
  ]);

  const cloudRefId = cloud.id;
  const scopedUserSpaces = userSpaceItems.filter((item) => {
    const ref = crdRefName(item?.spec?.cloudRef);
    return ref === cloudRefId;
  });

  if (scopedUserSpaces.length === 0) {
    throw Object.assign(
      new Error(`资源池「${cloud.name}」上未发现 Tower 同步的 UserSpace CRD，无可恢复数据`),
      { status: 404 },
    );
  }

  const tenantIds = new Set<string>();
  for (const us of scopedUserSpaces) {
    const tid = crdRefName(us?.spec?.tenantRef);
    if (tid) tenantIds.add(tid);
  }

  const tenantCrById = new Map<string, any>();
  for (const item of tenantItems) {
    const id = String(item?.metadata?.name || '').trim();
    if (id && tenantIds.has(id)) tenantCrById.set(id, item);
  }

  const organizationCrById = new Map<string, any>();
  for (const item of organizationItems) {
    const id = String(item?.metadata?.name || '').trim();
    const tenantRef = crdRefName(item?.spec?.tenantRef);
    if (id && tenantIds.has(tenantRef)) organizationCrById.set(id, item);
  }

  const result: TenantCrdRepairResult = {
    cloudId: cloud.id,
    cloudName: cloud.name,
    tenants: emptyCounter(),
    organizations: emptyCounter(),
    userSpaces: emptyCounter(),
    resourcePoolAssignments: emptyCounter(),
    userSpaceAllocations: emptyCounter(),
    warnings: [],
  };

  await AppDataSource.transaction(async (manager) => {
    const tenantRepo = manager.getRepository(Tenant);
    const orgRepo = manager.getRepository(Organization);
    const userSpaceRepo = manager.getRepository(UserSpace);
    const rpaRepo = manager.getRepository(ResourcePoolAssignment);
    const allocationRepo = manager.getRepository(UserSpaceAllocation);

    const existingTenants = await tenantRepo.find({
      where: { id: In([...tenantIds]) },
    });
    const existingTenantById = new Map(existingTenants.map((t) => [t.id, t]));
    const allTenants = await tenantRepo.find();
    const tenantNameOwner = new Map(allTenants.map((t) => [t.name, t.id]));

    for (const tenantId of tenantIds) {
      const cr = tenantCrById.get(tenantId);
      if (!cr) {
        result.warnings.push(`租户 ${tenantId} 缺少 Tenant CRD，已跳过`);
        result.tenants.skipped += 1;
        continue;
      }

      const displayName = String(cr?.spec?.displayName || cr?.metadata?.name || tenantId).trim();
      if (!displayName) {
        result.warnings.push(`Tenant CRD ${tenantId} 缺少 displayName，已跳过`);
        result.tenants.skipped += 1;
        continue;
      }

      const nameOwner = tenantNameOwner.get(displayName);
      if (nameOwner && nameOwner !== tenantId) {
        result.warnings.push(
          `租户名称「${displayName}」已被本地租户 ${nameOwner} 占用，无法恢复 CRD ${tenantId}`,
        );
        result.tenants.skipped += 1;
        continue;
      }

      const rootOrganizationId = crdRefName(cr?.spec?.rootOrganizationRef) || undefined;
      const payload: Partial<Tenant> = {
        id: tenantId,
        name: displayName,
        description: String(cr?.spec?.description || '') || undefined,
        status: crdPhaseToTenantStatus(cr?.spec?.desiredPhase ?? cr?.status?.phase),
        rootOrganizationId,
      };

      const existing = existingTenantById.get(tenantId);
      if (existing) {
        Object.assign(existing, payload);
        await tenantRepo.save(existing);
        result.tenants.updated += 1;
      } else {
        await tenantRepo.save(tenantRepo.create(payload));
        tenantNameOwner.set(displayName, tenantId);
        result.tenants.created += 1;
      }
    }

    const orgIds = [...organizationCrById.keys()].filter((id) =>
      tenantIds.has(crdRefName(organizationCrById.get(id)?.spec?.tenantRef)),
    );
    const sortedOrgIds = orgIds.sort((a, b) => {
      const la = Number(organizationCrById.get(a)?.spec?.level ?? 0);
      const lb = Number(organizationCrById.get(b)?.spec?.level ?? 0);
      return la - lb;
    });

    const existingOrgs = orgIds.length ? await orgRepo.find({ where: { id: In(orgIds) } }) : [];
    const existingOrgById = new Map(existingOrgs.map((o) => [o.id, o]));

    for (const orgId of sortedOrgIds) {
      const cr = organizationCrById.get(orgId);
      if (!cr) continue;

      const tenantId = crdRefName(cr?.spec?.tenantRef);
      if (!tenantId || !tenantIds.has(tenantId)) {
        result.organizations.skipped += 1;
        continue;
      }

      const tenantExists =
        existingTenantById.has(tenantId) ||
        (await tenantRepo.findOne({ where: { id: tenantId } })) != null;
      if (!tenantExists) {
        result.warnings.push(`组织 ${orgId} 所属租户 ${tenantId} 未恢复，已跳过`);
        result.organizations.skipped += 1;
        continue;
      }

      const parentId = crdRefName(cr?.spec?.parentRef) || undefined;
      if (parentId && !organizationCrById.has(parentId) && !existingOrgById.has(parentId)) {
        result.warnings.push(`组织 ${orgId} 的父组织 ${parentId} 不存在，已跳过`);
        result.organizations.skipped += 1;
        continue;
      }

      const payload: Partial<Organization> = {
        id: orgId,
        name: String(cr?.spec?.displayName || orgId).trim(),
        description: String(cr?.spec?.description || '') || undefined,
        level: Math.min(4, Math.max(1, Number(cr?.spec?.level ?? 1))) as 1 | 2 | 3 | 4,
        orderIndex: Number(cr?.spec?.orderIndex ?? 0),
        tenantId,
        parentId,
        status: crdPhaseToSimpleStatus(cr?.spec?.desiredPhase ?? cr?.status?.phase),
      };

      const existing = existingOrgById.get(orgId);
      if (existing) {
        Object.assign(existing, payload);
        await orgRepo.save(existing);
        result.organizations.updated += 1;
      } else {
        await orgRepo.save(orgRepo.create(payload));
        result.organizations.created += 1;
      }
    }

    for (const cr of scopedUserSpaces) {
      const userSpaceId = String(cr?.metadata?.name || '').trim();
      if (!userSpaceId || !isUuidLike(userSpaceId)) {
        result.warnings.push(`UserSpace CRD metadata.name 无效，已跳过`);
        result.userSpaces.skipped += 1;
        continue;
      }

      const tenantId = crdRefName(cr?.spec?.tenantRef);
      const organizationId = crdRefName(cr?.spec?.organizationRef);
      if (!tenantId || !(await tenantRepo.findOne({ where: { id: tenantId } }))) {
        result.warnings.push(`UserSpace ${userSpaceId} 所属租户不可用，已跳过`);
        result.userSpaces.skipped += 1;
        continue;
      }
      if (organizationId && !(await orgRepo.findOne({ where: { id: organizationId } }))) {
        result.warnings.push(`UserSpace ${userSpaceId} 所属组织 ${organizationId} 不可用，已跳过`);
        result.userSpaces.skipped += 1;
        continue;
      }

      const quota = cr?.spec?.quota || {};
      const namespace = String(cr?.spec?.namespace || cr?.spec?.displayName || '').trim();
      const displayName = String(cr?.spec?.displayName || namespace || userSpaceId).trim();
      const permStr = permissionsToDb(cr?.spec?.permissions);

      const payload: Partial<UserSpace> = {
        id: userSpaceId,
        name: displayName,
        description: String(cr?.spec?.description || '') || undefined,
        tenantId,
        organizationId: organizationId || undefined,
        cloudId: cloudRefId,
        namespace: namespace || displayName,
        permissions: permStr,
        cpuQuota: Number(quota.cpu ?? 0),
        memoryQuota: Number(quota.memoryGi ?? 0),
        storageQuota: Number(quota.storageGi ?? 0),
        status: crdPhaseToSimpleStatus(cr?.spec?.desiredPhase ?? cr?.status?.phase),
      };

      const existing = await userSpaceRepo.findOne({ where: { id: userSpaceId } });
      if (existing) {
        Object.assign(existing, payload);
        await userSpaceRepo.save(existing);
        result.userSpaces.updated += 1;
      } else {
        await userSpaceRepo.save(userSpaceRepo.create(payload));
        result.userSpaces.created += 1;
      }

      if (organizationId) {
        const existingRpa = await rpaRepo.findOne({
          where: { organizationId, cloudId: cloudRefId },
        });
        const rpaPayload: Partial<ResourcePoolAssignment> = {
          organizationId,
          cloudId: cloudRefId,
          namespace: payload.namespace,
          permissions: permStr,
          status: 'active',
          cpuQuota: payload.cpuQuota ?? 0,
          memoryQuota: payload.memoryQuota ?? 0,
          storageQuota: payload.storageQuota ?? 0,
          assignedAt: new Date(),
        };
        if (existingRpa) {
          Object.assign(existingRpa, rpaPayload);
          await rpaRepo.save(existingRpa);
          result.resourcePoolAssignments.updated += 1;
        } else {
          await rpaRepo.save(rpaRepo.create(rpaPayload));
          result.resourcePoolAssignments.created += 1;
        }
      }

      const allocationTypes: Array<'cpu' | 'memory' | 'storage'> = ['cpu', 'memory', 'storage'];
      for (const type of allocationTypes) {
        const existingAlloc = await allocationRepo.findOne({
          where: { userSpaceId, type },
        });
        if (existingAlloc) {
          result.userSpaceAllocations.skipped += 1;
          continue;
        }
        await allocationRepo.save(
          allocationRepo.create({
            userSpaceId,
            type,
            cpu: payload.cpuQuota ?? 0,
            memory: payload.memoryQuota ?? 0,
            storage: payload.storageQuota ?? 0,
          }),
        );
        result.userSpaceAllocations.created += 1;
      }
    }
  });

  return result;
}
