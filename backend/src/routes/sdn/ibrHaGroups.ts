import { Router } from 'express';
import {
  IbrHaGroupError,
  ibrHaGroupService,
} from '../../services/vrouter/ibrHaGroupService';

export const ibrHaGroupRoutes = Router();

function mapError(res: import('express').Response, err: unknown) {
  if (err instanceof IbrHaGroupError) {
    return res.status(err.statusCode).json({ code: err.statusCode, message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ code: 500, message });
}

ibrHaGroupRoutes.get('/', async (_req, res) => {
  try {
    const data = await ibrHaGroupService.list();
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.post('/', async (req, res) => {
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
  try {
    const data = await ibrHaGroupService.getById(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

ibrHaGroupRoutes.patch('/:id', async (req, res) => {
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
  try {
    await ibrHaGroupService.remove(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    return mapError(res, err);
  }
});
