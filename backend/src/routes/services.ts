import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { ServiceCatalog } from '../entities/ServiceCatalog';
import { SecurityDomain } from '../entities/SecurityDomain';
import { ACLRule, ACLAction, ACLProtocol } from '../entities/vRouter/ACLRule';
import { vrController } from '../services/vrouter/vrController';
import { VRConfig } from '../entities/vRouter/VRConfig';

const router = Router();
const repo = () => AppDataSource.getRepository(ServiceCatalog);
const domainRepo = () => AppDataSource.getRepository(SecurityDomain);
const aclRepo = () => AppDataSource.getRepository(ACLRule);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

// Helper to get VR config (simplified from acl.ts)
async function getVRConfig(vrId: string) {
  try {
    const config = await vrController.getVRConfig(vrId);
    return { config, from: 'device' };
  } catch (e) {
    const dbConfig = await vrConfigRepo().findOne({ where: { uuid: vrId } });
    if (dbConfig?.config_json) {
      try {
        return { config: JSON.parse(dbConfig.config_json), from: 'db' };
      } catch {
        return { config: {}, from: 'error' };
      }
    }
    return { config: {}, from: 'empty' };
  }
}

// List
router.get('/', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('security.services:read') ||
          perms.includes('security.services:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 security.services:read' });
      }
    }
    const list = await repo().find({ order: { createdAt: 'DESC' } });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch services', error: String(err) });
  }
});

// Create
router.post('/', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('security.services:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 security.services:write' });
      }
    }
    const payload = req.body as Partial<ServiceCatalog>;
    const entity = new ServiceCatalog();
    entity.name = payload.name || '未命名服务';
    entity.domainId = String(payload.domainId || '');
    entity.domainName = payload.domainName;
    entity.type = (payload.type as any) || 'vm';
    entity.instanceCount = Number(payload.instanceCount || 0);
    entity.status = (payload.status as any) || 'running';
    entity.description = payload.description as any;
    entity.owner = payload.owner as any;
    entity.version = payload.version as any;
    const strategiesArr = Array.isArray((payload as any).strategies)
      ? (payload as any).strategies
      : [];
    entity.strategies = strategiesArr.join(',');
    const policyIdsArr = Array.isArray((payload as any).policyIds)
      ? (payload as any).policyIds
      : [];
    entity.policyIds = policyIdsArr.join(',');
    const networkPolicyIdsArr = Array.isArray((payload as any).networkPolicyIds)
      ? (payload as any).networkPolicyIds
      : [];
    entity.networkPolicyIds = networkPolicyIdsArr.join(',');
    const hostPolicyIdsArr = Array.isArray((payload as any).hostPolicyIds)
      ? (payload as any).hostPolicyIds
      : [];
    entity.hostPolicyIds = hostPolicyIdsArr.join(',');

    if ((payload as any).serviceAddresses) {
      entity.instances = JSON.stringify((payload as any).serviceAddresses);
    } else {
      const instancesArr = Array.isArray((payload as any).instances)
        ? (payload as any).instances
        : [];
      entity.instances = JSON.stringify(instancesArr);
    }
    const saved = await repo().save(entity);

    // Auto-create ACL if requested
    const netConfig = (payload as any).networkConfig;
    const instanceIps = (payload as any).instanceIps;
    if (netConfig && netConfig.enableAcl !== false && entity.domainId) {
      try {
        const domain = await domainRepo().findOne({ where: { id: entity.domainId } });
        const vrId =
          domain?.vrUuid || (domain?.vrInstanceIds ? domain.vrInstanceIds.split(',')[0] : '');

        if (vrId && instanceIps && instanceIps.length > 0) {
          const sources =
            netConfig.allowedSourceCidrs && netConfig.allowedSourceCidrs.length > 0
              ? netConfig.allowedSourceCidrs.join(',')
              : netConfig.defaultAction === 'permit'
                ? 'any'
                : '';

          if (sources) {
            const ruleName = `Auto-${entity.name}-${Date.now().toString().slice(-4)}`;
            const dests = instanceIps.join(',');

            // 1. Get Base Config
            const { config: baseConfig } = await getVRConfig(vrId);
            if (!baseConfig.acl) baseConfig.acl = [];

            // 2. Add Rule
            const newRule = {
              name: ruleName,
              priority: 90, // High priority for specific app rules
              action: ACLAction.PERMIT,
              protocol: ACLProtocol.ANY,
              source_ip: sources,
              destination_ip: dests,
              source_port: 'any',
              destination_port: 'any',
            };
            baseConfig.acl.push(newRule);

            // 3. Push & Save
            const skipPush = String(process.env.SKIP_VR_PUSH || '').trim() === '1';
            if (!skipPush) {
              try {
                await vrController.updateVRConfig(vrId, baseConfig);
              } catch (e) {
                console.error('Failed to push auto-ACL to VR', e);
              }
            }

            // Save VR Config to DB
            let vrConfigEntity = await vrConfigRepo().findOne({ where: { uuid: vrId } });
            if (!vrConfigEntity) {
              vrConfigEntity = new VRConfig();
              vrConfigEntity.uuid = vrId;
            }
            vrConfigEntity.config_json = JSON.stringify(baseConfig);
            await vrConfigRepo().save(vrConfigEntity);

            // Save ACL Rule to DB
            const ruleEntity = new ACLRule();
            ruleEntity.name = ruleName;
            ruleEntity.vrId = vrId;
            ruleEntity.priority = 90;
            ruleEntity.action = ACLAction.PERMIT;
            ruleEntity.protocol = ACLProtocol.ANY;
            ruleEntity.sourceIp = sources;
            ruleEntity.destinationIp = dests;
            ruleEntity.sourcePort = 'any';
            ruleEntity.destinationPort = 'any';
            ruleEntity.description = `Auto-generated for App: ${entity.name}`;
            await aclRepo().save(ruleEntity);
          }
        }
      } catch (err) {
        console.error('Failed to auto-create ACL', err);
        // Do not fail the service creation
      }
    }

    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create service', error: String(err) });
  }
});

// Update
router.patch('/:id', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('security.services:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 security.services:write' });
      }
    }
    const id = req.params.id;
    const existing = await repo().findOne({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Service not found' });
    }
    const partial = req.body as Partial<ServiceCatalog> & {
      strategies?: string[];
      instances?: string[];
    };
    if (partial.name !== undefined) existing.name = partial.name as any;
    if (partial.domainId !== undefined) existing.domainId = String(partial.domainId);
    if (partial.domainName !== undefined) existing.domainName = partial.domainName as any;
    if (partial.type !== undefined) existing.type = partial.type as any;
    if (partial.instanceCount !== undefined) existing.instanceCount = Number(partial.instanceCount);
    if (partial.status !== undefined) existing.status = partial.status as any;
    if (partial.description !== undefined) existing.description = partial.description;
    if (partial.owner !== undefined) existing.owner = partial.owner;
    if (partial.version !== undefined) existing.version = partial.version;
    if (partial.strategies !== undefined)
      existing.strategies = Array.isArray(partial.strategies)
        ? partial.strategies.join(',')
        : String(partial.strategies || '');
    if ((partial as any).policyIds !== undefined)
      existing.policyIds = Array.isArray((partial as any).policyIds)
        ? (partial as any).policyIds.join(',')
        : String((partial as any).policyIds || '');
    if ((partial as any).networkPolicyIds !== undefined)
      existing.networkPolicyIds = Array.isArray((partial as any).networkPolicyIds)
        ? (partial as any).networkPolicyIds.join(',')
        : String((partial as any).networkPolicyIds || '');
    if ((partial as any).hostPolicyIds !== undefined)
      existing.hostPolicyIds = Array.isArray((partial as any).hostPolicyIds)
        ? (partial as any).hostPolicyIds.join(',')
        : String((partial as any).hostPolicyIds || '');
    if ((req.body as any).serviceAddresses !== undefined) {
      existing.instances = JSON.stringify((req.body as any).serviceAddresses);
    } else if (partial.instances !== undefined) {
      existing.instances = Array.isArray(partial.instances)
        ? JSON.stringify(partial.instances)
        : String(partial.instances || '');
    }

    if ((req.body as any).servicePorts !== undefined) {
      const portsArr = Array.isArray((req.body as any).servicePorts)
        ? (req.body as any).servicePorts
        : [];
      existing.servicePorts = JSON.stringify(portsArr);
    }
    const saved = await repo().save(existing);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update service', error: String(err) });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('security.services:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 security.services:write' });
      }
    }
    const id = req.params.id;
    await repo().delete({ id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete service', error: String(err) });
  }
});

export default router;
