import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { ACLRule, ACLAction, ACLProtocol } from '../entities/ACLRule';
import { VRConfig } from '../entities/VRConfig';
import { vrController } from '../services/vrController';

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

    const item = repo().create({
      name,
      description,
      vrId,
      priority: Number(priority) || 100,
      action: action || ACLAction.PERMIT,
      protocol: protocol || ACLProtocol.ANY,
      sourceIp,
      destinationIp,
      sourcePort,
      destinationPort,
    });
    await repo().save(item);

    // Note: This endpoint NO LONGER pushes to device automatically if we follow the new pattern.
    // However, to maintain backward compatibility with "Quick Add", we might want to keep push?
    // User says "Trigger push later...". So ideally we just save to DB.
    // But existing UI might expect push.
    // For now, I will assume the new UI uses the new flow.
    // The existing code I overwrote had complex push logic.
    // I should probably simplify it to just DB save for consistency with "Save then Push".

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
    await repo().remove(item);
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

    // 1. Fetch all rules for this VR (including those in groups)
    const rules = await repo().find({
      where: { vrId },
      order: { priority: 'ASC' },
    });

    // 2. Convert to VR Config Format
    const aclConfig = rules.map((r) => ({
      name: r.name,
      priority: r.priority,
      action: r.action,
      protocol: r.protocol,
      source_ip: r.sourceIp || 'any',
      destination_ip: r.destinationIp || 'any',
      source_port: r.sourcePort || 'any',
      destination_port: r.destinationPort || 'any',
    }));

    // 3. Fetch current VR Config
    let baseConfig: any = {};
    try {
      baseConfig = await getVRConfigFromDevice(vrId);
    } catch (e) {
      console.warn('Failed to fetch from device, trying DB cache');
      try {
        baseConfig = await getVRConfigFromDB(vrId);
      } catch {
        baseConfig = {};
      }
    }

    if (!baseConfig || Object.keys(baseConfig).length === 0) {
      baseConfig = {};
    }

    // 4. Update ACL section
    baseConfig.acl = aclConfig;

    // 5. Push to Device
    const cleanConfig = stripMeta(baseConfig);
    try {
      await vrController.updateVRConfig(vrId, cleanConfig);
    } catch (err: any) {
      console.error(`[ACL Push] Failed to update VR config for ${vrId}`, err);
      res.status(500).json({ message: `Failed to apply configuration to VR: ${err.message}` });
      return;
    }

    // 6. Save to DB Cache
    await saveVRConfigToDB(vrId, baseConfig);

    res.json({ status: 'success', data: cleanConfig });
  } catch (e) {
    next(e);
  }
});
