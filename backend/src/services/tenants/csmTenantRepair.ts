import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { Organization } from '../../entities/Organization';
import { ResourcePoolAssignment } from '../../entities/ResourcePoolAssignment';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { Tenant } from '../../entities/Tenant';
import { TenantLeasedLine } from '../../entities/TenantLeasedLine';
import {
  listCsmSecurityDomainsPaged,
  listCsmTenantsPaged,
  type CsmRepairAuthOptions,
  type CsmTenantPageRow,
} from '../clouds/csm/csmV2Api';
import type { CsmConfig } from '../clouds/csm/client';
import {
  csmDomainIdTag,
  csmOrgIdTag,
  mergeCsmTags,
  stableLeasedLineIdFromCsmDomainId,
  stableRootOrganizationIdFromCsmOrgId,
  stableSecurityDomainIdFromCsmDomainId,
  stableTenantIdFromCsmOrgId,
} from './csmStableIds';

type EntityCounter = { created: number; updated: number; skipped: number };

export type TenantCsmRepairResult = {
  cloudId: string;
  cloudName: string;
  tenants: EntityCounter;
  organizations: EntityCounter;
  securityDomains: EntityCounter;
  leasedLines: EntityCounter;
  resourcePoolAssignments: EntityCounter;
  warnings: string[];
};

function emptyCounter(): EntityCounter {
  return { created: 0, updated: 0, skipped: 0 };
}

export function isCsmTargetCloud(cloud: Pick<Cloud, 'config'>): boolean {
  return (
    String(cloud.config?.provider || '')
      .trim()
      .toLowerCase() === 'cloudmap.csm'
  );
}

export function assertCsmTargetCloud(cloud: Cloud): void {
  if (!isCsmTargetCloud(cloud)) {
    throw Object.assign(new Error(`资源池「${cloud.name}」不是 CSM（cloudmap.csm）类型`), {
      status: 400,
    });
  }
  if (!String(cloud.endpoint || '').trim()) {
    throw Object.assign(new Error(`资源池「${cloud.name}」缺少 endpoint`), { status: 502 });
  }
  if (!String(cloud.accessKey || '').trim() || !String(cloud.secretKey || '').trim()) {
    throw Object.assign(
      new Error(`资源池「${cloud.name}」缺少 AccessKey/SecretKey，无法调用 CSM API`),
      { status: 502 },
    );
  }
}

export function csmConfigFromCloud(cloud: Cloud): CsmConfig {
  return toCsmConfig(cloud);
}

export function csmRepairAuthFromCloud(cloud: Cloud): CsmRepairAuthOptions | undefined {
  return repairAuthFromCloud(cloud);
}

function toCsmConfig(cloud: Cloud): CsmConfig {
  return {
    endpoint: String(cloud.endpoint || '').trim(),
    accessKey: String(cloud.accessKey || '').trim(),
    secretKey: String(cloud.secretKey || '').trim(),
    ignoreTls: !!(cloud.config as any)?.ignoreTls,
  };
}

function webPortFromEndpoint(endpoint: string): string | undefined {
  try {
    const raw = String(endpoint || '').trim();
    if (!raw) return undefined;
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return u.port || undefined;
  } catch {
    return undefined;
  }
}

function repairAuthFromCloud(cloud: Cloud): CsmRepairAuthOptions | undefined {
  const cfg = (cloud.config || {}) as Record<string, unknown>;
  const username = String(cfg.csmRepairUsername ?? cfg.csmApiUsername ?? '').trim();
  const passwordEncrypted = String(
    cfg.csmRepairPasswordEncrypted ?? cfg.csmApiPasswordEncrypted ?? '',
  ).trim();
  const webPort =
    String(cfg.csmWebPort ?? cfg.csmRepairWebPort ?? '').trim() ||
    webPortFromEndpoint(String(cloud.endpoint || cfg.endpoint || '')) ||
    '';
  if (!username && !passwordEncrypted) return undefined;
  return {
    username: username || 'admin',
    passwordEncrypted: passwordEncrypted || undefined,
    webPort: webPort || undefined,
  };
}

function lockStatusToTenantStatus(lockStatus: unknown): Tenant['status'] {
  return Number(lockStatus) === 0 ? 'suspended' : 'active';
}

function joinNetworkCidrs(cidrs: unknown): string | undefined {
  if (!Array.isArray(cidrs) || !cidrs.length) return undefined;
  const parts = cidrs.map((c) => String(c || '').trim()).filter(Boolean);
  return parts.length ? parts.join(',') : undefined;
}

/** 从安全域 CIDR 列表中提取可作为专线 IP 记录的条目（单 IP 或 /32） */
export function extractDedicatedLineIps(cidrs: unknown): string[] {
  if (!Array.isArray(cidrs)) return [];
  const out: string[] = [];
  for (const raw of cidrs) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (!s.includes('/')) {
      out.push(s);
      continue;
    }
    if (s.endsWith('/32')) {
      out.push(s.replace(/\/32$/i, ''));
    }
  }
  return out;
}

function tenantDescriptionFromCsm(row: CsmTenantPageRow): string {
  const parts = [
    csmOrgIdTag(String(row.orgId || '')),
    row.username ? `csmUsername=${row.username}` : '',
    row.accountName ? `accountName=${row.accountName}` : '',
  ].filter(Boolean);
  return parts.join('; ');
}

/**
 * 从 CSM 资源池 API 恢复 Tower 本地：租户、根组织、安全域、专线 IP（由 networkCidrs 推导）、CSM 池分配。
 */
export async function repairTenantDataFromCsm(cloudId: string): Promise<TenantCsmRepairResult> {
  const cloudRepository = AppDataSource.getRepository(Cloud);
  const cloud = await cloudRepository.findOne({ where: { id: cloudId } });
  if (!cloud) {
    throw Object.assign(new Error('资源池不存在'), { status: 404 });
  }
  assertCsmTargetCloud(cloud);

  const config = toCsmConfig(cloud);
  const auth = repairAuthFromCloud(cloud);

  const [tenantRows, domainRows] = await Promise.all([
    listCsmTenantsPaged(config, auth),
    listCsmSecurityDomainsPaged(config, auth),
  ]);

  if (!tenantRows.length && !domainRows.length) {
    throw Object.assign(new Error(`CSM「${cloud.name}」未返回租户或安全域数据`), { status: 404 });
  }

  const result: TenantCsmRepairResult = {
    cloudId: cloud.id,
    cloudName: cloud.name,
    tenants: emptyCounter(),
    organizations: emptyCounter(),
    securityDomains: emptyCounter(),
    leasedLines: emptyCounter(),
    resourcePoolAssignments: emptyCounter(),
    warnings: [],
  };

  const orgIdToTenantId = new Map<string, string>();

  for (const row of tenantRows) {
    const csmOrgId = String(row.orgId || '').trim();
    if (!csmOrgId) {
      result.warnings.push('CSM 租户行缺少 orgId，已跳过');
      result.tenants.skipped += 1;
      continue;
    }
    orgIdToTenantId.set(csmOrgId, stableTenantIdFromCsmOrgId(csmOrgId));
  }

  for (const domain of domainRows) {
    const csmOrgId = String(domain.orgId || '').trim();
    if (!csmOrgId) continue;
    if (!orgIdToTenantId.has(csmOrgId)) {
      orgIdToTenantId.set(csmOrgId, stableTenantIdFromCsmOrgId(csmOrgId));
      result.warnings.push(
        `安全域「${domain.name || domain.id}」的 orgId=${csmOrgId} 在租户分页中未出现，已按 orgId 补建租户`,
      );
    }
  }

  await AppDataSource.transaction(async (manager) => {
    const tenantRepo = manager.getRepository(Tenant);
    const orgRepo = manager.getRepository(Organization);
    const domainRepo = manager.getRepository(SecurityDomain);
    const leasedRepo = manager.getRepository(TenantLeasedLine);
    const rpaRepo = manager.getRepository(ResourcePoolAssignment);

    const tenantIds = [...new Set(orgIdToTenantId.values())];
    const existingTenants = tenantIds.length
      ? await tenantRepo.find({ where: { id: In(tenantIds) } })
      : [];
    const tenantById = new Map(existingTenants.map((t) => [t.id, t]));
    const allTenants = await tenantRepo.find();
    const tenantNameOwner = new Map(allTenants.map((t) => [t.name, t.id]));

    const tenantRowByOrgId = new Map<string, CsmTenantPageRow>();
    for (const row of tenantRows) {
      const oid = String(row.orgId || '').trim();
      if (oid) tenantRowByOrgId.set(oid, row);
    }

    for (const [csmOrgId, tenantId] of orgIdToTenantId) {
      const row = tenantRowByOrgId.get(csmOrgId);
      const displayName = String(row?.orgName || row?.accountName || csmOrgId).trim();
      if (!displayName) {
        result.tenants.skipped += 1;
        continue;
      }

      const nameOwner = tenantNameOwner.get(displayName);
      if (nameOwner && nameOwner !== tenantId) {
        result.warnings.push(
          `租户名称「${displayName}」已被本地租户 ${nameOwner} 占用，无法恢复 CSM orgId=${csmOrgId}`,
        );
        result.tenants.skipped += 1;
        continue;
      }

      const rootOrgId = stableRootOrganizationIdFromCsmOrgId(csmOrgId);
      const payload: Partial<Tenant> = {
        id: tenantId,
        name: displayName,
        description: row ? tenantDescriptionFromCsm(row) : csmOrgIdTag(csmOrgId),
        status: row ? lockStatusToTenantStatus(row.lockStatus) : 'active',
        rootOrganizationId: rootOrgId,
      };

      const existing = tenantById.get(tenantId);
      if (existing) {
        Object.assign(existing, payload);
        await tenantRepo.save(existing);
        result.tenants.updated += 1;
      } else {
        await tenantRepo.save(tenantRepo.create(payload));
        tenantNameOwner.set(displayName, tenantId);
        result.tenants.created += 1;
      }

      const orgPayload: Partial<Organization> = {
        id: rootOrgId,
        name: displayName,
        description: row ? tenantDescriptionFromCsm(row) : undefined,
        level: 1,
        orderIndex: 0,
        tenantId,
        parentId: undefined,
        status: 'active',
      };

      const existingOrg = await orgRepo.findOne({ where: { id: rootOrgId } });
      if (existingOrg) {
        Object.assign(existingOrg, orgPayload);
        await orgRepo.save(existingOrg);
        result.organizations.updated += 1;
      } else {
        await orgRepo.save(orgRepo.create(orgPayload));
        result.organizations.created += 1;
      }

      const existingRpa = await rpaRepo.findOne({
        where: { organizationId: rootOrgId, cloudId: cloud.id },
      });
      const rpaPayload: Partial<ResourcePoolAssignment> = {
        organizationId: rootOrgId,
        cloudId: cloud.id,
        status: 'active',
        permissions: JSON.stringify(['read', 'use']),
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

    for (const domain of domainRows) {
      const csmDomainId = String(domain.id || '').trim();
      if (!csmDomainId) {
        result.securityDomains.skipped += 1;
        result.warnings.push('安全域行缺少 id，已跳过');
        continue;
      }

      const csmOrgId = String(domain.orgId || '').trim();
      const tenantId = csmOrgId ? orgIdToTenantId.get(csmOrgId) : undefined;
      if (!tenantId) {
        result.securityDomains.skipped += 1;
        result.warnings.push(`安全域 ${csmDomainId} 缺少可关联的 orgId，已跳过`);
        continue;
      }

      const rootOrgId = stableRootOrganizationIdFromCsmOrgId(csmOrgId);
      const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
      if (!tenant) {
        result.securityDomains.skipped += 1;
        continue;
      }

      const domainId = stableSecurityDomainIdFromCsmDomainId(csmDomainId);
      const cidr = joinNetworkCidrs(domain.networkCidrs);
      const tags = mergeCsmTags(undefined, [
        csmDomainIdTag(csmDomainId),
        csmOrgIdTag(csmOrgId),
        'source=csm-repair',
      ]);

      const domainPayload: Partial<SecurityDomain> = {
        id: domainId,
        name: String(domain.name || csmDomainId).trim() || csmDomainId,
        cloudId: cloud.id,
        provider: 'cloudmap.csm',
        resourcePool: cloud.name,
        cidr,
        tags,
        status: Number(domain.flowStatus) === 0 ? 'disabled' : 'active',
        tenantId,
        organizationId: rootOrgId,
        tenantName: tenant.name,
        organizationName: tenant.name,
        category: 'flat:CSM安全域',
      };

      const existingDomain = await domainRepo.findOne({ where: { id: domainId } });
      if (existingDomain) {
        Object.assign(existingDomain, domainPayload);
        await domainRepo.save(existingDomain);
        result.securityDomains.updated += 1;
      } else {
        await domainRepo.save(domainRepo.create(domainPayload));
        result.securityDomains.created += 1;
      }

      const dedicatedIps = extractDedicatedLineIps(domain.networkCidrs);
      const ipsValue = dedicatedIps.length
        ? dedicatedIps.join(',')
        : joinNetworkCidrs(domain.networkCidrs);
      if (!ipsValue) continue;

      const leasedId = stableLeasedLineIdFromCsmDomainId(csmDomainId);
      const leasedPayload: Partial<TenantLeasedLine> = {
        id: leasedId,
        tenantId,
        tenantName: tenant.name,
        region: undefined,
        province: '待补充',
        city: '待补充',
        operator: '待补充',
        ips: ipsValue,
      };

      const existingLeased = await leasedRepo.findOne({ where: { id: leasedId } });
      if (existingLeased) {
        Object.assign(existingLeased, leasedPayload);
        await leasedRepo.save(existingLeased);
        result.leasedLines.updated += 1;
      } else {
        await leasedRepo.save(leasedRepo.create(leasedPayload));
        result.leasedLines.created += 1;
      }
    }
  });

  return result;
}
