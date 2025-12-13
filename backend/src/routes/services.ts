import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { ServiceCatalog } from '../entities/ServiceCatalog';

const router = Router();
const repo = () => AppDataSource.getRepository(ServiceCatalog);

// List
router.get('/', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('security.services:read') || perms.includes('security.services:write'))) {
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
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
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
    const strategiesArr = Array.isArray((payload as any).strategies) ? (payload as any).strategies : [];
    entity.strategies = strategiesArr.join(',');
    const instancesArr = Array.isArray((payload as any).instances) ? (payload as any).instances : [];
    entity.instances = JSON.stringify(instancesArr);
    const saved = await repo().save(entity);
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
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('security.services:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 security.services:write' });
      }
    }
    const id = req.params.id;
    const existing = await repo().findOne({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Service not found' });
    }
    const partial = req.body as Partial<ServiceCatalog> & { strategies?: string[]; instances?: string[] };
    if (partial.name !== undefined) existing.name = partial.name as any;
    if (partial.domainId !== undefined) existing.domainId = String(partial.domainId);
    if (partial.domainName !== undefined) existing.domainName = partial.domainName as any;
    if (partial.type !== undefined) existing.type = partial.type as any;
    if (partial.instanceCount !== undefined) existing.instanceCount = Number(partial.instanceCount);
    if (partial.status !== undefined) existing.status = partial.status as any;
    if (partial.strategies !== undefined) existing.strategies = Array.isArray(partial.strategies) ? partial.strategies.join(',') : String(partial.strategies || '');
    if (partial.instances !== undefined) existing.instances = Array.isArray(partial.instances) ? JSON.stringify(partial.instances) : String(partial.instances || '');
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
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
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