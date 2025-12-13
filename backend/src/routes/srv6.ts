import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { Srv6Tunnel, Srv6Status } from '../entities/Srv6Tunnel';

export const srv6Routes = Router();
const repo = () => AppDataSource.getRepository(Srv6Tunnel);

// 列表：获取所有 SRv6 隧道
srv6Routes.get('/', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:read') || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.srv6:read' });
      }
    }
    const list = await repo().find({ order: { createdAt: 'DESC' } });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

// 创建：新增 SRv6 隧道（初始状态为 creating）
srv6Routes.post('/', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.srv6:write' });
      }
    }
    const { name, peA, peB, ceA, ceB } = req.body || {};
    if (!name || !peA || !peB || !ceA || !ceB) {
      res.status(400).json({ message: '缺少必要字段：name, peA, peB, ceA, ceB' });
      return;
    }
    const item = repo().create({ name, peA: String(peA), peB: String(peB), ceA: String(ceA), ceB: String(ceB), status: Srv6Status.CREATING });
    const saved = await repo().save(item);
    // 模拟异步完成：短暂延迟后置为 available
    setTimeout(async () => {
      try {
        await repo().update({ id: saved.id }, { status: Srv6Status.AVAILABLE });
      } catch (e) {
        // ignore
      }
    }, 1000);
    res.status(201).json(saved);
  } catch (e) {
    next(e);
  }
});

// 获取单条：根据 ID 获取隧道详情
srv6Routes.get('/:id', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:read') || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.srv6:read' });
      }
    }
    const id = String(req.params.id);
    const item = await repo().findOne({ where: { id } });
    if (!item) {
      res.status(404).json({ message: '未找到隧道' });
      return;
    }
    res.json(item);
  } catch (e) {
    next(e);
  }
});

// 删除：根据 ID 删除隧道
srv6Routes.delete('/:id', async (req, res, next) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.srv6:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.srv6:write' });
      }
    }
    const id = String(req.params.id);
    const item = await repo().findOne({ where: { id } });
    if (!item) {
      res.status(404).json({ message: '未找到隧道' });
      return;
    }
    await repo().delete({ id });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default srv6Routes;