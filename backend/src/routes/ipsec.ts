import { Router } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { IPsecVPN, IPsecStatus } from '../entities/IPsecVPN';
import { VRConfig } from '../entities/VRConfig';
import { SecurityDomain } from '../entities/SecurityDomain';
import { vrController } from '../services/vrController';

export const ipsecRoutes = Router();
const repo = () => AppDataSource.getRepository(IPsecVPN);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);
const sdRepo = () => AppDataSource.getRepository(SecurityDomain);

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

const sanitizeConfig = (config: any) => {
  if (!config) return config;
  
  // Clean up ipv4_route
  if (config.ipv4_route) {
    // If it's not an array, or it's empty, delete it to avoid device errors
    if (!Array.isArray(config.ipv4_route) || config.ipv4_route.length === 0) {
      delete config.ipv4_route;
    } else {
      // Filter and fix format
      const validRoutes = config.ipv4_route.filter((r: any) => r && typeof r.destination === 'string' && r.destination.trim() !== '');
      
      if (validRoutes.length === 0) {
        delete config.ipv4_route;
      } else {
        config.ipv4_route = validRoutes.map((r: any) => {
          const dest = r.destination.trim();
          // If it looks like an IP but has no mask, append /32
          if (dest && !dest.includes('/') && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(dest)) {
            console.log(`[IPSEC] Auto-fixing route destination: ${dest} -> ${dest}/32`);
            return { ...r, destination: `${dest}/32` };
          }
          return r;
        });
      }
    }
  }
  return config;
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

// Helper for CIDR to Network
const ipv4ToInt = (ip: string): number => {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return NaN;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
};
const intToIpv4 = (n: number): string => {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
};
const cidrToNetwork = (cidr: string): string => {
  const s = String(cidr || '').trim();
  const [ip, maskStr] = s.split('/');
  const mask = parseInt(maskStr || '', 10);
  if (!ip || isNaN(mask) || mask < 0 || mask > 32) return s;
  const ipInt = ipv4ToInt(ip);
  if (isNaN(ipInt)) return s;
  const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  const networkInt = (ipInt & maskInt) >>> 0;
  return `${intToIpv4(networkInt)}/${mask}`;
};

// Helper to format IPsec response
const formatIPsecResponse = (
  id: string,
  base: any, // DB row or base object
  dev: any,  // Device config object
  vrId: string, // Explicit local VR ID
  localVrConfig?: any, // Full local VR config
  peerVrConfig?: any,   // Full peer VR config
  publicIpMap?: Map<string, string>
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
  
  // Resolve Peer VR ID
  const peerVrId = str(p(['peer_vr_id'], 'peerVrId'));

  // Helper to prioritize DB value over extracted value
  const val = (dbVal: any, extractedVal: any) => {
    if (dbVal !== undefined && dbVal !== null && dbVal !== '') return String(dbVal);
    if (extractedVal !== undefined && extractedVal !== null && extractedVal !== '') return String(extractedVal);
    return '';
  };

  const resolvePublicIp = (dbVal: any, extractedVal: any, targetVrId: string) => {
    if (dbVal !== undefined && dbVal !== null && dbVal !== '') return String(dbVal);
    if (extractedVal !== undefined && extractedVal !== null && extractedVal !== '') return String(extractedVal);
    if (publicIpMap && targetVrId && publicIpMap.has(targetVrId)) {
        const v = publicIpMap.get(targetVrId);
        if (v) return v.split(',')[0];
    }
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
      vrName: str(base.localVrName),
      subnet: str(p(['local_subnet', 'traffic_selectors_local'], 'localSubnet')),
      publicIp: resolvePublicIp(base.localPublicIp, localIps.publicIp, vrId),
      privateIp: val(base.localPrivateIp, localIps.privateIp),
    },
    
    peer: {
      vrId: peerVrId,
      vrName: str(base.peerVrName),
      gateway: str(p(['remote_gateway', 'ike_remote_ip', 'remote_public_ip'], 'remoteGateway')),
      subnet: str(p(['remote_subnet', 'traffic_selectors_remote'], 'remoteSubnet')),
      publicIp: resolvePublicIp(base.remoteGateway, peerIps.publicIp, peerVrId),
      privateIp: val(base.remotePrivateIp, peerIps.privateIp),
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

    // Fetch SecurityDomains
    const sds = await sdRepo().find({ 
        where: { vrUuid: In(Array.from(vrIds)) },
        select: ['vrUuid', 'vrPublicIp']
    });
    const publicIpMap = new Map<string, string>();
    sds.forEach(sd => {
        if (sd.vrUuid && sd.vrPublicIp) {
             publicIpMap.set(sd.vrUuid, sd.vrPublicIp);
        }
    });

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
      
      merged.push(formatIPsecResponse(row.id, row, dev, row.vrId, localCfg, peerCfg, publicIpMap));
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
          merged.push(formatIPsecResponse(generatedId, { createdAt: new Date() }, dev, id, localCfg, undefined, publicIpMap));
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
  const isStream = String(req.query.stream || '') === '1';
  if (isStream) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  const sendProgress = (step: number, message: string) => {
    if (isStream) {
      res.write(JSON.stringify({ type: 'progress', step, message }) + '\n');
    }
  };

  const sendError = (code: number, message: string) => {
    if (isStream) {
      res.write(JSON.stringify({ type: 'error', code, message }) + '\n');
      res.end();
    } else {
      res.status(code).json({ message });
    }
  };

  try {
    console.log('[IPSEC] Create payload:', req.body);
    const { 
      name, description, vrId, localSubnet, remoteGateway, remoteSubnet, 
      psk, ikeVersion, encryption, authentication, dhGroup, pfs, mode, natTraversal, dpd, peerVrId,
      localVrName, peerVrName
    } = req.body || {};

    if (!name || !vrId || !localSubnet || !remoteGateway || !remoteSubnet || !psk) {
      sendError(400, 'Missing required fields');
      return;
    }

    sendProgress(1, '开始下发本端VR配置');

    const skipPush = String(process.env.SKIP_VR_PUSH || '').trim() === '1';
    // 1. Get current config from Device (or DB if device fails?)
    // Actually we should get from device to be safe, or DB if we are source of truth.
    // For now, let's try device first.
    let currentConfig: any;
    let peerConfig: any;
    try {
      console.log(`[IPSEC] Fetching config for VR: ${vrId}`);
      currentConfig = await getVRConfigFromDevice(vrId);
      console.log(`[IPSEC] Config fetched for VR: ${vrId}`);
    } catch (err: any) {
      if (err.message && err.message.includes('404')) {
        console.log(`[IPSEC] VR config not found on device, starting fresh for ${vrId}`);
        currentConfig = { ipsec: [] };
      } else {
        console.error(`[IPSEC] Failed to fetch current VR config`, err);
        sendError(500, `Failed to fetch current VR config: ${err.message}`);
        return;
      }
    }
    if (!skipPush) {
      const cleanBase = stripMeta(currentConfig);
      // Removed DB fallback logic as per user request to avoid reviving stale config
      if (!cleanBase || Object.keys(cleanBase).length === 0) {
          // If device config is empty, we proceed with it as empty base.
          // Do NOT fetch from DB.
          console.log(`[IPSEC] Device config is empty for ${vrId}, proceeding with fresh config.`);
      }
    }
    const originalConfig = JSON.parse(JSON.stringify(stripMeta(currentConfig)));

    const newIpsecItem: any = {
      ID: name, // 使用 ID 字段
      ike_local_ip: req.body.localPublicIp, // 应该从 body 获取或计算
      ike_remote_ip: remoteGateway,
      ike_dpd_delay: 10,
      ike_dpd_timeout: 30,

      ike_proposal_local: vrId,
      ike_proposal_remote: {
        remote_id: peerVrId || 'unknown',
        pre_shared_key: psk,
        pubkey: 'pre-shared-key'
      },
      traffic_selectors_local: cidrToNetwork(localSubnet),
      traffic_selectors_remote: cidrToNetwork(remoteSubnet),

      sa_dpd_action: 'restart',
      sa_esp_proposals: encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
      'sa-initiate': 'true',
      'sa-terminate': 'false'
    };
    if (typeof natTraversal !== 'undefined') newIpsecItem.nat_traversal = !!natTraversal;
    if (typeof dpd !== 'undefined') newIpsecItem.dpd = !!dpd;

    if (!currentConfig.ipsec) {
      currentConfig.ipsec = [];
    } else if (!Array.isArray(currentConfig.ipsec)) {
      currentConfig.ipsec = [];
    } else {
      // Remove existing item with same ID/name to avoid duplicates
      currentConfig.ipsec = currentConfig.ipsec.filter((item: any) => 
        String(item.ID || item.name || item.ipsec_name) !== String(name)
      );
    }
    
    currentConfig.ipsec.push(newIpsecItem);

    const beforeClean = { ...originalConfig }; delete (beforeClean as any).ipsec;
    const afterClean = { ...stripMeta(currentConfig) }; delete (afterClean as any).ipsec;
    if (JSON.stringify(beforeClean) !== JSON.stringify(afterClean)) {
      sendError(409, '配置异常：非IPsec字段发生变化，已终止下发');
      return;
    }

    if (!skipPush) {
      try {
        const cleanConfig = sanitizeConfig(stripMeta(currentConfig));
        console.log(`[IPSEC] Pushing config to VR: ${vrId}`);
        const updateResp = await vrController.updateVRConfig(vrId, cleanConfig);
        console.log(`[IPSEC] Push response for VR ${vrId}:`, updateResp);
        if (updateResp && typeof updateResp.code !== 'undefined' && updateResp.code != 0 && updateResp.code != 200) {
          throw new Error(`Device returned error: ${updateResp.msg || updateResp.message || JSON.stringify(updateResp)}`);
        }
        await saveVRConfigToDB(vrId, currentConfig);
        sendProgress(2, '本端VR配置下发成功');
      } catch (err: any) {
        console.error(`[IPSEC] Failed to update local VR config`, { vrId, name }, err);
        sendError(500, `Failed to apply configuration to VR(${vrId}): ${err.message}`);
        return;
      }
    } else {
      await saveVRConfigToDB(vrId, currentConfig);
      sendProgress(2, '本端VR配置已保存 (Skip Push)');
    }

    if (peerVrId) {
      sendProgress(3, '开始下发对端VR配置');
      try {
        try {
          peerConfig = await getVRConfigFromDevice(peerVrId);
        } catch (err: any) {
          if (err.message && err.message.includes('404')) {
            console.log(`[IPSEC] Peer VR config not found on device, using empty default for ${peerVrId}`);
            peerConfig = { ipsec: [] };
          } else {
             throw err;
          }
        }

        // Only fallback to DB if device fetch FAILED (which is handled by catch above usually)
        // or if we really want to trust DB when device is empty?
        // NO. If device returns empty, we should trust it, otherwise we revive deleted garbage from DB.
        // So we REMOVE the fallback logic that was here:
        // if (!peerConfig || !Object.keys(peerConfig).length) { peerConfig = await getVRConfigFromDB(peerVrId); }
        
        if (!peerConfig) peerConfig = { ipsec: [] };
        
        // Use passed localPublicIp or fallback to local preset public_ip
        const localPublicIp = req.body.localPublicIp || ((currentConfig?.ipsec_preset && currentConfig.ipsec_preset.public_ip) ? String(currentConfig.ipsec_preset.public_ip) : undefined);
        const peerPublicIp = req.body.peerPublicIp || ((peerConfig?.ipsec_preset && peerConfig.ipsec_preset.public_ip) ? String(peerConfig.ipsec_preset.public_ip) : undefined);
        
        if (!localPublicIp) {
          console.warn(`Local VR missing public_ip in ipsec_preset. Config keys: ${Object.keys(currentConfig || {})}`);
          sendError(400, '无法获取本端公网IP（Local Public IP），导致无法生成对端配置。请在请求中显式提供 localPublicIp 或确保本端 VR 已配置预设 IP。');
          return;
        }
        
        const peerIpsecItem: any = {
          ID: name,
          ike_local_ip: peerPublicIp || remoteGateway,
          ike_remote_ip: localPublicIp,
          ike_dpd_delay: 10,
          ike_dpd_timeout: 30,

          ike_proposal_local: peerVrId,
          ike_proposal_remote: {
            remote_id: vrId,
            pre_shared_key: psk,
            pubkey: 'pre-shared-key'
          },
          traffic_selectors_local: cidrToNetwork(remoteSubnet),
          traffic_selectors_remote: cidrToNetwork(localSubnet),

          sa_dpd_action: 'restart',
          sa_esp_proposals: encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
          'sa-initiate': 'true',
          'sa-terminate': 'false'
        };
        if (typeof natTraversal !== 'undefined') peerIpsecItem.nat_traversal = !!natTraversal;
        if (typeof dpd !== 'undefined') peerIpsecItem.dpd = !!dpd;

        if (!peerConfig.ipsec) {
          peerConfig.ipsec = [];
        } else if (!Array.isArray(peerConfig.ipsec)) {
          peerConfig.ipsec = [];
        } else {
          // Remove existing item with same ID/name to avoid duplicates
          peerConfig.ipsec = peerConfig.ipsec.filter((item: any) => 
            String(item.ID || item.name || item.ipsec_name) !== String(name)
          );
        }
        peerConfig.ipsec.push(peerIpsecItem);

        const cleanPeerConfig = sanitizeConfig(stripMeta(peerConfig));
        console.log(`[IPSEC] Pushing config to peer VR: ${peerVrId}`, JSON.stringify(cleanPeerConfig));
        const peerUpdateResp = await vrController.updateVRConfig(peerVrId, cleanPeerConfig);
        console.log(`[IPSEC] Push response for peer VR ${peerVrId}:`, peerUpdateResp);
        if (peerUpdateResp && typeof peerUpdateResp.code !== 'undefined' && peerUpdateResp.code != 0 && peerUpdateResp.code != 200) {
          throw new Error(`Device returned error: ${peerUpdateResp.msg || peerUpdateResp.message || JSON.stringify(peerUpdateResp)}`);
        }
        await saveVRConfigToDB(peerVrId, peerConfig);
        sendProgress(4, '对端VR配置下发成功');
      } catch (err: any) {
        console.error(`[IPSEC] Failed to apply configuration to peer VR`, { peerVrId, name }, err);
        sendError(500, `Failed to apply configuration to peer VR(${peerVrId}): ${err.message}`);
        return;
      }
    }

    // Extract IPs for storage
    const localIps = getVrIps(currentConfig);

    const item = repo().create({
      name,
      description,
      vrId,
      localVrName,
      peerVrId,
      peerVrName,
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
      // Use user input first for local public IP
      localPublicIp: req.body.localPublicIp || localIps.publicIp,
      localPrivateIp: req.body.localInterfaceIp,
      remotePrivateIp: req.body.remoteInterfaceIp,
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

    sendProgress(5, '结束');
    
    if (isStream) {
      res.write(JSON.stringify({ type: 'result', data: formatted }) + '\n');
      res.end();
    } else {
      res.status(201).json(formatted);
    }
  } catch (e: any) {
    if (!isStream && !res.headersSent) next(e);
    else if (isStream && !res.writableEnded) {
       res.write(JSON.stringify({ type: 'error', code: 500, message: e.message }) + '\n');
       res.end();
    }
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
        // Removed DB fallback. If device config is empty, there is nothing to delete.
        console.log(`[IPSEC] Device config empty for ${targetVrId}, skipping delete from device.`);
        currentConfig = { ipsec: [] };
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
        let peerConfig = await getVRConfigFromDevice(item.peerVrId);
        if (!peerConfig || !Object.keys(peerConfig).length) {
             console.log(`[IPSEC] Device config empty for peer ${item.peerVrId}, skipping delete.`);
             peerConfig = { ipsec: [] };
        }
        
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
