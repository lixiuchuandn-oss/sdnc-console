import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { SecurityZone } from '../entities/SecurityZone';
import { ProtectionObject } from '../entities/ProtectionObject';
import { ServiceChain } from '../entities/ServiceChain';
import { Tenant } from '../entities/Tenant';
import { Like } from 'typeorm';

const router = Router();

const zoneRepo = () => AppDataSource.getRepository(SecurityZone);
const objRepo = () => AppDataSource.getRepository(ProtectionObject);
const chainRepo = () => AppDataSource.getRepository(ServiceChain);
const tenantRepo = () => AppDataSource.getRepository(Tenant);

// Helper to get tenant context
const getTenantContext = (req: any) => {
  const user = req.user;
  // If user is a tenant user, return their tenant/org IDs
  if (user && (user as any).tenantId) {
    return {
      tenantId: (user as any).tenantId,
      organizationId: (user as any).organizationId,
    };
  }
  // If user is system admin, they might pass tenantId/orgId in query or body,
  // or we might want to return null to indicate no restriction (or handle differently).
  // For now, let's assume system admins can see everything, but if they want to create, they must provide it.
  return null;
};

// --- Security Zones ---

// List Zones
router.get('/security-zones', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = {};

    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }

    if (req.query.keyword) {
      where.name = Like(`%${req.query.keyword}%`);
    }

    const list = await zoneRepo().find({ where, order: { createdAt: 'DESC' } });

    const tenantIds = Array.from(
      new Set(list.map((z) => z.tenantId).filter((id): id is string => !!id)),
    );
    let tenantMap: Record<string, string> = {};
    if (tenantIds.length) {
      const tenants = await tenantRepo().find({ where: tenantIds.map((id) => ({ id })) as any });
      tenantMap = tenants.reduce(
        (acc, t) => {
          acc[t.id] = t.name;
          return acc;
        },
        {} as Record<string, string>,
      );
    }

    const augmented = list.map((z) => ({
      ...z,
      tenantName: z.tenantId ? tenantMap[z.tenantId] || undefined : undefined,
    }));

    res.json(augmented);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch security zones', error: String(err) });
  }
});

// Get Zone
router.get('/security-zones/:id', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = { id: req.params.id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const item = await zoneRepo().findOne({ where });
    if (!item) return res.status(404).json({ message: 'Security Zone not found' });

    let tenantName: string | undefined = undefined;
    if (item.tenantId) {
      try {
        const tenant = await tenantRepo().findOne({ where: { id: item.tenantId } });
        tenantName = tenant?.name || undefined;
      } catch {}
    }

    res.json({ ...item, tenantName });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching security zone', error: String(err) });
  }
});

// Create Zone
router.post('/security-zones', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const payload = req.body;

    const entity = new SecurityZone();
    entity.name = payload.name;
    entity.description = payload.description;
    entity.clusterName = payload.clusterName;
    entity.status = payload.status || 'active';

    if (ctx) {
      entity.tenantId = ctx.tenantId;
      entity.organizationId = ctx.organizationId;
    } else {
      // Allow admin to set tenant/org if provided, otherwise leave null (system level?)
      if (payload.tenantId) entity.tenantId = payload.tenantId;
      if (payload.organizationId) entity.organizationId = payload.organizationId;
    }

    const saved = await zoneRepo().save(entity);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create security zone', error: String(err) });
  }
});

// Update Zone
router.patch('/security-zones/:id', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = { id: req.params.id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const entity = await zoneRepo().findOne({ where });
    if (!entity) return res.status(404).json({ message: 'Security Zone not found' });

    const payload = req.body;
    if (payload.name !== undefined) entity.name = payload.name;
    if (payload.description !== undefined) entity.description = payload.description;
    if (payload.clusterName !== undefined) entity.clusterName = payload.clusterName;
    if (payload.status !== undefined) entity.status = payload.status;

    const saved = await zoneRepo().save(entity);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update security zone', error: String(err) });
  }
});

// Delete Zone
router.delete('/security-zones/:id', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = { id: req.params.id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const result = await zoneRepo().delete(where);
    if (result.affected === 0) return res.status(404).json({ message: 'Security Zone not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete security zone', error: String(err) });
  }
});

// --- Protection Objects ---

// List Objects
router.get('/protection-objects', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = {};
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    if (req.query.keyword) where.name = Like(`%${req.query.keyword}%`);
    if (req.query.type) where.type = req.query.type;
    if (req.query.securityZoneId) where.securityZoneId = req.query.securityZoneId;

    const list = await objRepo().find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['securityZone'],
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch protection objects', error: String(err) });
  }
});

// Create Object
router.post('/protection-objects', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const payload = req.body;

    const entity = new ProtectionObject();
    entity.name = payload.name;
    entity.type = payload.type;
    entity.value = payload.value;
    entity.description = payload.description;
    entity.securityZoneId = payload.securityZoneId;

    if (ctx) {
      entity.tenantId = ctx.tenantId;
      entity.organizationId = ctx.organizationId;
    } else {
      if (payload.tenantId) entity.tenantId = payload.tenantId;
      if (payload.organizationId) entity.organizationId = payload.organizationId;
    }

    const saved = await objRepo().save(entity);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create protection object', error: String(err) });
  }
});

// Update Object
router.patch('/protection-objects/:id', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = { id: req.params.id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const entity = await objRepo().findOne({ where });
    if (!entity) return res.status(404).json({ message: 'Protection Object not found' });

    const payload = req.body;
    if (payload.name !== undefined) entity.name = payload.name;
    if (payload.type !== undefined) entity.type = payload.type;
    if (payload.value !== undefined) entity.value = payload.value;
    if (payload.description !== undefined) entity.description = payload.description;
    if (payload.securityZoneId !== undefined) entity.securityZoneId = payload.securityZoneId;

    const saved = await objRepo().save(entity);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update protection object', error: String(err) });
  }
});

// Delete Object
router.delete('/protection-objects/:id', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = { id: req.params.id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const result = await objRepo().delete(where);
    if (result.affected === 0)
      return res.status(404).json({ message: 'Protection Object not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete protection object', error: String(err) });
  }
});

// --- Service Chains ---

// List Chains
router.get('/service-chains', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = {};
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    if (req.query.keyword) where.name = Like(`%${req.query.keyword}%`);
    if (req.query.securityZoneId) where.securityZoneId = req.query.securityZoneId;

    const list = await chainRepo().find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['securityZone', 'tenant', 'organization'],
    });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch service chains', error: String(err) });
  }
});

// Create Chain
router.post('/service-chains', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const payload = req.body;

    const entity = new ServiceChain();
    entity.name = payload.name;
    entity.clusterName = payload.clusterName;
    entity.type = payload.type;
    entity.status = payload.status || 'active';
    entity.description = payload.description;
    entity.securityZoneId = payload.securityZoneId;
    entity.domainId = payload.domainId;
    entity.domainName = payload.domainName;

    entity.steeringMode = payload.steeringMode;
    entity.securityServices = payload.securityServices; // JSON/Text
    entity.protectionTargets = payload.protectionTargets; // JSON/Text

    if (ctx) {
      entity.tenantId = ctx.tenantId;
      entity.organizationId = ctx.organizationId;
    } else {
      if (payload.tenantId) entity.tenantId = payload.tenantId;
      if (payload.organizationId) entity.organizationId = payload.organizationId;
    }

    const saved = await chainRepo().save(entity);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create service chain', error: String(err) });
  }
});

// Update Chain
router.patch('/service-chains/:id', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = { id: req.params.id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const entity = await chainRepo().findOne({ where });
    if (!entity) return res.status(404).json({ message: 'Service Chain not found' });

    const payload = req.body;
    if (payload.name !== undefined) entity.name = payload.name;
    if (payload.clusterName !== undefined) entity.clusterName = payload.clusterName;
    if (payload.type !== undefined) entity.type = payload.type;
    if (payload.status !== undefined) entity.status = payload.status;
    if (payload.description !== undefined) entity.description = payload.description;
    if (payload.securityZoneId !== undefined) entity.securityZoneId = payload.securityZoneId;
    if (payload.domainId !== undefined) entity.domainId = payload.domainId;
    if (payload.domainName !== undefined) entity.domainName = payload.domainName;

    if (payload.steeringMode !== undefined) entity.steeringMode = payload.steeringMode;
    if (payload.securityServices !== undefined) entity.securityServices = payload.securityServices;
    if (payload.protectionTargets !== undefined)
      entity.protectionTargets = payload.protectionTargets;

    const saved = await chainRepo().save(entity);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update service chain', error: String(err) });
  }
});

// Delete Chain
router.delete('/service-chains/:id', async (req, res) => {
  try {
    const ctx = getTenantContext(req);
    const where: any = { id: req.params.id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const result = await chainRepo().delete(where);
    if (result.affected === 0) return res.status(404).json({ message: 'Service Chain not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete service chain', error: String(err) });
  }
});

export default router;
