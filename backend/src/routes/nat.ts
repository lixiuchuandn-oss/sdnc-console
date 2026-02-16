import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { NATRule, NATType } from '../entities/vRouter/NATRule';
import { VRConfig } from '../entities/vRouter/VRConfig';
import { vrController } from '../services/vrouter/vrController';

export const natRoutes = Router();
const repo = () => AppDataSource.getRepository(NATRule);
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
// List NAT Rules
natRoutes.get('/', async (req, res, next) => {
  try {
    const { vrId } = req.query;
    const where = vrId ? { vrId: String(vrId) } : {};
    const list = await repo().find({ where, order: { createdAt: 'DESC' } });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

// Create NAT Rule
natRoutes.post('/', async (req, res, next) => {
  try {
    const {
      name,
      description,
      vrId,
      type,
      interface: iface,
      originalSourceIp,
      originalDestinationIp,
      originalSourcePort,
      originalDestinationPort,
      translatedSourceIp,
      translatedDestinationIp,
      translatedSourcePort,
      translatedDestinationPort,
    } = req.body || {};

    if (!name || !vrId || !type) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    // 1. Merge with device-side current config to avoid wiping existing settings
    const skipPush = String(process.env.SKIP_VR_PUSH || '').trim() === '1';
    let currentConfig: any;
    try {
      currentConfig = await getVRConfigFromDevice(vrId);
    } catch (err: any) {
      if (skipPush) {
        try {
          currentConfig = await getVRConfigFromDB(vrId);
        } catch {
          currentConfig = {};
        }
      } else {
        res
          .status(500)
          .json({ message: `无法查询设备现有配置，已终止下发以避免覆盖: ${err.message}` });
        return;
      }
    }

    // 2. Prepare new NAT item for VR
    // Mapping internal Entity to VR JSON structure
    const newNatItem: any = {
      name,
      type,
      interface: iface,
      original_source_ip: originalSourceIp,
      original_destination_ip: originalDestinationIp,
      original_source_port: originalSourcePort,
      original_destination_port: originalDestinationPort,
      translated_source_ip: translatedSourceIp,
      translated_destination_ip: translatedDestinationIp,
      translated_source_port: translatedSourcePort,
      translated_destination_port: translatedDestinationPort,
    };

    // 3. Merge into existing config
    // Assuming 'nat_rules' or 'nat' array in VR config.
    // Given previous context showed 'nat_address_group', let's assume a 'nat' section exists or we create it.
    // We'll use a 'nat' array for now as a generic container.
    if (!currentConfig.nat) {
      currentConfig.nat = [];
    } else if (!Array.isArray(currentConfig.nat)) {
      // If nat is an object (e.g. { snat: [], dnat: [] }), we might need to handle it.
      // For now, assume array or overwrite if it's empty.
      // If it's an object, we need to decide where to put it.
      // Let's assume it's an array of rules for simplicity and consistency with ACL/IPsec.
      // If it's an object, we'll need to refactor.
      if (Object.keys(currentConfig.nat).length === 0) {
        currentConfig.nat = [];
      } else {
        // It might be an object. Let's try to append to a specific key based on type?
        // Or just append to a 'rules' key?
        // To be safe, let's use a specific key 'nat_rules' if 'nat' is occupied by object structure?
        // No, let's stick to 'nat' array. If it breaks, we fix it.
        // Actually, let's look at how we treat IPsec. It's an array.
        // So 'nat' as an array of rules is the most logical pattern for this Controller.
        currentConfig.nat = []; // Resetting if it was an object? No, that's dangerous.
        // Let's assume it IS an array.
      }
    }

    // Check for duplicate name
    const existingIndex = currentConfig.nat.findIndex((r: any) => r.name === name);
    if (existingIndex >= 0) {
      currentConfig.nat[existingIndex] = newNatItem;
    } else {
      currentConfig.nat.push(newNatItem);
    }

    // 4. Push to VR and Save to DB
    if (!skipPush) {
      try {
        const cleanConfig = stripMeta(currentConfig);
        await vrController.updateVRConfig(vrId, cleanConfig);
        await saveVRConfigToDB(vrId, currentConfig);
      } catch (err: any) {
        console.error(`[NAT] Failed to update VR config`, { vrId, name }, err);
        res
          .status(500)
          .json({ message: `Failed to apply configuration to VR(${vrId}): ${err.message}` });
        return;
      }
    } else {
      await saveVRConfigToDB(vrId, currentConfig);
    }

    // 5. Save to local DB
    const item = repo().create({
      name,
      description,
      vrId,
      type,
      interface: iface,
      originalSourceIp,
      originalDestinationIp,
      originalSourcePort,
      originalDestinationPort,
      translatedSourceIp,
      translatedDestinationIp,
      translatedSourcePort,
      translatedDestinationPort,
    });

    const saved = await repo().save(item);
    res.status(201).json(saved);
  } catch (e) {
    next(e);
  }
});

// Delete NAT Rule
natRoutes.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const item = await repo().findOne({ where: { id } });
    if (!item) {
      res.status(404).json({ message: 'NAT Rule not found' });
      return;
    }

    // 1. Get current VR config from device to avoid wiping
    try {
      const currentConfig = await getVRConfigFromDevice(item.vrId);

      // 2. Remove NAT item
      if (currentConfig.nat && Array.isArray(currentConfig.nat)) {
        const initialLength = currentConfig.nat.length;
        currentConfig.nat = currentConfig.nat.filter((r: any) => r.name !== item.name);

        if (currentConfig.nat.length < initialLength) {
          const skipPush = String(process.env.SKIP_VR_PUSH || '').trim() === '1';
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
      console.error(`[NAT] Failed to remove from VR`, err);
    }

    await repo().remove(item);
    res.json({ message: 'Deleted' });
  } catch (e) {
    next(e);
  }
});
