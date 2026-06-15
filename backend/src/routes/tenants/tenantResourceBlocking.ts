import { AppDataSource } from '../../config/database';
import { In, type FindOptionsWhere } from 'typeorm';
import { CloudEnterpriseNetwork } from '../../entities/CloudEnterpriseNetwork';
import { ResourcePoolAssignment } from '../../entities/ResourcePoolAssignment';
import { ServiceCatalog } from '../../entities/ServiceCatalog';
import { UserSpace } from '../../entities/UserSpace';
import { VpcNetwork } from '../../entities/VpcNetwork';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { ServiceChain } from '../../entities/ServiceChain';
import { SecurityZone } from '../../entities/SecurityZone';
import { ProtectionObject } from '../../entities/ProtectionObject';

export type TenantBlockingRow = { name: string; count: number };

export type TenantDeleteBlockingSnapshot = {
  rows: TenantBlockingRow[];
  userSpacesByOrg: UserSpace[];
  assignmentsByOrg: ResourcePoolAssignment[];
  tenantScopedUserSpaces: UserSpace[];
};

async function gatherOrgAssociatedBlocking(orgIds: string[]): Promise<{
  rows: TenantBlockingRow[];
  userSpaces: UserSpace[];
  assignments: ResourcePoolAssignment[];
}> {
  if (!orgIds.length) {
    return { rows: [], userSpaces: [], assignments: [] };
  }

  const userSpaceRepository = AppDataSource.getRepository(UserSpace);
  const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
  const vpcRepository = AppDataSource.getRepository(VpcNetwork);
  const vrConfigRepository = AppDataSource.getRepository(VRConfig);
  const securityDomainRepository = AppDataSource.getRepository(SecurityDomain);
  const serviceChainRepository = AppDataSource.getRepository(ServiceChain);
  const securityZoneRepository = AppDataSource.getRepository(SecurityZone);
  const protectionObjectRepository = AppDataSource.getRepository(ProtectionObject);

  const rows: TenantBlockingRow[] = [];

  const userSpaces = await userSpaceRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (userSpaces.length > 0) rows.push({ name: '资源池绑定', count: userSpaces.length });

  const assignments = await assignmentRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (assignments.length > 0) rows.push({ name: '资源池分配', count: assignments.length });

  const vpcs = await vpcRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (vpcs.length > 0) rows.push({ name: 'VPC网络', count: vpcs.length });

  const vrConfigs = await vrConfigRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (vrConfigs.length > 0) rows.push({ name: '虚拟路由器', count: vrConfigs.length });

  const securityDomains = await securityDomainRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (securityDomains.length > 0) rows.push({ name: '网际路由域', count: securityDomains.length });

  const serviceChains = await serviceChainRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (serviceChains.length > 0) rows.push({ name: '服务链', count: serviceChains.length });

  const securityZones = await securityZoneRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (securityZones.length > 0) rows.push({ name: '安全域区域', count: securityZones.length });

  const protectionObjects = await protectionObjectRepository.find({
    where: { organizationId: In(orgIds) },
  });
  if (protectionObjects.length > 0)
    rows.push({ name: '防护对象', count: protectionObjects.length });

  return { rows, userSpaces, assignments };
}

async function gatherTenantScopedBlocking(tenantId: string): Promise<{
  rows: TenantBlockingRow[];
  tenantScopedUserSpaces: UserSpace[];
}> {
  const userSpaceRepository = AppDataSource.getRepository(UserSpace);
  const vpcRepository = AppDataSource.getRepository(VpcNetwork);
  const securityDomainRepository = AppDataSource.getRepository(SecurityDomain);
  const serviceChainRepository = AppDataSource.getRepository(ServiceChain);
  const securityZoneRepository = AppDataSource.getRepository(SecurityZone);
  const protectionObjectRepository = AppDataSource.getRepository(ProtectionObject);

  const rows: TenantBlockingRow[] = [];

  const tenantScopedUserSpaces = await userSpaceRepository.find({
    where: { tenantId },
  });
  if (tenantScopedUserSpaces.length > 0) {
    rows.push({ name: '租户资源池绑定', count: tenantScopedUserSpaces.length });
  }

  const tenantVpcs = await vpcRepository.find({
    where: { tenantId },
  });
  if (tenantVpcs.length > 0) rows.push({ name: '租户VPC网络', count: tenantVpcs.length });

  const tenantSecurityDomains = await securityDomainRepository.find({
    where: { tenantId },
  });
  if (tenantSecurityDomains.length > 0)
    rows.push({ name: '租户网际路由域', count: tenantSecurityDomains.length });

  const tenantServiceChains = await serviceChainRepository.find({
    where: { tenantId },
  });
  if (tenantServiceChains.length > 0)
    rows.push({ name: '租户服务链', count: tenantServiceChains.length });

  const tenantSecurityZones = await securityZoneRepository.find({
    where: { tenantId },
  });
  if (tenantSecurityZones.length > 0)
    rows.push({ name: '租户安全域区域', count: tenantSecurityZones.length });

  const tenantProtectionObjects = await protectionObjectRepository.find({
    where: { tenantId },
  });
  if (tenantProtectionObjects.length > 0) {
    rows.push({ name: '租户防护对象', count: tenantProtectionObjects.length });
  }

  return { rows, tenantScopedUserSpaces };
}

/**
 * 安全管理面：级联通道（CEN）、应用管理（service_catalogs ↔ security_domains）。
 * 与删除租户时的库表外键/业务占用一致，需在快照中提示用户先行解除。
 */
async function gatherSecMgrPlaneTenantBlocking(
  tenantId: string,
  orgIds: string[],
): Promise<TenantBlockingRow[]> {
  const rows: TenantBlockingRow[] = [];

  const cenRepo = AppDataSource.getRepository(CloudEnterpriseNetwork);
  const cenCount = await cenRepo.count({ where: { tenantId } });
  if (cenCount > 0) {
    rows.push({ name: '级联通道', count: cenCount });
  }

  const domainRepo = AppDataSource.getRepository(SecurityDomain);
  const catalogRepo = AppDataSource.getRepository(ServiceCatalog);

  const domainWhere: FindOptionsWhere<SecurityDomain>[] = [{ tenantId }];
  if (orgIds.length > 0) {
    domainWhere.push({ organizationId: In(orgIds) });
  }
  const domains = await domainRepo.find({
    where: domainWhere,
    select: { id: true },
  });
  const domainIds = [...new Set(domains.map((d) => String(d.id || '').trim()).filter(Boolean))];
  if (domainIds.length === 0) {
    return rows;
  }

  const appCount = await catalogRepo
    .createQueryBuilder('sc')
    .where('sc.domainId IN (:...domainIds)', { domainIds })
    .getCount();
  if (appCount > 0) {
    rows.push({ name: '应用管理', count: appCount });
  }

  return rows;
}

/** 删除组织（子树）前的资源占用汇总 */
export async function collectOrganizationSubtreeBlockingRows(
  orgIds: string[],
): Promise<TenantBlockingRow[]> {
  const { rows } = await gatherOrgAssociatedBlocking(orgIds);
  return rows;
}

/** 删除租户前的资源占用汇总（含组织维度 + 租户直挂资源），并返回用于 409 文案的 UserSpace/RPA 列表 */
export async function collectTenantDeleteBlockingSnapshot(
  tenantId: string,
  orgIds: string[],
): Promise<TenantDeleteBlockingSnapshot> {
  const orgPart = await gatherOrgAssociatedBlocking(orgIds);
  const tenantPart = await gatherTenantScopedBlocking(tenantId);
  const secMgrRows = await gatherSecMgrPlaneTenantBlocking(tenantId, orgIds);

  return {
    rows: [...orgPart.rows, ...tenantPart.rows, ...secMgrRows],
    userSpacesByOrg: orgPart.userSpaces,
    assignmentsByOrg: orgPart.assignments,
    tenantScopedUserSpaces: tenantPart.tenantScopedUserSpaces,
  };
}
