import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { Organization } from '../../entities/Organization';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { Tenant } from '../../entities/Tenant';
import { TenantUser } from '../../entities/TenantUser';
import { UserSpace } from '../../entities/UserSpace';
import { redactCloud } from '../clouds/cloudSanitizer';
import { loadCsmSecurityDomainProjection } from '../../utils/csmSecurityDomainProjection';
import { inferRoleKindFromDomain } from '../../utils/internetworkRoutingDomain';

export type TenantResourcePoolCategory = 'compute' | 'storage' | 'security';

export type TenantFullExportPoolAssignment = {
  id: string;
  cloudId: string;
  organizationId?: string;
  namespace?: string | null;
  permissions?: string[];
  status: string;
  cpuQuota: number;
  memoryQuota: number;
  storageQuota: number;
  category: TenantResourcePoolCategory;
  cloud?: ReturnType<typeof redactCloud>;
};

export type TenantFullExportUser = Omit<TenantUser, 'password'>;

export type TenantFullExportInternetworkRoutingDomain = Record<string, unknown> & {
  csmProtectionObjects: unknown[];
  securityServices: unknown[];
  serviceChains: unknown[];
  linkedCsmSecurityDomain: unknown;
  csmProjectionReady: boolean;
  csmProjectionError?: string;
};

export type TenantFullExportOrganization = {
  id: string;
  name: string;
  description?: string;
  level: number;
  parentId?: string | null;
  tenantId: string;
  status: string;
  orderIndex?: number;
  createdAt?: Date;
  updatedAt?: Date;
  users: TenantFullExportUser[];
  resourcePools: {
    compute: TenantFullExportPoolAssignment[];
    storage: TenantFullExportPoolAssignment[];
    security: TenantFullExportPoolAssignment[];
  };
  internetworkRoutingDomains: TenantFullExportInternetworkRoutingDomain[];
};

export type TenantFullExportResult = {
  tenant: Tenant;
  exportedAt: string;
  organizationTree: Array<Organization & { children?: unknown[] }>;
  organizations: TenantFullExportOrganization[];
  summary: {
    organizationCount: number;
    userCount: number;
    resourcePoolAssignmentCount: number;
    internetworkRoutingDomainCount: number;
  };
};

function poolCategory(cloud: Cloud | null | undefined): TenantResourcePoolCategory {
  const pv = String(cloud?.config?.provider ?? '')
    .trim()
    .toLowerCase();
  const typeLower = String(cloud?.type ?? '')
    .trim()
    .toLowerCase();
  if (pv === 'cloudmap.csm') return 'security';
  if (typeLower === 'object_storage' || typeLower === 'file_storage') return 'storage';
  return 'compute';
}

function parsePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      /* ignore */
    }
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeUser(user: TenantUser): TenantFullExportUser {
  const { password: _pw, ...rest } = user;
  return rest;
}

function buildOrganizationTree(organizations: Organization[]): Array<Organization & { children: unknown[] }> {
  const orgMap = new Map<string, Organization & { children: unknown[] }>();
  const roots: Array<Organization & { children: unknown[] }> = [];

  for (const org of organizations) {
    orgMap.set(org.id, { ...org, children: [] });
  }

  for (const org of organizations) {
    const node = orgMap.get(org.id)!;
    if (org.parentId) {
      const parent = orgMap.get(org.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function serializeInternetworkRoutingDomain(
  domain: SecurityDomain,
): Promise<TenantFullExportInternetworkRoutingDomain> {
  const csmProj = await loadCsmSecurityDomainProjection(domain);
  const cidr4 = domain.cidr
    ? [String(domain.cidr)]
    : Array.isArray((domain as any).cidr4)
      ? (domain as any).cidr4
      : [];

  return {
    ...(domain as unknown as Record<string, unknown>),
    cidr4,
    linkedCsmSecurityDomainId: csmProj.linkedCsmSecurityDomainId,
    linkedCsmSecurityDomain: csmProj.linkedCsmSecurityDomain ?? null,
    csmCloudId: csmProj.csmCloudId ?? domain.csmCloudId,
    csmProtectionObjects: csmProj.csmProtectionObjects,
    securityServices: csmProj.securityServices,
    serviceChains: csmProj.serviceChains,
    csmProjectionReady: csmProj.csmProjectionReady,
    csmProjectionError: csmProj.csmProjectionError,
  };
}

export async function buildTenantFullExport(tenantId: string): Promise<TenantFullExportResult | null> {
  const tenantRepo = AppDataSource.getRepository(Tenant);
  const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
  if (!tenant) return null;

  const orgRepo = AppDataSource.getRepository(Organization);
  const userRepo = AppDataSource.getRepository(TenantUser);
  const userSpaceRepo = AppDataSource.getRepository(UserSpace);
  const domainRepo = AppDataSource.getRepository(SecurityDomain);

  const organizations = await orgRepo.find({
    where: { tenantId },
    order: { level: 'ASC', parentId: 'ASC', orderIndex: 'ASC', createdAt: 'ASC' },
  });
  const orgIds = organizations.map((o) => o.id);

  const [users, userSpaces, domains] = await Promise.all([
    userRepo.find({ where: { tenantId }, order: { createdAt: 'DESC' } }),
    orgIds.length
      ? userSpaceRepo.find({ where: { organizationId: In(orgIds) }, relations: ['cloud'] })
      : Promise.resolve([] as UserSpace[]),
    domainRepo.find({ where: { tenantId }, order: { createdAt: 'DESC' } }),
  ]);

  const usersByOrg = new Map<string, TenantFullExportUser[]>();
  for (const u of users) {
    const oid = String(u.organizationId || '').trim();
    if (!oid) continue;
    const list = usersByOrg.get(oid) || [];
    list.push(sanitizeUser(u));
    usersByOrg.set(oid, list);
  }

  const poolsByOrg = new Map<
    string,
    { compute: TenantFullExportPoolAssignment[]; storage: TenantFullExportPoolAssignment[]; security: TenantFullExportPoolAssignment[] }
  >();
  for (const oid of orgIds) {
    poolsByOrg.set(oid, { compute: [], storage: [], security: [] });
  }
  for (const us of userSpaces) {
    const oid = String(us.organizationId || '').trim();
    if (!oid || !poolsByOrg.has(oid)) continue;
    const cloud = (us as any).cloud as Cloud | undefined;
    const category = poolCategory(cloud);
    const row: TenantFullExportPoolAssignment = {
      id: us.id,
      cloudId: us.cloudId,
      organizationId: us.organizationId,
      namespace: us.namespace,
      permissions: parsePermissions(us.permissions),
      status: us.status,
      cpuQuota: us.cpuQuota,
      memoryQuota: us.memoryQuota,
      storageQuota: us.storageQuota,
      category,
      cloud: cloud ? redactCloud(cloud) : undefined,
    };
    poolsByOrg.get(oid)![category].push(row);
  }

  const irdByOrg = new Map<string, SecurityDomain[]>();
  for (const d of domains) {
    const kind = d.roleKind || inferRoleKindFromDomain(d);
    if (kind !== 'internetwork_routing') continue;
    const oid = String(d.organizationId || '').trim();
    if (!oid) continue;
    const list = irdByOrg.get(oid) || [];
    list.push(d);
    irdByOrg.set(oid, list);
  }

  const orgExports: TenantFullExportOrganization[] = [];
  let totalUsers = 0;
  let totalPools = 0;
  let totalIrds = 0;

  for (const org of organizations) {
    const pools = poolsByOrg.get(org.id) || { compute: [], storage: [], security: [] };
    const orgUsers = usersByOrg.get(org.id) || [];
    const orgDomains = irdByOrg.get(org.id) || [];
    const serializedIrds = await Promise.all(orgDomains.map((d) => serializeInternetworkRoutingDomain(d)));

    totalUsers += orgUsers.length;
    totalPools += pools.compute.length + pools.storage.length + pools.security.length;
    totalIrds += serializedIrds.length;

    orgExports.push({
      id: org.id,
      name: org.name,
      description: org.description,
      level: org.level,
      parentId: org.parentId,
      tenantId: org.tenantId,
      status: org.status,
      orderIndex: org.orderIndex,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      users: orgUsers,
      resourcePools: pools,
      internetworkRoutingDomains: serializedIrds,
    });
  }

  return {
    tenant,
    exportedAt: new Date().toISOString(),
    organizationTree: buildOrganizationTree(organizations),
    organizations: orgExports,
    summary: {
      organizationCount: organizations.length,
      userCount: totalUsers,
      resourcePoolAssignmentCount: totalPools,
      internetworkRoutingDomainCount: totalIrds,
    },
  };
}
