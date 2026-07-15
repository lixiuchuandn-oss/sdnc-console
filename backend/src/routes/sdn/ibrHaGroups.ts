import { Router } from 'express';
import {
  IbrHaGroupError,
  ibrHaGroupService,
} from '../../services/vrouter/ibrHaGroupService';

export const ibrHaGroupRoutes = Router();

/** HA 组挂在 IBR 配置权限下（与前端列表/RouteSpec 一致） */
function hasRead(req: import('express').Request) {
  const role = (req as any).user?.role;
  const perms: string[] = Array.isArray((req as any).user?.permissions)
    ? (req as any).user?.permissions
    : [];
  return (
    role === 'super_admin' ||
    perms.includes('networks.vr-config:read') ||
    perms.includes('networks.vr-config:write')
  );
}

function hasWrite(req: import('express').Request) {
  const role = (req as any).user?.role;
  const perms: string[] = Array.isArray((req as any).user?.permissions)
    ? (req as any).user?.permissions
    : [];
  return role === 'super_admin' || perms.includes('networks.vr-config:write');
}

function mapError(res: import('express').Response, err: unknown) {
  if (err instanceof IbrHaGroupError) {
    return res.status(err.statusCode).json({ code: err.statusCode, message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ code: 500, message });
}

ibrHaGroupRoutes.get('/', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:read' });
  }
  try {
    const data = await ibrHaGroupService.list();
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.post('/', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const body = req.body ?? {};
    const data = await ibrHaGroupService.create({
      name: body.name,
      description: body.description,
      primaryUuid: body.primaryUuid,
      backupUuid: body.backupUuid,
      vrrpIntent: body.vrrpIntent,
    });
    return res.status(201).json({ code: 201, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.get('/:id', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:read' });
  }
  try {
    const data = await ibrHaGroupService.getById(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.patch('/:id', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const data = await ibrHaGroupService.update(String(req.params.id || '').trim(), {
      name: req.body?.name,
      description: req.body?.description,
      vrrpIntent: req.body?.vrrpIntent,
    });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.put('/:id/members', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const data = await ibrHaGroupService.replaceMembers(String(req.params.id || '').trim(), {
      primaryUuid: req.body?.primaryUuid,
      backupUuid: req.body?.backupUuid,
    });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.delete('/:id', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    await ibrHaGroupService.remove(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    return mapError(res, err);
  }
});

/** 将 vrrpIntent 下发至主备 IBR（读设备 → 定点 merge → 全量 POST） */
ibrHaGroupRoutes.post('/:id/deploy', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.vr-config:write' });
  }
  try {
    const data = await ibrHaGroupService.deploy(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});
