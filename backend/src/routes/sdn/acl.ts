import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { ACLRule, ACLAction, ACLProtocol } from '../../entities/vRouter/ACLRule';
import {
  pushVRConfig,
  stripMeta,
  mapDeployErrorToResponse,
} from '../../services/vrouter/vrConfigDeploy';
import { syncACLToVRConfig, syncGroupToVRs } from './aclGroups';

export const aclRoutes = Router();
const repo = () => AppDataSource.getRepository(ACLRule);

// List ACL Rules
aclRoutes.get('/', async (req, res, next) => {
  try {
    const { vrId } = req.query;
    const where = vrId ? { vrId: String(vrId) } : {};
    const list = await repo().find({ where, order: { priority: 'ASC' } });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

// Create ACL Rule (Legacy/Direct)
aclRoutes.post('/', async (req, res, next) => {
  try {
    const {
      name,
      description,
      vrId,
      priority,
      action,
      protocol,
      sourceIp,
      destinationIp,
      sourcePort,
      destinationPort,
    } = req.body || {};

    if (!name || !vrId) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    // Strict enforcement: Rules must belong to a group
    // The preferred way is POST /api/acl-groups/:id/rules, but if this endpoint is used, groupId is required.
    const { groupId } = req.body;
    if (!groupId) {
      res.status(400).json({ message: 'Rules must belong to an ACL Group (groupId is required)' });
      return;
    }

    const item = repo().create({
      name,
      description,
      vrId,
      groupId,
      priority: Number(priority) || 100,
      action: action || ACLAction.PERMIT,
      protocol: protocol || ACLProtocol.ANY,
      sourceIp,
      destinationIp,
      sourcePort,
      destinationPort,
    });
    await repo().save(item);

    // Sync to VR Config
    if (groupId) {
      await syncGroupToVRs(groupId);
    } else {
      // Should not happen due to validation above, but fallback
      await syncACLToVRConfig(vrId);
    }

    res.status(201).json(item);
  } catch (e) {
    next(e);
  }
});

// Delete ACL Rule
aclRoutes.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const item = await repo().findOneBy({ id });
    if (!item) {
      res.status(404).json({ message: 'Rule not found' });
      return;
    }
    const vrId = item.vrId;
    await repo().remove(item);

    // Sync to VR Config
    if (vrId) {
      await syncACLToVRConfig(vrId);
    }

    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// Deploy/Push ACL Configuration
aclRoutes.post('/deploy/push', async (req, res, next) => {
  try {
    const { vrId } = req.body;
    if (!vrId) {
      res.status(400).json({ message: 'vrId is required' });
      return;
    }

    const fullConfig = await syncACLToVRConfig(vrId);
    const acknowledgeDrift = req.body?.acknowledgeDrift === true;
    try {
      const result = await pushVRConfig({
        vrId,
        domain: 'acl',
        platformConfig: fullConfig,
        acknowledgeDrift,
      });
      res.json({
        status: 'success',
        data: stripMeta(result.mergedConfig),
        driftWarnings: result.driftWarnings,
      });
    } catch (err: unknown) {
      const { status, body } = mapDeployErrorToResponse(err);
      console.error(`[ACL Push] Failed to update VR config for ${vrId}`, err);
      res.status(status).json({ message: body.message, code: body.code, conflicts: body.conflicts });
    }
  } catch (e) {
    next(e);
  }
});
