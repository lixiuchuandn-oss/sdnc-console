import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { ServiceChain } from '../../entities/ServiceChain';
import { Cloud } from '../../entities/Cloud';
import { SASEDiscoveredAsset } from '../../entities/vRouter/SASEDiscoveredAsset';
import { listCsmElementGroups } from '../../services/clouds/csm/client';
import { vrManagementService } from '../../services/vrouter/vrManagementService';

export const saseGatewayRoutes = Router();

const repo = () => AppDataSource.getRepository(VRConfig);
const domainRepo = () => AppDataSource.getRepository(SecurityDomain);
const chainRepo = () => AppDataSource.getRepository(ServiceChain);
const cloudRepo = () => AppDataSource.getRepository(Cloud);
const assetRepo = () => AppDataSource.getRepository(SASEDiscoveredAsset);

function getTenantContext(req: any) {
  const user = req.user;
  if (user && (user as any).tenantId) {
    return {
      tenantId: String((user as any).tenantId),
      organizationId: (user as any).organizationId
        ? String((user as any).organizationId)
        : undefined,
    };
  }
  return null;
}

// Bind SASE Gateway (Backward Compatibility for /api/sase/gateways/bind)
saseGatewayRoutes.post('/bind', async (req, res) => {
  try {
    const ctx = getTenantContext(req as any);
    const { vm_id, vr_uuid, tenant_id, org_id, device_fingerprint, display_name } = req.body || {};

    let resolvedTenantId = tenant_id as string | undefined;
    let resolvedOrgId = org_id as string | undefined;

    if (ctx) {
      resolvedTenantId = ctx.tenantId;
      resolvedOrgId = ctx.organizationId || resolvedOrgId;
    }

    const result = await vrManagementService.bindVRToTenant({
      vr_uuid,
      tenant_id: resolvedTenantId || '',
      org_id: resolvedOrgId,
      vm_id,
      device_fingerprint,
      display_name,
      vr_type: 'SASE', // Force SASE type for this legacy endpoint
    });

    return res.json(result);
  } catch (err: any) {
    console.error('[SASE] bind error', err);
    if (err.message && err.message.includes('VR已绑定')) {
      return res.status(409).json({ message: err.message, ...err.details });
    }
    if (err.message && (err.message.includes('缺少') || err.message.includes('不支持'))) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: err?.message || 'Internal Error' });
  }
});

saseGatewayRoutes.post('/report-assets', async (req, res) => {
  try {
    const { vr_unique_id, assets } = req.body || {};

    if (!vr_unique_id) {
      return res.status(400).json({ message: 'Missing vr_unique_id' });
    }
    if (!Array.isArray(assets) || assets.length === 0) {
      return res.status(400).json({ message: 'Assets must be a non-empty array' });
    }

    // 1. Find Security Domain by VR UUID (Optional)
    let domainId: string | undefined;
    let cloudId: string | undefined;
    try {
      const domain = await domainRepo().findOne({ where: { vrUuid: vr_unique_id } });
      if (domain) {
        domainId = domain.id;
        cloudId = domain.cloudId ? String(domain.cloudId) : undefined;
      }
    } catch (e) {
      console.warn('Failed to resolve domain for asset reporting', e);
    }

    // 2. Sync Assets to Local DB (Tower)
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const asset of assets) {
      try {
        // Support both 'value' and 'ip' fields for the IP address
        const ip = String(asset.value || asset.ip || '').trim();
        if (!ip) continue;

        const type = asset.type || 'ip';
        const ipType = asset.ip_type || 'ipv4';
        const os = asset.os || null;
        const mac = asset.mac || null;
        const hostname = asset.hostname || asset.name || null;

        // Prepare list of ports to save
        // If 'ports' array exists, use it. Otherwise use single 'port' field or default to null (no port)
        let portsToSave: Array<string | null> = [];
        if (Array.isArray(asset.ports) && asset.ports.length > 0) {
          portsToSave = asset.ports
            .map((p: any) => (p.port ? String(p.port).trim() : null))
            .filter(Boolean);
        } else if (asset.port) {
          portsToSave = [String(asset.port).trim()];
        } else {
          portsToSave = [null]; // No port specified
        }

        // Deduplicate ports
        portsToSave = [...new Set(portsToSave)];

        for (const port of portsToSave) {
          // Check if exists
          const query: any = { vrUuid: vr_unique_id, ip };
          query.port = port || null; // Match specific port or no port (null)

          let existing = await assetRepo().findOne({ where: query });

          if (existing) {
            existing.lastSeen = new Date();
            existing.status = 'active';
            if (domainId) existing.domainId = domainId;
            if (cloudId) existing.cloudId = cloudId;
            if (type) existing.type = type;
            if (ipType) existing.ipType = ipType;
            if (os) existing.os = os;
            if (mac) existing.mac = mac;
            if (hostname) existing.hostname = hostname;

            await assetRepo().save(existing);
          } else {
            const newAsset = assetRepo().create({
              vrUuid: vr_unique_id,
              ip,
              port: port || undefined,
              domainId,
              cloudId,
              type,
              ipType,
              os,
              mac,
              hostname,
              status: 'active',
              firstSeen: new Date(),
              lastSeen: new Date(),
            });
            await assetRepo().save(newAsset);
          }
        }

        results.success++;
      } catch (e: any) {
        results.failed++;
        console.error(`Failed to save asset ${asset.value || asset.ip}:`, e);
        results.errors.push(`Asset ${asset.value || asset.ip}: ${e.message?.slice(0, 100)}`);
      }
    }

    return res.json({
      message: `Reported ${assets.length} assets (Stored in Tower)`,
      results,
    });
  } catch (err: any) {
    console.error('[SASE] report-assets error', err);
    return res.status(500).json({ message: err?.message || 'Internal Error' });
  }
});

// GET /assets - List discovered assets from local DB
saseGatewayRoutes.get('/assets', async (req, res) => {
  try {
    const { domain_id, cloud_id } = req.query;

    const query = assetRepo()
      .createQueryBuilder('asset')
      .leftJoinAndMapOne('asset.gateway', VRConfig, 'vr', 'vr.uuid = asset.vrUuid')
      .orderBy('asset.lastSeen', 'DESC');

    if (domain_id) query.andWhere('asset.domainId = :domain_id', { domain_id });
    if (cloud_id) query.andWhere('asset.cloudId = :cloud_id', { cloud_id });

    const assets = await query.getMany();

    const result = assets.map((a: any) => ({
      ...a,
      gatewayName: a.gateway?.name || a.vrUuid, // Fallback to UUID if name not found
    }));

    return res.json(result);
  } catch (err: any) {
    console.error('[SASE] list assets error', err);
    return res.status(500).json({ message: err?.message || 'Internal Error' });
  }
});

// GET /info - Query Security Domain and Security Services for a VR
saseGatewayRoutes.get('/info', async (req, res) => {
  try {
    const vrUuid = req.query.vr_uuid as string;
    if (!vrUuid) {
      return res.status(400).json({ message: 'Missing vr_uuid parameter' });
    }

    const ctx = getTenantContext(req as any);
    const vrUniqueId = vrUuid.trim();

    // 1. Verify VR ownership if context exists
    if (ctx) {
      const vr = await repo().findOne({ where: { uuid: vrUniqueId } });
      if (vr) {
        if (ctx.tenantId && vr.tenantId && vr.tenantId !== ctx.tenantId) {
          return res.status(403).json({ message: 'Access denied: VR belongs to another tenant' });
        }
      }
    }

    // 2. Find Security Domain bound to this VR
    const domain = await domainRepo().findOne({ where: { vrUuid: vrUniqueId } });
    if (!domain) {
      return res
        .status(404)
        .json({ message: 'No Security Domain bound to this VR', vr_uuid: vrUniqueId });
    }

    const result = { ...domain } as any;

    // 3. Load Service Chains (for internal use only)
    let serviceChains: ServiceChain[] = [];
    try {
      serviceChains = await chainRepo()
        .createQueryBuilder('chain')
        .where('chain.domainId = :id', { id: domain.id })
        .orWhere('chain.protectionTargets LIKE :searchId', { searchId: `%${domain.id}%` })
        .orWhere('chain.protectionTargets LIKE :searchName', { searchName: `%${domain.name}%` })
        .getMany();
    } catch (e) {
      console.warn('Failed to fetch service chains for SASE info:', e);
      serviceChains = [];
    }

    // 4. Resolve Security Services and SSO endpoint for this domain
    try {
      const directIds: string[] = domain.securityServiceIds
        ? domain.securityServiceIds
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
      const chainIds = new Set<string>();

      if (serviceChains && serviceChains.length > 0) {
        (serviceChains as any[]).forEach((chain: any) => {
          if (chain.securityServices) {
            try {
              const parsed = JSON.parse(chain.securityServices);
              if (Array.isArray(parsed)) {
                parsed.forEach((s: any) => {
                  if (s && typeof s === 'object') {
                    const id = String(
                      s?.id ??
                        s?.vm_group_id ??
                        s?.vmGroupId ??
                        s?.vmGroupID ??
                        s?.vm_group_uuid ??
                        s?.vmGroupUuid ??
                        '',
                    ).trim();
                    if (id) chainIds.add(id);
                    return;
                  }
                  const id = String(s ?? '').trim();
                  if (id) chainIds.add(id);
                });
              } else {
                if (parsed && typeof parsed === 'object') {
                  const id = String(
                    parsed?.id ??
                      parsed?.vm_group_id ??
                      parsed?.vmGroupId ??
                      parsed?.vmGroupID ??
                      parsed?.vm_group_uuid ??
                      parsed?.vmGroupUuid ??
                      '',
                  ).trim();
                  if (id) chainIds.add(id);
                } else {
                  const id = String(parsed ?? '').trim();
                  if (id) chainIds.add(id);
                }
              }
            } catch (e) {
              String(chain.securityServices)
                .split(',')
                .forEach((s: string) => {
                  const id = String(s || '').trim();
                  if (id) chainIds.add(id);
                });
            }
          }
        });
      }

      const allIds = Array.from(new Set<string>([...directIds, ...Array.from(chainIds)]));
      const groupById = new Map<string, any>();
      const toKey = (s: any) =>
        String(s ?? '')
          .trim()
          .toLowerCase();
      const uuidToObjectIdHex = (uuidStr: string): string | null => {
        try {
          const s = String(uuidStr || '')
            .trim()
            .toLowerCase();
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s))
            return null;
          const hex = s.replace(/-/g, '');
          const bytes = Buffer.from(hex, 'hex');
          if (bytes.length !== 16) return null;
          if (!(bytes[6] === 0x40 && bytes[7] === 0x00 && bytes[8] === 0x80 && bytes[9] === 0x00))
            return null;
          const obj = Buffer.alloc(12);
          bytes.copy(obj, 0, 0, 6);
          bytes.copy(obj, 6, 10, 16);
          return obj.toString('hex');
        } catch {
          return null;
        }
      };
      const idCandidates = (id: string) => {
        const out: string[] = [];
        const a = toKey(id);
        if (a) out.push(a);
        const b = uuidToObjectIdHex(id);
        if (b) out.push(toKey(b));
        return Array.from(new Set(out));
      };

      let chosenCloudId: string | undefined;
      let csmGroups: any[] = [];

      if (allIds.length > 0 || serviceChains.length > 0) {
        const isCsmCloud = (cloud: any) => {
          const pvRaw = String((cloud as any)?.config?.provider || (cloud as any)?.provider || '')
            .trim()
            .toLowerCase();
          return pvRaw === 'cloudmap.csm';
        };
        const hasCreds = (cloud: any) => {
          const endpoint = String(cloud?.endpoint || '').trim();
          const accessKey = String(cloud?.accessKey || '').trim();
          const secretKey = String(cloud?.secretKey || '').trim();
          return !!(endpoint && accessKey && secretKey);
        };

        const candidateClouds: any[] = [];
        const chainPoolKeys = Array.from(
          new Set(
            (serviceChains as any[])
              .map((c: any) => String(c?.clusterName || '').trim())
              .filter(Boolean),
          ),
        );
        if (chainPoolKeys.length > 0) {
          const byId = await cloudRepo()
            .createQueryBuilder('c')
            .where('c.id IN (:...ids)', { ids: chainPoolKeys })
            .getMany();
          byId.forEach((c: any) => {
            if (c && isCsmCloud(c)) candidateClouds.push(c);
          });
        }
        if (domain.cloudId) {
          const domCloud = await cloudRepo().findOne({ where: { id: String(domain.cloudId) } });
          if (domCloud && isCsmCloud(domCloud)) candidateClouds.push(domCloud);
        }
        if (candidateClouds.length === 0) {
          const allClouds = await cloudRepo().find();
          allClouds.forEach((c: any) => {
            if (c && isCsmCloud(c)) candidateClouds.push(c);
          });
        }

        const seen = new Set<string>();
        const deduped = candidateClouds.filter((c: any) => {
          const cid = String(c?.id || '').trim();
          if (!cid || seen.has(cid)) return false;
          seen.add(cid);
          return true;
        });

        for (const cloud of deduped) {
          if (!cloud || !isCsmCloud(cloud) || !hasCreds(cloud)) continue;
          try {
            const endpoint = String(cloud.endpoint || '').trim();
            const accessKey = String(cloud.accessKey || '').trim();
            const secretKey = String(cloud.secretKey || '').trim();
            const ignoreTls = !!(cloud as any)?.config?.ignoreTls;
            const groups = await listCsmElementGroups({
              endpoint,
              accessKey,
              secretKey,
              ignoreTls,
            } as any);
            const arr = Array.isArray(groups) ? groups : [];
            arr.forEach((g: any) => {
              const gid = String(
                g?.id ??
                  g?.vm_group_id ??
                  g?.vmGroupId ??
                  g?.vmGroupID ??
                  g?.vm_group_uuid ??
                  g?.vmGroupUuid ??
                  '',
              ).trim();
              if (!gid) return;
              idCandidates(gid).forEach((k) => groupById.set(k, g));
            });
            const matched = allIds.some((sid) => idCandidates(sid).some((k) => groupById.has(k)));
            if (matched) {
              chosenCloudId = String(cloud.id || '').trim() || chosenCloudId;
              csmGroups = arr;
              break;
            }
          } catch (e) {
            console.warn('SASE Info: Failed to fetch CSM groups from cloud ' + cloud.id, e);
          }
        }
      }

      const pick = (obj: any, keys: string[]) => {
        for (const k of keys) {
          const v = obj?.[k];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return undefined;
      };

      const normalizeOne = (sid: string, source: string) => {
        const candidates = idCandidates(sid);
        let g: any = null;
        for (const k of candidates) {
          if (groupById.has(k)) {
            g = groupById.get(k);
            break;
          }
        }

        let vmIds: string[] = [];
        if (g) {
          const rawVmIds =
            (g as any).vm_id_list || (g as any).vmIdList || (g as any).elements || [];
          if (Array.isArray(rawVmIds)) {
            vmIds = rawVmIds.map((x: any) => String(x || '').trim()).filter((s: string) => !!s);
          } else if (typeof rawVmIds === 'string') {
            vmIds = String(rawVmIds)
              .split(/[;,]/)
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }

        const elements =
          g && Array.isArray((g as any).elements)
            ? (g as any).elements
            : g && typeof (g as any).vm_id_list === 'string'
              ? String((g as any).vm_id_list)
                  .split(';')
                  .map((s: string) => s.trim())
                  .filter((s: string) => s)
              : [];

        const neCount = Number(
          (g
            ? pick(g, [
                'neCount',
                'count',
                'Count',
                'elementCount',
                'elementsCount',
                'elements_count',
                'vm_count',
                'vmCount',
              ])
            : undefined) ?? (Array.isArray(elements) ? elements.length : vmIds.length),
        );

        const vendor = g
          ? pick(g, [
              'vendor',
              'manufacturer',
              'vendor_name',
              'vendorName',
              'factory',
              'brand',
              'company',
              'maker',
            ])
          : undefined;

        const defenseRaw = g
          ? pick(g, [
              'defenseType',
              'defense_type',
              'defend_type',
              'defendType',
              'protectType',
              'protect_type',
              'protectionType',
              'protection_type',
              'securityType',
              'security_type',
            ])
          : undefined;

        const defenseType = (() => {
          if (defenseRaw === undefined) return undefined;
          const n = Number(defenseRaw);
          if (!Number.isNaN(n)) {
            if (n === 1) return '非流量型';
            if (n === 2) return '流量型';
          }
          const s = String(defenseRaw).trim();
          return s ? s : undefined;
        })();

        const typeRaw = g
          ? pick(g, [
              'vm_type',
              'vmType',
              'type',
              'groupType',
              'vm_group_type',
              'vmGroupType',
              'productType',
              'product_type',
            ])
          : undefined;

        const type = typeRaw ? String(typeRaw).trim() : g ? 'CSM安全网元组' : '未知服务';

        const nameRaw = g ? pick(g, ['name', 'vm_group_name', 'vmGroupName']) : undefined;
        const name = nameRaw || `安全网元组-${String(sid).substring(0, 8)}`;

        const webIds = vmIds.map((id) => uuidToObjectIdHex(id)).filter((w): w is string => !!w);

        return {
          id: sid,
          name: typeof name === 'object' ? Object.values(name)[0] : name,
          type,
          vendor: vendor ?? undefined,
          defenseType,
          neCount,
          source,
          status: 'active',
          vmIds,
          webIds,
          raw: g,
        };
      };

      const allServices: any[] = [];
      directIds.forEach((sid: string) => allServices.push(normalizeOne(sid, '直接关联')));
      Array.from(chainIds).forEach((sid: string) => {
        if (!directIds.includes(sid)) allServices.push(normalizeOne(sid, '服务链关联'));
      });
      result.securityServices = allServices;

      const otherServices: any[] = [];
      if (csmGroups.length > 0) {
        const usedKeys = new Set<string>();
        allIds.forEach((sid: string) => {
          idCandidates(sid).forEach((k) => usedKeys.add(k));
        });
        csmGroups.forEach((g: any) => {
          const gid = String(
            g?.id ??
              g?.vm_group_id ??
              g?.vmGroupId ??
              g?.vmGroupID ??
              g?.vm_group_uuid ??
              g?.vmGroupUuid ??
              '',
          ).trim();
          if (!gid) return;
          const keys = idCandidates(gid);
          const isUsed = keys.some((k) => usedKeys.has(k));
          if (isUsed) return;
          otherServices.push(normalizeOne(gid, '未分配'));
        });
      }
      (result as any).otherSecurityServices = otherServices;

      const ssoCloudId = chosenCloudId || (domain.cloudId ? String(domain.cloudId) : undefined);

      if (domain.cloudId) {
        try {
          const computeCloud = await cloudRepo().findOne({ where: { id: String(domain.cloudId) } });
          if (computeCloud) {
            (result as any).cloudId = String(domain.cloudId);
            (result as any).cloudName = computeCloud.name;
          }
        } catch (e) {
          console.warn(
            'SASE Info: Failed to fetch compute cloud info for domain.cloudId=' + domain.cloudId,
            e,
          );
        }
      }

      if (ssoCloudId) {
        (result as any).csmCloudId = ssoCloudId;
        try {
          const secCloud = await cloudRepo().findOne({ where: { id: ssoCloudId } });
          if (secCloud) {
            (result as any).csmCloudName = secCloud.name;
            const endpoint = String(secCloud.endpoint || '').trim();
            const ignoreTls = !!(secCloud as any)?.config?.ignoreTls;
            (result as any).csmInfo = {
              endpoint,
              ignoreTls,
              username: 'admin',
              encryptedPassword: '+yNpVuicvsiBzpDpeaIq3g==',
              webPort: '8011',
              authPath: '/csm/api/v1.0/authentication/auth',
              getAdminPath: '/csm/api/v1.0/user/getAdmin',
              ssoPath: '/csm/api/v1.0/security/domain/attach/callOnSSO',
            };
          }
        } catch (e) {
          console.warn('SASE Info: Failed to fetch CSM cloud info for ssoCloudId=' + ssoCloudId, e);
        }
        (result as any).ssoEndpoint =
          `/api/clouds/${ssoCloudId}/csm/security/domain/attach/callOnSSO`;
      }
    } catch (e) {
      console.warn('Failed to resolve security services:', e);
      result.securityServices = [];
    }

    return res.json(result);
  } catch (err: any) {
    console.error('[SASE] info error', err);
    return res.status(500).json({ message: err?.message || '内部错误' });
  }
});
