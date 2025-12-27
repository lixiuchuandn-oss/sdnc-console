import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { IPsecVPN, IPsecStatus } from '../entities/IPsecVPN';
import { VRConfig } from '../entities/VRConfig';
import { vrController } from '../services/vrController';

export const ipsecRoutes = Router();
const repo = () => AppDataSource.getRepository(IPsecVPN);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

// Helper to get config from DB
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

// Helper to save config to DB
const saveVRConfigToDB = async (uuid: string, config: any) => {
  let record = await vrConfigRepo().findOne({ where: { uuid } });
  const jsonStr = JSON.stringify(config);
  
  if (record) {
    record.config_json = jsonStr;
    await vrConfigRepo().save(record);
  } else {
    // Should not happen if get succeeded, but for safety
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

// Helper to extract IPs from VR config
const getVrIps = (config: any) => {
  let publicIp = '';
  let privateIp = '';

  if (config?.ipsec_preset) {
    publicIp = String(config.ipsec_preset.public_ip || '').trim();
    if (!publicIp) {
      const wan = String(config.ipsec_preset.wan_ipv4 || '').trim();
      if (wan) publicIp = wan.split('/')[0];
    }
    privateIp = String(config.ipsec_preset.lan_ipv4 || '').trim();
    if (privateIp) privateIp = privateIp.split('/')[0];
  }
  return { publicIp, privateIp };
};

// Helper to format IPsec response
const formatIPsecResponse = (
  id: string,
  base: any, // DB row or base object
  dev: any,  // Device config object
  vrId: string, // Explicit local VR ID
  localVrConfig?: any, // Full local VR config
  peerVrConfig?: any   // Full peer VR config
) => {
  const p = (devKeys: string[], dbKey: string) => {
    if (dev) {
      for (const k of devKeys) {
        if (typeof dev[k] !== 'undefined' && dev[k] !== '' && dev[k] !== null) return dev[k];
      }
    }
    if (base && typeof base[dbKey] !== 'undefined' && base[dbKey] !== null) return base[dbKey];
    return undefined;
  };
  
  const str = (v: any) => (v === undefined || v === null) ? '' : String(v);
  const bool = (v: any) => !!v;

  const localIps = getVrIps(localVrConfig);
  const peerIps = getVrIps(peerVrConfig);

  // Helper to prioritize DB value over extracted value
  const val = (dbVal: any, extractedVal: any) => {
    if (dbVal !== undefined && dbVal !== null && dbVal !== '') return String(dbVal);
    if (extractedVal !== undefined && extractedVal !== null && extractedVal !== '') return String(extractedVal);
    return '';
  };

  return {
    id: id,
    name: str(p(['name', 'ipsec_name', 'ID'], 'name')),
    description: str(p(['description'], 'description')),
    status: IPsecStatus.ACTIVE,
    createdAt: base.createdAt || new Date(),
    updatedAt: base.updatedAt || new Date(),
    
    ike: {
      version: str(p(['ike_version'], 'ikeVersion')),
      mode: str(p(['mode', 'ike_mode'], 'mode')),
      psk: str(p(['psk', 'pre_shared_key'], 'psk')),
      encryption: str(p(['encryption_algorithm', 'sa_esp_proposals'], 'encryption')),
      authentication: str(p(['authentication_algorithm'], 'authentication')),
      dhGroup: str(p(['dh_group'], 'dhGroup')),
      pfs: str(p(['pfs'], 'pfs')),
      natTraversal: bool(p(['nat_traversal'], 'natTraversal')),
      dpd: bool(p(['dpd', 'ike_dpd_delay'], 'dpd')),
    },
    
    local: {
      vrId: str(vrId),
      subnet: str(p(['local_subnet', 'traffic_selectors_local'], 'localSubnet')),
      publicIp: val(base.localPublicIp, localIps.publicIp),
      privateIp: val(base.localPrivateIp, localIps.privateIp),
    },
    
    peer: {
      vrId: str(p(['peer_vr_id'], 'peerVrId')),
      gateway: str(p(['remote_gateway', 'ike_remote_ip', 'remote_public_ip'], 'remoteGateway')),
      subnet: str(p(['remote_subnet', 'traffic_selectors_remote'], 'remoteSubnet')),
      publicIp: val(base.peerPublicIp, peerIps.publicIp),
      privateIp: val(base.peerPrivateIp, peerIps.privateIp),
    }
  };
};

// List IPsec VPNs
ipsecRoutes.get('/', async (req, res, next) => {
  try {
    const { vrId, includeDevice } = req.query as any;
    const where = vrId ? { vrId: String(vrId) } : {};
    const list = await repo().find({ where, order: { createdAt: 'DESC' } });

    const needDevice = String(includeDevice || '').trim().toLowerCase() === '1' || String(includeDevice || '').trim().toLowerCase() === 'true';
    if (!needDevice) {
      // Return list using stored IP data
      const formatted = list.map(row => formatIPsecResponse(row.id, row, null, row.vrId));
      res.json(formatted);
      return;
    }

    const vrIds = new Set<string>();
    list.forEach(i => {
      if (i.vrId) vrIds.add(String(i.vrId));
      if (i.peerVrId) vrIds.add(String(i.peerVrId));
    });
    if (vrId) vrIds.add(String(vrId));

    const deviceConfigByVr: Record<string, any> = {};
    for (const id of vrIds) {
      try {
        const cfg = await getVRConfigFromDevice(id);
        deviceConfigByVr[id] = cfg || {};
      } catch (e) {
        deviceConfigByVr[id] = {};
      }
    }

    const merged: any[] = [];
    // 1. Merge DB rows with Device data
    for (const row of list) {
      const localCfg = deviceConfigByVr[row.vrId] || {};
      const dev = (localCfg.ipsec || []).find((d: any) => String(d?.name || '') === String(row.name));
      
      const peerCfg = row.peerVrId ? deviceConfigByVr[row.peerVrId] : undefined;
      
      merged.push(formatIPsecResponse(row.id, row, dev, row.vrId, localCfg, peerCfg));
    }

    // 2. Add Device-only rows (only for requested vrId or all if generic)
    // If vrId is filtered, we only care about that VR's extras
    const checkVrIds = vrId ? [String(vrId)] : Array.from(vrIds);
    
    for (const id of checkVrIds) {
      const localCfg = deviceConfigByVr[id] || {};
      const devArr = Array.isArray(localCfg.ipsec) ? localCfg.ipsec : [];
      
      for (const dev of devArr) {
        const name = String(dev?.name || dev?.ipsec_name || '');
        if (!name) continue;
        const exists = merged.some(m => String(m.local.vrId) === String(id) && String(m.name) === name);
        if (!exists) {
          const generatedId = `${id}:${name}`;
          // For device-only, we might not know peerVrId easily unless we infer it. 
          // But usually device-only means it's not in DB.
          // We can try to guess peerVrId if we want, but for now leave it empty.
          merged.push(formatIPsecResponse(generatedId, { createdAt: new Date() }, dev, id, localCfg));
        }
      }
    }

    res.json(merged.sort((a, b) => {
      const ta = new Date(a.createdAt || Date.now()).getTime();
      const tb = new Date(b.createdAt || Date.now()).getTime();
      return tb - ta;
    }));
  } catch (e) {
    next(e);
  }
});

// Device-only IPsec list for a single VR
ipsecRoutes.get('/device', async (req, res, next) => {
  try {
    const { vrId } = req.query as any;
    if (!vrId) {
      res.status(400).json({ message: '缺少 vrId' });
      return;
    }
    const cfg = await getVRConfigFromDevice(String(vrId));
    const ipsecArr = Array.isArray(cfg?.ipsec) ? cfg.ipsec : [];
    
    const rows = ipsecArr.map((dev: any) => {
      const name = String(dev?.name || dev?.ipsec_name || 'ipsec');
      return formatIPsecResponse(`${vrId}:${name}`, { createdAt: new Date() }, dev, String(vrId), cfg);
    });
    
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Create IPsec VPN
ipsecRoutes.post('/', async (req, res, next) => {
  try {
    console.log('[IPSEC] Create payload:', req.body);
    const { 
      name, description, vrId, localSubnet, remoteGateway, remoteSubnet, 
      psk, ikeVersion, encryption, authentication, dhGroup, pfs, mode, natTraversal, dpd, peerVrId
    } = req.body || {};

    if (!name || !vrId || !localSubnet || !remoteGateway || !remoteSubnet || !psk) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    const skipPush = String(process.env.SKIP_VR_PUSH || '').trim() === '1';
    let currentConfig: any;
    let peerConfig: any;
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
        res.status(500).json({ message: `无法查询设备现有配置，已终止下发以避免覆盖: ${err.message}` });
        return;
      }
    }
    if (!skipPush) {
      const cleanBase = stripMeta(currentConfig);
      if (!cleanBase || Object.keys(cleanBase).length === 0) {
        try {
          const dbCfg = await getVRConfigFromDB(vrId);
          if (dbCfg && Object.keys(dbCfg).length) {
            currentConfig = dbCfg;
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
    const originalConfig = JSON.parse(JSON.stringify(stripMeta(currentConfig)));

    const newIpsecItem: any = {
      name,
      description,
      local_subnet: localSubnet,
      remote_gateway: remoteGateway,
      remote_subnet: remoteSubnet,
      psk,
      ike_version: ikeVersion,
      encryption_algorithm: encryption,
      authentication_algorithm: authentication,
      dh_group: dhGroup,
      pfs,
      mode,
      peer_vr_id: peerVrId
    };
    if (typeof natTraversal !== 'undefined') newIpsecItem.nat_traversal = !!natTraversal;
    if (typeof dpd !== 'undefined') newIpsecItem.dpd = !!dpd;

    if (!currentConfig.ipsec) {
      currentConfig.ipsec = [];
    } else if (!Array.isArray(currentConfig.ipsec)) {
      currentConfig.ipsec = [];
    }
    
    currentConfig.ipsec.push(newIpsecItem);

    const beforeClean = { ...originalConfig }; delete (beforeClean as any).ipsec;
    const afterClean = { ...stripMeta(currentConfig) }; delete (afterClean as any).ipsec;
    if (JSON.stringify(beforeClean) !== JSON.stringify(afterClean)) {
      res.status(409).json({ message: '配置异常：非IPsec字段发生变化，已终止下发' });
      return;
    }

    if (!skipPush) {
      try {
        const cleanConfig = stripMeta(currentConfig);
        await vrController.updateVRConfig(vrId, cleanConfig);
        await saveVRConfigToDB(vrId, currentConfig);
      } catch (err: any) {
        console.error(`[IPSEC] Failed to update local VR config`, { vrId, name }, err);
        res.status(500).json({ message: `Failed to apply configuration to VR(${vrId}): ${err.message}` });
        return;
      }
    } else {
      await saveVRConfigToDB(vrId, currentConfig);
    }

    if (peerVrId) {
      try {
        peerConfig = await getVRConfigFromDevice(peerVrId);
        if (!peerConfig || !Object.keys(peerConfig).length) {
          peerConfig = await getVRConfigFromDB(peerVrId);
        }
        
        const localPublicIp = (currentConfig?.ipsec_preset && currentConfig.ipsec_preset.public_ip) ? String(currentConfig.ipsec_preset.public_ip) : undefined;
        const peerPublicIp = (peerConfig?.ipsec_preset && peerConfig.ipsec_preset.public_ip) ? String(peerConfig.ipsec_preset.public_ip) : undefined;
        
        if (!localPublicIp) {
          throw new Error(`Local VR missing public_ip in ipsec_preset. Config keys: ${Object.keys(currentConfig || {})}`);
        }
        
        const peerIpsecItem: any = {
          name,
          description,
          local_subnet: remoteSubnet,
          remote_gateway: localPublicIp,
          remote_subnet: localSubnet,
          psk,
          ike_version: ikeVersion,
          encryption_algorithm: encryption,
          authentication_algorithm: authentication,
          dh_group: dhGroup,
          pfs,
          mode,
          peer_vr_id: vrId
        };
        if (typeof natTraversal !== 'undefined') peerIpsecItem.nat_traversal = !!natTraversal;
        if (typeof dpd !== 'undefined') peerIpsecItem.dpd = !!dpd;

        if (!peerConfig.ipsec) {
          peerConfig.ipsec = [];
        } else if (!Array.isArray(peerConfig.ipsec)) {
          peerConfig.ipsec = [];
        }
        peerConfig.ipsec.push(peerIpsecItem);

        const cleanPeerConfig = stripMeta(peerConfig);
        await vrController.updateVRConfig(peerVrId, cleanPeerConfig);
        await saveVRConfigToDB(peerVrId, peerConfig);
      } catch (err: any) {
        console.error(`[IPSEC] Failed to apply configuration to peer VR`, { peerVrId, name }, err);
        res.status(500).json({ message: `Failed to apply configuration to peer VR(${peerVrId}): ${err.message}` });
        return;
      }
    }

    // Extract IPs for storage
    const localIps = getVrIps(currentConfig);
    const peerIps = peerVrId ? getVrIps(peerConfig) : { publicIp: '', privateIp: '' };

    const item = repo().create({
      name,
      description,
      vrId,
      peerVrId,
      localSubnet,
      remoteGateway,
      remoteSubnet,
      psk,
      ikeVersion,
      encryption,
      authentication,
      dhGroup,
      pfs,
      mode,
      natTraversal: !!natTraversal,
      dpd: typeof dpd === 'undefined' ? true : !!dpd,
      status: IPsecStatus.ACTIVE,
      // Store IPs
      localPublicIp: localIps.publicIp,
      localPrivateIp: localIps.privateIp,
      peerPublicIp: peerIps.publicIp,
      peerPrivateIp: peerIps.privateIp
    });

    const saved = await repo().save(item);

    const formatted = formatIPsecResponse(
      saved.id,
      saved,
      newIpsecItem,
      saved.vrId,
      currentConfig,
      peerConfig
    );

    res.status(201).json(formatted);
  } catch (e) {
    next(e);
  }
});

// Delete IPsec VPN
ipsecRoutes.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const item = await repo().findOne({ where: { id } });
    const composite = (() => {
      const s = String(id || '');
      if (s.includes(':')) {
        const [vrId, name] = s.split(':');
        if (vrId && name) return { vrId, name };
      }
      return null;
    })();
    if (!item && !composite) {
      res.status(404).json({ message: 'IPsec VPN not found' });
      return;
    }

    try {
      const targetVrId = item ? item.vrId : String(composite!.vrId);
      const targetName = item ? item.name : String(composite!.name);
      let currentConfig = await getVRConfigFromDevice(targetVrId);
      if (!currentConfig || !Object.keys(currentConfig).length) {
        currentConfig = await getVRConfigFromDB(targetVrId);
      }

      if (currentConfig.ipsec && Array.isArray(currentConfig.ipsec)) {
        const initialLength = currentConfig.ipsec.length;
        currentConfig.ipsec = currentConfig.ipsec.filter((vpn: any) => String(vpn.name || vpn.ipsec_name || '') !== String(targetName));
        
        if (currentConfig.ipsec.length < initialLength) {
          const cleanConfig = stripMeta(currentConfig);
          await vrController.updateVRConfig(targetVrId, cleanConfig);
          await saveVRConfigToDB(targetVrId, currentConfig);
        }
      }
    } catch (err: any) {
      console.error(`[IPSEC] Failed to remove from local VR`, err);
    }

    if (item && item.peerVrId) {
      try {
        const peerConfig = await getVRConfigFromDB(item.peerVrId);
        
        if (peerConfig.ipsec && Array.isArray(peerConfig.ipsec)) {
          const initialLength = peerConfig.ipsec.length;
          peerConfig.ipsec = peerConfig.ipsec.filter((vpn: any) => String(vpn.name || vpn.ipsec_name || '') !== String(item.name));
          
          if (peerConfig.ipsec.length < initialLength) {
            const cleanPeerConfig = stripMeta(peerConfig);
            await vrController.updateVRConfig(item.peerVrId, cleanPeerConfig);
            await saveVRConfigToDB(item.peerVrId, peerConfig);
          }
        }
      } catch (err: any) {
        console.error(`[IPSEC] Failed to remove from peer VR`, err);
      }
    }

    if (item) {
      await repo().remove(item);
    }
    res.json({ message: 'Deleted' });
  } catch (e) {
    next(e);
  }
});
