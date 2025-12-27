import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { ACLRule, ACLAction, ACLProtocol } from '../entities/ACLRule';
import { VRConfig } from '../entities/VRConfig';
import { vrController } from '../services/vrController';

export const aclRoutes = Router();
const repo = () => AppDataSource.getRepository(ACLRule);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

// Helpers (Duplicated from ipsec.ts for now to keep isolation)
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
  const data = (resp && resp.data) ? resp.data : resp;
  if (!data || typeof data !== 'object') return {};
  return stripMeta(data);
};

const deepMerge = (a: any, b: any): any => {
  if (a === null || typeof a !== 'object') return typeof b !== 'undefined' ? b : a;
  if (b === null || typeof b !== 'object') return typeof b !== 'undefined' ? b : a;
  if (Array.isArray(a) && Array.isArray(b)) return b.length ? b : a;
  const out: any = { ...a };
  for (const k of Object.keys(b)) {
    const av = a[k];
    const bv = b[k];
    if (av && typeof av === 'object' && !Array.isArray(av) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(av, bv);
    } else {
      out[k] = typeof bv !== 'undefined' ? bv : av;
    }
  }
  return out;
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

// Create ACL Rule
aclRoutes.post('/', async (req, res, next) => {
  try {
    const { 
      name, description, vrId, priority, action, protocol, 
      sourceIp, destinationIp, sourcePort, destinationPort 
    } = req.body || {};

    if (!name || !vrId) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    // 1. Merge with device-side current config to avoid wiping existing settings
    const skipPush = String(process.env.SKIP_VR_PUSH || '').trim() === '1';
    let baseConfig: any;
    let baseFrom: 'device' | 'db' | 'empty' = 'empty';
    try {
      baseConfig = await getVRConfigFromDevice(vrId);
      baseFrom = 'device';
    } catch (err: any) {
      if (skipPush) {
        // Dev mode: fall back to DB or empty to allow local save
        try {
          baseConfig = await getVRConfigFromDB(vrId);
          baseFrom = 'db';
        } catch {
          baseConfig = {};
          baseFrom = 'empty';
        }
      } else {
        res.status(500).json({ message: `无法查询设备现有配置，已终止下发以避免覆盖: ${err.message}` });
        return;
      }
    }
    if (!skipPush) {
      const cleanBase = stripMeta(baseConfig);
      if (!cleanBase || Object.keys(cleanBase).length === 0) {
        // 尝试使用数据库作为基准，避免覆盖
        try {
          const dbCfg = await getVRConfigFromDB(vrId);
          if (dbCfg && Object.keys(dbCfg).length) {
            baseConfig = dbCfg;
            baseFrom = 'db';
          } else {
            res.status(409).json({ message: '设备与数据库配置均为空，拒绝下发以避免覆盖，请先回读/保存标准配置' });
            return;
          }
        } catch {
          res.status(409).json({ message: '设备配置为空且无法读取数据库配置，拒绝下发以避免覆盖' });
          return;
        }
      }
    }
    const originalConfig = JSON.parse(JSON.stringify(stripMeta(baseConfig)));

    // 2. Prepare new ACL item for VR
    const newAclItem: any = {
      name,
      priority: Number(priority) || 100,
      action: action || ACLAction.PERMIT,
      protocol: protocol || ACLProtocol.ANY,
      source_ip: sourceIp || 'any',
      destination_ip: destinationIp || 'any',
      source_port: sourcePort || 'any',
      destination_port: destinationPort || 'any'
    };
    // Add description if supported by VR, otherwise skip

    // 3. Merge into existing config
    if (!baseConfig.acl) {
      baseConfig.acl = [];
    } else if (!Array.isArray(baseConfig.acl)) {
      baseConfig.acl = [];
    }
    
    // Check for duplicate name
    const existingIndex = baseConfig.acl.findIndex((r: any) => r.name === name);
    if (existingIndex >= 0) {
      baseConfig.acl[existingIndex] = newAclItem;
    } else {
      baseConfig.acl.push(newAclItem);
    }

    const cleanBefore = originalConfig;
    const cleanAfter = stripMeta(baseConfig);
    const a = { ...cleanBefore }; delete (a as any).acl;
    const b = { ...cleanAfter }; delete (b as any).acl;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      res.status(409).json({ message: '配置异常：非ACL字段发生变化，已终止下发' });
      return;
    }

    // 4. Push to VR and Save to DB
    if (!skipPush) {
      try {
        const cleanConfig = stripMeta(baseConfig);
        await vrController.updateVRConfig(vrId, cleanConfig);
        await saveVRConfigToDB(vrId, baseConfig);
      } catch (err: any) {
        console.error(`[ACL] Failed to update VR config`, { vrId, name }, err);
        res.status(500).json({ message: `Failed to apply configuration to VR(${vrId}): ${err.message}` });
        return;
      }
    } else {
      await saveVRConfigToDB(vrId, baseConfig);
    }

    // 5. Save to local DB
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
      destinationPort
    });

    const saved = await repo().save(item);
    res.status(201).json(saved);
  } catch (e) {
    next(e);
  }
});

// Delete ACL Rule
aclRoutes.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const item = await repo().findOne({ where: { id } });
    if (!item) {
      res.status(404).json({ message: 'ACL Rule not found' });
      return;
    }

    // 1. Get current VR config from device to avoid wiping
    try {
      const currentConfig = await getVRConfigFromDevice(item.vrId);
      // 2. Remove ACL item
      if (currentConfig.acl && Array.isArray(currentConfig.acl)) {
        const initialLength = currentConfig.acl.length;
        currentConfig.acl = currentConfig.acl.filter((r: any) => r.name !== item.name);
        const skipPush = String(process.env.SKIP_VR_PUSH || '').trim() === '1';
        if (currentConfig.acl.length < initialLength) {
          if (!skipPush) {
            const cleanConfig = stripMeta(currentConfig);
            await vrController.updateVRConfig(item.vrId, cleanConfig);
            await saveVRConfigToDB(item.vrId, currentConfig);
          } else {
            await saveVRConfigToDB(item.vrId, currentConfig);
          }
        }
      }
    } catch (err: any) {
      console.error(`[ACL] Failed to remove from VR`, err);
      // Continue to delete local record
    }

    await repo().remove(item);
    res.json({ message: 'Deleted' });
  } catch (e) {
    next(e);
  }
});
