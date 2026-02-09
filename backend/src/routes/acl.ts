import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { ACLRule, ACLAction, ACLProtocol } from '../entities/vRouter/ACLRule';
import { VRConfig } from '../entities/vRouter/VRConfig';
import { vrController } from '../services/vrController';
import { syncACLToVRConfig, syncGroupToVRs } from './aclGroups';

export const aclRoutes = Router();
const repo = () => AppDataSource.getRepository(ACLRule);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

// Helpers
const getVRConfigFromDB = async (uuid: string) => {
  const record = await vrConfigRepo().findOne({ where: { uuid } });
  if (!record) {
    throw new Error(`VR config not found in database for UUID: ${uuid}`);
  }
  try {
    return JSON.parse(record.config_json);
  } catch (e) {
    throw new Error(`Failed to parse VR config JSON for UUID: ${uuid}`);
  }
};

const saveVRConfigToDB = async (uuid: string, config: any) => {
  let record = await vrConfigRepo().findOne({ where: { uuid } });
  const jsonStr = JSON.stringify(config);

  if (record) {
    record.config_json = jsonStr;
    await vrConfigRepo().save(record);
  } else {
    record = vrConfigRepo().create({ uuid, config_json: jsonStr });
    await vrConfigRepo().save(record);
  }
};

const stripMeta = (obj: any) => {
  if (!obj || typeof obj !== 'object') return obj;
  const { msg, code, report_config_status, updateDate, createDate, _id, requestId, ...rest } = obj;
  return rest;
};

const getVRConfigFromDevice = async (uuid: string) => {
  const resp = await vrController.getVRConfig(uuid);
  const data = resp && resp.data ? resp.data : resp;
  if (!data || typeof data !== 'object') return {};
  return stripMeta(data);
};

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

    // 1. Sync latest state to VR Config (Source of Truth)
    // This ensures groups and loose rules are correctly formatted in config_json
    const fullConfig = await syncACLToVRConfig(vrId);

    // 2. Push to Device
    const cleanConfig = stripMeta(fullConfig);
    try {
      await vrController.updateVRConfig(vrId, cleanConfig);
    } catch (err: any) {
      console.error(`[ACL Push] Failed to update VR config for ${vrId}`, err);
      res.status(500).json({ message: `Failed to apply configuration to VR: ${err.message}` });
      return;
    }

    res.json({ status: 'success', data: cleanConfig });
  } catch (e) {
    next(e);
  }
});
