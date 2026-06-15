import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { Cloud } from '../../entities/Cloud';
import { SASEDiscoveredAsset } from '../../entities/vRouter/SASEDiscoveredAsset';
import { loadCsmSecurityDomainProjection } from '../../utils/csmSecurityDomainProjection';
import { vrManagementService } from '../../services/vrouter/vrManagementService';

export const saseGatewayRoutes = Router();

const repo = () => AppDataSource.getRepository(VRConfig);
const domainRepo = () => AppDataSource.getRepository(SecurityDomain);
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

          const existing = await assetRepo().findOne({ where: query });

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
        .json({
          message: 'No internetwork routing domain bound to this VR',
          message_zh: '该 VR 未绑定网际路由域',
          vr_uuid: vrUniqueId,
        });
    }

    const result = { ...domain } as any;

    const csmProj = await loadCsmSecurityDomainProjection(domain);
    result.linkedCsmSecurityDomain = csmProj.linkedCsmSecurityDomain ?? null;
    result.csmProtectionObjects = csmProj.csmProtectionObjects;
    result.securityServices = csmProj.securityServices;
    result.serviceChains = csmProj.serviceChains;
    result.csmProjectionReady = csmProj.csmProjectionReady;
    result.csmProjectionError = csmProj.csmProjectionError;

    const ssoCloudId = csmProj.csmCloudId || String(domain.csmCloudId || '').trim() || undefined;

    if (domain.cloudId) {
      try {
        const computeCloud = await cloudRepo().findOne({ where: { id: String(domain.cloudId) } });
        if (computeCloud) {
          result.cloudName = computeCloud.name;
        }
      } catch (e) {
        console.warn('SASE Info: Failed to fetch compute cloud info', e);
      }
    }

    if (ssoCloudId) {
      result.csmCloudId = ssoCloudId;
      try {
        const secCloud = await cloudRepo().findOne({ where: { id: ssoCloudId } });
        if (secCloud) {
          result.csmCloudName = secCloud.name;
          result.csmInfo = {
            endpoint: String(secCloud.endpoint || '').trim(),
            ignoreTls: !!(secCloud as any)?.config?.ignoreTls,
            username: 'admin',
            encryptedPassword: '+yNpVuicvsiBzpDpeaIq3g==',
            webPort: '8011',
            authPath: '/csm/api/v1.0/authentication/auth',
            getAdminPath: '/csm/api/v1.0/user/getAdmin',
            ssoPath: '/csm/api/v1.0/security/domain/attach/callOnSSO',
          };
        }
      } catch (e) {
        console.warn('SASE Info: Failed to fetch CSM cloud info', e);
      }
      result.ssoEndpoint = `/api/clouds/${ssoCloudId}/csm/security/domain/attach/callOnSSO`;
    }

    return res.json(result);
  } catch (err: any) {
    console.error('[SASE] info error', err);
    return res.status(500).json({ message: err?.message || '内部错误' });
  }
});
