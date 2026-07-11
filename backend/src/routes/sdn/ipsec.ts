import { Router, Request, Response, NextFunction } from 'express';
import { In, Not } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { IPsecVPN, IPsecStatus } from '../../entities/vRouter/IPsecVPN';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import {
  getVRConfigFromDevice,
  normalizeIpsecSliceForDevice,
  pushVRConfig,
  sanitizeConfig,
  saveVRConfigToDB,
  stripMeta,
  mapDeployErrorToResponse,
} from '../../services/vrouter/vrConfigDeploy';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';

export const ipsecRoutes = Router();
const repo = () => AppDataSource.getRepository(IPsecVPN);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

// Helper to extract IPs from VRCacheExtended data
const getVrWanIp = (data: any): string => {
  if (!data || !Array.isArray(data.interfaces)) return '';
  // Strict rule: Use the first interface (smallest PCI) as WAN
  const firstIf = data.interfaces[0];
  if (firstIf && firstIf.ipv4_static) {
    return firstIf.ipv4_static.split('/')[0];
  }
  return '';
};

// Helper for CIDR to Network
const ipv4ToInt = (ip: string): number => {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return NaN;
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
  dev: any, // Device config object
  vrId: string, // Explicit local VR ID
  localVrConfig?: any, // Full local VR config
  peerVrConfig?: any, // Full peer VR config
  vrCacheMap?: Map<string, { wan: string; lan: string }>,
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

  const str = (v: any) => (v === undefined || v === null ? '' : String(v));
  const bool = (v: any) => !!v;

  // Resolve Peer VR ID
  const peerVrId = str(p(['peer_vr_id'], 'peerVrId'));

  const getCachedIps = (id: string) => {
    if (vrCacheMap && id && vrCacheMap.has(id)) {
      return vrCacheMap.get(id) || { wan: '', lan: '' };
    }
    return { wan: '', lan: '' };
  };

  const localCached = getCachedIps(vrId);
  const peerCached = getCachedIps(peerVrId);

  // Helper to prioritize DB value over extracted value
  const val = (dbVal: any, cachedVal: string) => {
    if (dbVal !== undefined && dbVal !== null && dbVal !== '') return String(dbVal);
    if (cachedVal) return String(cachedVal);
    return '';
  };

  const resolvePublicIp = (dbVal: any, cachedVal: string) => {
    // Priority: VRCacheExtended (Cached) -> DB Value
    if (cachedVal) return String(cachedVal);
    if (dbVal !== undefined && dbVal !== null && dbVal !== '') return String(dbVal);
    return '';
  };

  return {
    id: id,
    name: str(p(['name', 'ipsec_name', 'ID'], 'name')),
    description: str(p(['description'], 'description')),
    status: IPsecStatus.INACTIVE,
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

    // New naming convention
    localVrId: str(vrId),
    localVrName: str(base.localVrName),
    localVrWanName: str(base.localVrWanName),
    localVrWanIP: resolvePublicIp(base.localVrWanIP, localCached.wan),
    localVrWanEIP: str(base.localVrWanEIP),
    localVrLanName: str(base.localVrLanName),
    localVrLanIP: val(base.localVrLanIP, localCached.lan),
    localVrLanSubnet: str(p(['local_subnet', 'traffic_selectors_local'], 'localVrLanSubnet')),
    localIkeRemoteIpAny: bool(base.localIkeRemoteIpAny),

    peerVrId: peerVrId,
    peerVrName: str(base.peerVrName),
    peerVrWanName: str(base.peerVrWanName),
    peerVrWanIP: resolvePublicIp(base.peerVrWanIP, peerCached.wan),
    peerVrWanEIP: str(base.peerVrWanEIP),
    peerVrLanName: str(base.peerVrLanName),
    peerVrLanIP: val(base.peerVrLanIP, peerCached.lan),
    peerVrLanSubnet: str(p(['remote_subnet', 'traffic_selectors_remote'], 'peerVrLanSubnet')),
    remoteIkeRemoteIpAny: bool(base.remoteIkeRemoteIpAny),
  };
};

// List IPsec VPNs
ipsecRoutes.get('/', async (req, res, next) => {
  try {
    const { localVrId, includeDevice } = req.query as any;
    // Updated query param name to match new schema, but support old vrId for backward compat just in case
    const targetVrId = localVrId || req.query.vrId;
    const where = targetVrId ? { localVrId: String(targetVrId) } : {};
    const list = await repo().find({ where, order: { createdAt: 'DESC' } });

    const needDevice =
      String(includeDevice || '')
        .trim()
        .toLowerCase() === '1' ||
      String(includeDevice || '')
        .trim()
        .toLowerCase() === 'true';
    if (!needDevice) {
      // Return list using stored IP data
      const formatted = list.map((row) => formatIPsecResponse(row.id, row, null, row.localVrId));
      res.json(formatted);
      return;
    }

    const vrIds = new Set<string>();
    list.forEach((i) => {
      if (i.localVrId) vrIds.add(String(i.localVrId));
      if (i.peerVrId) vrIds.add(String(i.peerVrId));
    });
    if (targetVrId) vrIds.add(String(targetVrId));

    // Fetch VR Cache Extended for both IPs and Stats
    const extRepo = AppDataSource.getRepository(VRCacheExtended);
    const extendedRows = await extRepo.find({ where: { uuid: In(Array.from(vrIds)) } });

    const vrCacheMap = new Map<string, { wan: string; lan: string }>();
    const ipsecStatsMap: Record<string, Record<string, any>> = {};

    extendedRows.forEach((row) => {
      try {
        const data = JSON.parse(row.data);
        const vrId = String(data?.uuid || row.uuid);

        // Extract IPs
        const wan = getVrWanIp(data);
        const lan = String(
          data.lan_ip || data.private_ip || data.lanIp || data.privateIp || '',
        ).split('/')[0];

        vrCacheMap.set(vrId, { wan, lan });

        // Extract Stats
        const ipsecArr = Array.isArray(data?.ipsec) ? data.ipsec : [];
        ipsecArr.forEach((t: any) => {
          const name = String(t?.id || '');
          if (!name) return;
          if (!ipsecStatsMap[vrId]) ipsecStatsMap[vrId] = {};
          ipsecStatsMap[vrId][name] = {
            inBytes: Number(t?.in?.bytes || 0),
            inPackets: Number(t?.in?.packets || 0),
            outBytes: Number(t?.out?.bytes || 0),
            outPackets: Number(t?.out?.packets || 0),
            updateDate: data?.updateDate || undefined,
          };
        });
      } catch (e) {
        // ignore
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
      const localCfg = deviceConfigByVr[row.localVrId] || {};
      const dev = (localCfg.ipsec || []).find(
        (d: any) => String(d?.name || '') === String(row.name),
      );

      const peerCfg = row.peerVrId ? deviceConfigByVr[row.peerVrId] : undefined;

      const obj: any = formatIPsecResponse(
        row.id,
        row,
        dev,
        row.localVrId,
        localCfg,
        peerCfg,
        vrCacheMap,
      );
      const stats = ipsecStatsMap[String(row.localVrId)]?.[String(obj.name)];
      if (stats) {
        obj.ipsecInBytes = stats.inBytes;
        obj.ipsecInPackets = stats.inPackets;
        obj.ipsecOutBytes = stats.outBytes;
        obj.ipsecOutPackets = stats.outPackets;
        obj.ipsecUpdateDate = stats.updateDate;
        const totalPackets = Number(stats.inPackets || 0) + Number(stats.outPackets || 0);
        obj.status =
          totalPackets > 0 || stats.updateDate ? IPsecStatus.ACTIVE : IPsecStatus.INACTIVE;
      }
      merged.push(obj);
    }

    // 2. Add Device-only rows (only for requested vrId or all if generic)
    const checkVrIds = targetVrId ? [String(targetVrId)] : Array.from(vrIds);

    for (const id of checkVrIds) {
      const localCfg = deviceConfigByVr[id] || {};
      const devArr = Array.isArray(localCfg.ipsec) ? localCfg.ipsec : [];

      for (const dev of devArr) {
        const name = String(dev?.name || dev?.ipsec_name || '');
        if (!name) continue;
        const exists = merged.some(
          (m) => String(m.localVrId) === String(id) && String(m.name) === name,
        );
        if (!exists) {
          const generatedId = `${id}:${name}`;
          const obj: any = formatIPsecResponse(
            generatedId,
            { createdAt: new Date() },
            dev,
            id,
            localCfg,
            undefined,
            vrCacheMap,
          );
          const stats = ipsecStatsMap[String(id)]?.[String(obj.name)];
          if (stats) {
            obj.ipsecInBytes = stats.inBytes;
            obj.ipsecInPackets = stats.inPackets;
            obj.ipsecOutBytes = stats.outBytes;
            obj.ipsecOutPackets = stats.outPackets;
            obj.ipsecUpdateDate = stats.updateDate;
            const totalPackets = Number(stats.inPackets || 0) + Number(stats.outPackets || 0);
            obj.status =
              totalPackets > 0 || stats.updateDate ? IPsecStatus.ACTIVE : IPsecStatus.INACTIVE;
          }
          merged.push(obj);
        }
      }
    }

    res.json(
      merged.sort((a, b) => {
        const ta = new Date(a.createdAt || Date.now()).getTime();
        const tb = new Date(b.createdAt || Date.now()).getTime();
        return tb - ta;
      }),
    );
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
      return formatIPsecResponse(
        `${vrId}:${name}`,
        { createdAt: new Date() },
        dev,
        String(vrId),
        cfg,
      );
    });

    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Check if IPsec name exists（须在 /:id 之前注册，避免被当成 id=check-name）
ipsecRoutes.get('/check-name', async (req, res) => {
  try {
    const { name, excludeId } = req.query;
    if (!name) return res.json({ exists: false });
    const count = await repo().count({
      where:
        excludeId && typeof excludeId === 'string'
          ? { name: String(name), id: Not(excludeId) }
          : { name: String(name) },
    });
    res.json({ exists: count > 0 });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
});

// Get IPsec VPN by ID
ipsecRoutes.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const item = await repo().findOne({ where: { id } });
    if (!item) {
      res.status(404).json({ message: 'IPsec VPN not found' });
      return;
    }
    res.json(item);
  } catch (e) {
    next(e);
  }
});

// Update IPsec VPN
ipsecRoutes.put('/:id', async (req, res, next) => {
  const { id } = req.params;
  const isStream = String(req.query.stream || '') === '1';
  if (isStream) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  const sendProgress = (step: number, message: string, status?: string) => {
    if (isStream) {
      res.write(JSON.stringify({ type: 'progress', step, message, status }) + '\n');
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
    const vpn = await repo().findOne({ where: { id } });
    if (!vpn) {
      sendError(404, 'IPsec VPN not found');
      return;
    }
    const oldName = vpn.name;

    const {
      name,
      description,
      localVrId,
      localVrLanSubnet,
      peerVrWanIP,
      peerVrLanSubnet,
      psk,
      ikeVersion,
      encryption,
      authentication,
      dhGroup,
      pfs,
      mode,
      natTraversal,
      dpd,
      peerVrId,
      localVrName,
      peerVrName,
      localIkeRemoteIpAny,
      remoteIkeRemoteIpAny,
      localVrWanEIP,
      localVrWanName,
      localVrLanName,
      peerVrWanName,
      peerVrLanName,
      _localVrWanIP,
      localVrLanIP,
      peerVrLanIP,
      peerVrWanEIP,
    } = req.body || {};

    if (!name || !localVrId || !localVrLanSubnet || !peerVrWanIP || !peerVrLanSubnet || !psk) {
      sendError(400, 'Missing required fields');
      return;
    }

    // Check name uniqueness if changed
    if (name !== oldName) {
      const existing = await repo().findOne({ where: { name } });
      if (existing) {
        sendError(409, `IPsec VPN Name '${name}' already exists.`);
        return;
      }
    }

    sendProgress(1, '开始更新本端VR配置');

    const _skipPush = true;

    // 1. Get current config from DB Cache
    let currentConfig: any;
    try {
      const localRecord = await vrConfigRepo().findOne({ where: { uuid: localVrId } });
      if (localRecord && localRecord.config_json) {
        currentConfig = JSON.parse(localRecord.config_json);
      }
      if (!currentConfig) {
        sendError(404, `VR配置缓存不存在，请先刷新VR列表以同步配置。VR ID: ${localVrId}`);
        return;
      }
    } catch (err: any) {
      sendError(500, `Failed to fetch current VR config: ${err.message}`);
      return;
    }

    // Fetch VRCacheExtended for IP resolution
    let localExtended: any = null;
    let peerExtended: any = null;
    try {
      const extRepo = AppDataSource.getRepository(VRCacheExtended);
      const lExt = await extRepo.findOne({ where: { uuid: localVrId } });
      if (lExt && lExt.data) localExtended = JSON.parse(lExt.data);

      if (peerVrId) {
        const pExt = await extRepo.findOne({ where: { uuid: peerVrId } });
        if (pExt && pExt.data) peerExtended = JSON.parse(pExt.data);
      }
    } catch (e) {
      console.warn('[IPSEC] Failed to fetch VRCacheExtended', e);
    }

    const _originalConfig = JSON.parse(JSON.stringify(stripMeta(currentConfig)));

    // Determine ike_local_ip
    const finalLocalIp = getVrWanIp(localExtended);
    if (finalLocalIp) {
      console.log(`[IPSEC] Using Local WAN IP from VRCacheExtended: ${finalLocalIp}`);
    } else {
      console.warn(`[IPSEC] Local VR Cache IP missing in VRCacheExtended for ${localVrId}`);
    }

    // Determine ike_remote_ip
    let finalRemoteIp = peerVrWanIP;
    let peerConfig: any;

    if (localIkeRemoteIpAny) {
      finalRemoteIp = '0.0.0.0';
    } else if (peerVrWanEIP) {
      finalRemoteIp = peerVrWanEIP;
    } else if (peerVrId) {
      const extendedPeerIp = getVrWanIp(peerExtended);
      if (extendedPeerIp) {
        finalRemoteIp = extendedPeerIp;
        console.log(`[IPSEC] Using Peer WAN IP from VRCacheExtended: ${finalRemoteIp}`);
      }

      try {
        const peerRecord = await vrConfigRepo().findOne({ where: { uuid: peerVrId } });
        if (peerRecord && peerRecord.config_json) {
          peerConfig = JSON.parse(peerRecord.config_json);
        }
      } catch (err) {}
    }

    const newIpsecItem: any = {
      ID: name,
      ike_local_ip: finalLocalIp,
      ike_remote_ip: finalRemoteIp,
      ike_proposal_local: localVrId,
      ike_proposal_remote: {
        remote_id: peerVrId || 'unknown',
        pre_shared_key: psk,
        pubkey: 'pre-shared-key',
      },
      traffic_selectors_local: cidrToNetwork(localVrLanSubnet),
      traffic_selectors_remote: cidrToNetwork(peerVrLanSubnet),
      sa_dpd_action: 'restart',
      sa_esp_proposals:
        encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
      'sa-initiate': 'true',
      'sa-terminate': 'false',
    };

    if (dpd) {
      newIpsecItem.ike_dpd_delay = 10;
      newIpsecItem.ike_dpd_timeout = 30;
    }

    if (typeof natTraversal !== 'undefined')
      newIpsecItem['nat-traversal'] = natTraversal ? 'true' : 'false';

    if (!currentConfig.ipsec) {
      currentConfig.ipsec = [];
    } else if (!Array.isArray(currentConfig.ipsec)) {
      currentConfig.ipsec = [];
    } else {
      currentConfig.ipsec = currentConfig.ipsec.filter((item: any) => {
        const iName = String(item.ID || item.name || item.ipsec_name);
        return iName !== String(oldName) && iName !== String(name);
      });
    }

    currentConfig.ipsec.push(newIpsecItem);

    // Save Local VR
    await saveVRConfigToDB(localVrId, currentConfig);
    sendProgress(2, '本端VR配置已保存 (Skip Push)');

    if (peerVrId) {
      sendProgress(3, '开始更新对端VR配置');
      try {
        if (!peerConfig) {
          const peerRecord = await vrConfigRepo().findOne({ where: { uuid: peerVrId } });
          peerConfig =
            peerRecord && peerRecord.config_json
              ? JSON.parse(peerRecord.config_json)
              : { ipsec: [] };
        }

        const finalPeerLocalIp = getVrWanIp(peerExtended);
        if (finalPeerLocalIp) {
          console.log(`[IPSEC] Using Peer WAN IP from VRCacheExtended: ${finalPeerLocalIp}`);
        } else {
          console.warn(`[IPSEC] Peer VR Cache IP missing in VRCacheExtended for ${peerVrId}`);
        }

        let finalPeerRemoteIp = finalLocalIp; // Use the already resolved local IP from cache
        if (remoteIkeRemoteIpAny) {
          finalPeerRemoteIp = '0.0.0.0';
        } else if (localVrWanEIP) {
          finalPeerRemoteIp = localVrWanEIP;
        }

        if (!finalPeerRemoteIp) {
          sendError(400, '无法获取本端公网IP');
          return;
        }

        const peerIpsecItem: any = {
          ID: name,
          ike_local_ip: finalPeerLocalIp,
          ike_remote_ip: finalPeerRemoteIp,
          ike_dpd_delay: 10,
          ike_dpd_timeout: 30,
          ike_proposal_local: peerVrId,
          ike_proposal_remote: {
            remote_id: localVrId,
            pre_shared_key: psk,
            pubkey: 'pre-shared-key',
          },
          traffic_selectors_local: cidrToNetwork(peerVrLanSubnet),
          traffic_selectors_remote: cidrToNetwork(localVrLanSubnet),
          sa_dpd_action: 'restart',
          sa_esp_proposals:
            encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
          'sa-initiate': 'false',
          'sa-terminate': 'false',
        };
        if (typeof natTraversal !== 'undefined')
          peerIpsecItem['nat-traversal'] = natTraversal ? 'true' : 'false';

        if (!peerConfig.ipsec) peerConfig.ipsec = [];
        else {
          peerConfig.ipsec = peerConfig.ipsec.filter((item: any) => {
            const iName = String(item.ID || item.name || item.ipsec_name);
            return iName !== String(oldName) && iName !== String(name);
          });
        }
        peerConfig.ipsec.push(peerIpsecItem);

        await saveVRConfigToDB(peerVrId, peerConfig);
        sendProgress(4, '对端VR配置已保存 (Skip Push)');
      } catch (err: any) {
        sendError(500, `Failed to update peer VR: ${err.message}`);
        return;
      }
    }

    // Update DB Entity
    vpn.name = name;
    vpn.description = description;
    vpn.localVrId = localVrId;
    vpn.localVrName = localVrName;
    vpn.localVrWanName = localVrWanName;
    vpn.localVrWanIP = finalLocalIp;
    vpn.localVrWanEIP = localVrWanEIP;
    vpn.localVrLanName = localVrLanName;
    vpn.localVrLanIP = localVrLanIP;
    vpn.localVrLanSubnet = localVrLanSubnet;
    vpn.localIkeRemoteIpAny = !!localIkeRemoteIpAny;

    vpn.peerVrId = peerVrId;
    vpn.peerVrName = peerVrName;
    vpn.peerVrWanName = peerVrWanName;
    // Store the actual device WAN IP (not EIP/Any)
    vpn.peerVrWanIP = peerVrId ? getVrWanIp(peerExtended) : peerVrWanIP;
    vpn.peerVrWanEIP = peerVrWanEIP;
    vpn.peerVrLanName = peerVrLanName;
    vpn.peerVrLanIP = peerVrLanIP;
    vpn.peerVrLanSubnet = peerVrLanSubnet;
    vpn.remoteIkeRemoteIpAny = !!remoteIkeRemoteIpAny;

    vpn.psk = psk;
    vpn.ikeVersion = ikeVersion;
    vpn.encryption = encryption;
    vpn.authentication = authentication;
    vpn.dhGroup = dhGroup;
    vpn.pfs = pfs;
    vpn.mode = mode;
    vpn.natTraversal = !!natTraversal;
    vpn.dpd = typeof dpd === 'undefined' ? true : !!dpd;

    await repo().save(vpn);

    sendProgress(5, '更新结束');

    if (isStream) {
      res.write(JSON.stringify({ type: 'result', data: vpn }) + '\n');
      res.end();
    } else {
      res.json(vpn);
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
ipsecRoutes.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ message: 'Missing id' });
      return;
    }

    // 1. Find the IPsecVPN entity
    const vpn = await repo().findOne({ where: { id } });
    if (!vpn) {
      res.status(404).json({ message: 'IPsec VPN not found' });
      return;
    }

    const { localVrId, peerVrId, name } = vpn;

    console.log(`[IPSEC] Deleting VPN: ${name} (${id})`);

    // 2. Remove from Local VR Config (DB Cache)
    if (localVrId) {
      try {
        const localRecord = await vrConfigRepo().findOne({ where: { uuid: localVrId } });
        if (localRecord && localRecord.config_json) {
          const config = JSON.parse(localRecord.config_json);
          if (config.ipsec && Array.isArray(config.ipsec)) {
            const initialLength = config.ipsec.length;
            config.ipsec = config.ipsec.filter(
              (item: any) => String(item.ID || item.name || item.ipsec_name) !== String(name),
            );

            if (config.ipsec.length !== initialLength) {
              console.log(`[IPSEC] Removed ${name} from Local VR ${localVrId}`);

              try {
                await pushVRConfig({
                  vrId: localVrId,
                  domain: 'ipsec',
                  platformConfig: config,
                });
                console.log(`[IPSEC] Pushed update to Local VR ${localVrId}`);
              } catch (pushErr) {
                console.error(`[IPSEC] Failed to push to Local VR ${localVrId}`, pushErr);
              }
            }
          }
        }
      } catch (e) {
        console.error(`[IPSEC] Failed to update Local VR ${localVrId} config`, e);
        // Continue deleting entity even if config update fails?
        // Better to fail soft or warn? We should try to ensure consistency.
      }
    }

    // 3. Remove from Peer VR Config (DB Cache)
    if (peerVrId) {
      try {
        const peerRecord = await vrConfigRepo().findOne({ where: { uuid: peerVrId } });
        if (peerRecord && peerRecord.config_json) {
          const config = JSON.parse(peerRecord.config_json);
          if (config.ipsec && Array.isArray(config.ipsec)) {
            const initialLength = config.ipsec.length;
            config.ipsec = config.ipsec.filter(
              (item: any) => String(item.ID || item.name || item.ipsec_name) !== String(name),
            );

            if (config.ipsec.length !== initialLength) {
              console.log(`[IPSEC] Removed ${name} from Peer VR ${peerVrId}`);

              try {
                await pushVRConfig({
                  vrId: peerVrId,
                  domain: 'ipsec',
                  platformConfig: config,
                });
                console.log(`[IPSEC] Pushed update to Peer VR ${peerVrId}`);
              } catch (pushErr) {
                console.error(`[IPSEC] Failed to push to Peer VR ${peerVrId}`, pushErr);
              }
            }
          }
        }
      } catch (e) {
        console.error(`[IPSEC] Failed to update Peer VR ${peerVrId} config`, e);
      }
    }

    // 4. Delete Entity
    await repo().remove(vpn);
    console.log(`[IPSEC] Deleted IPsec VPN entity: ${id}`);

    res.json({ message: 'Deleted successfully' });
  } catch (e: any) {
    console.error(`[IPSEC] Delete failed`, e);
    res.status(500).json({ message: e.message });
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

  const sendProgress = (step: number, message: string, status?: string) => {
    if (isStream) {
      res.write(JSON.stringify({ type: 'progress', step, message, status }) + '\n');
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
      name,
      description,
      localVrId,
      localVrLanSubnet,
      peerVrWanIP,
      peerVrLanSubnet,
      psk,
      ikeVersion,
      encryption,
      authentication,
      dhGroup,
      pfs,
      mode,
      natTraversal,
      dpd,
      peerVrId,
      localVrName,
      peerVrName,
      localIkeRemoteIpAny,
      remoteIkeRemoteIpAny,
      localVrWanEIP,
      localVrWanName,
      localVrLanName,
      peerVrWanName,
      peerVrLanName,
      _localVrWanIP,
      _localVrLanIP,
      _peerVrLanIP,
      peerVrWanEIP,
    } = req.body || {};

    if (!name || !localVrId || !localVrLanSubnet || !peerVrWanIP || !peerVrLanSubnet || !psk) {
      sendError(400, 'Missing required fields');
      return;
    }

    // Check global IPsec VPN table for duplicate name
    const existingVpn = await repo().findOne({ where: { name } });
    if (existingVpn) {
      sendError(409, `IPsec VPN 名称 '${name}' 已存在，请更换名称。`);
      return;
    }

    sendProgress(1, '开始下发本端VR配置');

    const _skipPush = true; // Always save to DB only (Step 3 Requirement)

    // 1. Get current config from DB Cache (Priority) to ensure consistency and avoid device read errors
    let currentConfig: any;
    try {
      console.log(`[IPSEC] Fetching local config from DB Cache: ${localVrId}`);
      const localRecord = await vrConfigRepo().findOne({ where: { uuid: localVrId } });

      if (localRecord && localRecord.config_json) {
        try {
          currentConfig = JSON.parse(localRecord.config_json);
          console.log(`[IPSEC] Loaded local config from DB Cache`);
        } catch (e) {
          console.error(`[IPSEC] Failed to parse local config from DB`, e);
        }
      }

      if (!currentConfig) {
        console.warn(`[IPSEC] Local config missing in DB for VR: ${localVrId}`);
        sendError(404, `VR配置缓存不存在，请先刷新VR列表以同步配置。VR ID: ${localVrId}`);
        return;
      }

      console.log(`[IPSEC] Config prepared for VR: ${localVrId}`);
    } catch (err: any) {
      console.error(`[IPSEC] Failed to fetch current VR config`, err);
      sendError(500, `Failed to fetch current VR config: ${err.message}`);
      return;
    }

    const originalConfig = JSON.parse(JSON.stringify(stripMeta(currentConfig)));

    // Fetch VRCacheExtended for IP resolution
    let localExtended: any = null;
    let peerExtended: any = null;
    try {
      const extRepo = AppDataSource.getRepository(VRCacheExtended);
      const lExt = await extRepo.findOne({ where: { uuid: localVrId } });
      if (lExt && lExt.data) localExtended = JSON.parse(lExt.data);

      if (peerVrId) {
        const pExt = await extRepo.findOne({ where: { uuid: peerVrId } });
        if (pExt && pExt.data) peerExtended = JSON.parse(pExt.data);
      }
    } catch (e) {
      console.warn('[IPSEC] Failed to fetch VRCacheExtended', e);
    }

    // Determine ike_local_ip
    const finalLocalIp = getVrWanIp(localExtended);
    if (finalLocalIp) {
      console.log(`[IPSEC] Using Local WAN IP from VRCacheExtended: ${finalLocalIp}`);
    } else {
      console.warn(`[IPSEC] Local VR Cache IP missing in VRCacheExtended for ${localVrId}`);
    }

    // Determine ike_remote_ip
    let finalRemoteIp = peerVrWanIP;
    let peerConfig: any;

    if (localIkeRemoteIpAny) {
      finalRemoteIp = '0.0.0.0';
    } else if (peerVrWanEIP) {
      finalRemoteIp = peerVrWanEIP;
      console.log(`[IPSEC] Using User Input Peer EIP: ${finalRemoteIp}`);
    } else if (peerVrId) {
      try {
        console.log(`[IPSEC] Resolving Peer IP for ${peerVrId}`);

        console.log(`[IPSEC] Fetching peer config from DB Cache: ${peerVrId}`);
        const peerRecord = await vrConfigRepo().findOne({ where: { uuid: peerVrId } });
        if (peerRecord && peerRecord.config_json) {
          try {
            peerConfig = JSON.parse(peerRecord.config_json);
          } catch (e) {
            console.error(`[IPSEC] Failed to parse peer config from DB for ${peerVrId}`, e);
          }
        }

        if (peerConfig) {
          if (!finalRemoteIp) {
            finalRemoteIp = getVrWanIp(peerExtended);
            if (finalRemoteIp) {
              console.log(
                `[IPSEC] Using Peer WAN IP from VRCacheExtended for ike_remote_ip: ${finalRemoteIp}`,
              );
            }
          }
        } else {
          console.warn(`[IPSEC] Peer VR ${peerVrId} not found in DB cache.`);
        }
      } catch (err) {
        console.warn(
          `[IPSEC] Failed to resolve peer IP, falling back to user input: ${peerVrWanIP}`,
          err,
        );
      }
    }

    const newIpsecItem: any = {
      ID: name, // 使用 ID 字段
      ike_local_ip: finalLocalIp,
      ike_remote_ip: finalRemoteIp,
      ike_dpd_delay: 10,
      ike_dpd_timeout: 30,

      ike_proposal_local: localVrId,
      ike_proposal_remote: {
        remote_id: peerVrId || 'unknown',
        pre_shared_key: psk,
        pubkey: 'pre-shared-key',
      },
      traffic_selectors_local: cidrToNetwork(localVrLanSubnet),
      traffic_selectors_remote: cidrToNetwork(peerVrLanSubnet),

      sa_dpd_action: 'restart',
      sa_esp_proposals:
        encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
      'sa-initiate': 'true',
      'sa-terminate': 'false',
    };
    if (typeof natTraversal !== 'undefined')
      newIpsecItem['nat-traversal'] = natTraversal ? 'true' : 'false';

    if (!currentConfig.ipsec) {
      currentConfig.ipsec = [];
    } else if (!Array.isArray(currentConfig.ipsec)) {
      currentConfig.ipsec = [];
    } else {
      currentConfig.ipsec = currentConfig.ipsec.filter(
        (item: any) => String(item.ID || item.name || item.ipsec_name) !== String(name),
      );
    }

    currentConfig.ipsec.push(newIpsecItem);

    const beforeClean = { ...originalConfig };
    delete (beforeClean as any).ipsec;
    const afterClean = { ...stripMeta(currentConfig) };
    delete (afterClean as any).ipsec;
    if (JSON.stringify(beforeClean) !== JSON.stringify(afterClean)) {
      sendError(409, '配置异常：非IPsec字段发生变化，已终止下发');
      return;
    }

    await saveVRConfigToDB(localVrId, currentConfig);
    sendProgress(2, '本端VR配置已保存 (Skip Push)');

    if (peerVrId) {
      sendProgress(3, '开始下发对端VR配置');
      try {
        if (!peerConfig) {
          try {
            console.log(`[IPSEC] Fetching peer config from DB Cache (Step 3): ${peerVrId}`);
            const peerRecord = await vrConfigRepo().findOne({ where: { uuid: peerVrId } });
            if (peerRecord && peerRecord.config_json) {
              peerConfig = JSON.parse(peerRecord.config_json);
            } else {
              console.warn(
                `[IPSEC] Peer VR ${peerVrId} not found in DB cache. Using empty config.`,
              );
              peerConfig = { ipsec: [] };
            }
          } catch (err: any) {
            console.error(`[IPSEC] Failed to fetch peer config from DB`, err);
            peerConfig = { ipsec: [] };
          }
        }

        if (!peerConfig) peerConfig = { ipsec: [] };

        const finalPeerLocalIp = getVrWanIp(peerExtended);
        if (finalPeerLocalIp) {
          console.log(`[IPSEC] Using Peer WAN IP from VRCacheExtended: ${finalPeerLocalIp}`);
        } else {
          console.warn(`[IPSEC] Peer VR Cache IP missing in VRCacheExtended for ${peerVrId}`);
        }

        let finalPeerRemoteIp = finalLocalIp; // Use the already resolved local IP from cache
        if (remoteIkeRemoteIpAny) {
          finalPeerRemoteIp = '0.0.0.0';
        } else if (localVrWanEIP) {
          finalPeerRemoteIp = localVrWanEIP;
        }

        if (!finalPeerRemoteIp) {
          finalPeerRemoteIp = getVrWanIp(localExtended);
        }

        if (!finalPeerRemoteIp) {
          console.warn(
            `Local VR missing public_ip. Config keys: ${Object.keys(currentConfig || {})}`,
          );
          sendError(
            400,
            '无法获取本端公网IP，导致无法生成对端配置。请在请求中显式提供 localPublicIp 或确保本端 VR 已配置预设 IP。',
          );
          return;
        }

        const peerIpsecItem: any = {
          ID: name,
          ike_local_ip: finalPeerLocalIp,
          ike_remote_ip: finalPeerRemoteIp,
          ike_proposal_local: peerVrId,
          ike_proposal_remote: {
            remote_id: localVrId,
            pre_shared_key: psk,
            pubkey: 'pre-shared-key',
          },
          traffic_selectors_local: cidrToNetwork(peerVrLanSubnet),
          traffic_selectors_remote: cidrToNetwork(localVrLanSubnet),

          sa_dpd_action: 'restart',
          sa_esp_proposals:
            encryption === 'aes-256' ? 'aes256-sha256-modp3072' : 'aes128-sha256-modp3072',
          'sa-initiate': 'false',
          'sa-terminate': 'false',
        };

        if (dpd) {
          peerIpsecItem.ike_dpd_delay = 10;
          peerIpsecItem.ike_dpd_timeout = 30;
        }

        if (typeof natTraversal !== 'undefined')
          peerIpsecItem['nat-traversal'] = natTraversal ? 'true' : 'false';

        if (!peerConfig.ipsec) {
          peerConfig.ipsec = [];
        } else if (!Array.isArray(peerConfig.ipsec)) {
          peerConfig.ipsec = [];
        } else {
          peerConfig.ipsec = peerConfig.ipsec.filter(
            (item: any) => String(item.ID || item.name || item.ipsec_name) !== String(name),
          );
        }
        peerConfig.ipsec.push(peerIpsecItem);

        await saveVRConfigToDB(peerVrId, peerConfig);
        sendProgress(4, '对端VR配置已保存 (Skip Push)');
      } catch (err: any) {
        console.error(`[IPSEC] Failed to apply configuration to peer VR`, { peerVrId, name }, err);
        sendError(500, `Failed to apply configuration to peer VR(${peerVrId}): ${err.message}`);
        return;
      }
    }

    const item = repo().create({
      name,
      description,
      localVrId,
      localVrName,
      localVrWanName,
      localVrWanIP: finalLocalIp,
      localVrWanEIP,
      localVrLanName,
      localVrLanIP: req.body.localVrLanIP,
      localVrLanSubnet,
      localIkeRemoteIpAny: !!localIkeRemoteIpAny,

      peerVrId,
      peerVrName,
      peerVrWanName,
      peerVrWanIP: peerVrId ? getVrWanIp(peerExtended) : req.body.peerVrWanIP,
      peerVrWanEIP,
      peerVrLanName,
      peerVrLanIP: req.body.peerVrLanIP,
      peerVrLanSubnet,
      remoteIkeRemoteIpAny: !!remoteIkeRemoteIpAny,

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
    });

    const saved = await repo().save(item);

    const formatted = formatIPsecResponse(
      saved.id,
      saved,
      newIpsecItem,
      saved.localVrId,
      currentConfig,
      peerConfig,
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

// Deploy IPsec VPN Configuration (Push to CSMCTL)
// Manual Deployment Step 1 & 4: Preview Config from DB
ipsecRoutes.get('/deploy/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { vrId } = req.query;
    if (!vrId || typeof vrId !== 'string') throw new Error('Missing vrId');

    const record = await vrConfigRepo().findOne({ where: { uuid: vrId } });
    if (!record || !record.config_json) throw new Error('VR config not found in DB');

    const config = JSON.parse(record.config_json);

    // Apply sanitization logic to show exactly what will be sent
    if (config.ipsec && Array.isArray(config.ipsec)) {
      config.ipsec.forEach((item: any) => {
        if (typeof item.dpd !== 'undefined') delete item.dpd;
        if (typeof item['nat-traversal'] === 'boolean')
          item['nat-traversal'] = item['nat-traversal'] ? 'true' : 'false';
        if (typeof item['sa-initiate'] === 'boolean')
          item['sa-initiate'] = item['sa-initiate'] ? 'true' : 'false';
      });
    }

    const cleanConfig = sanitizeConfig(stripMeta(config));
    res.json({ config: cleanConfig });
  } catch (e) {
    next(e);
  }
});

// Manual Deployment Step 2 & 5: Push Config to CSMCTL
ipsecRoutes.post('/deploy/push', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const { vrId } = req.body;
    if (!vrId) throw new Error('Missing vrId');

    // Fetch and sanitize again to be safe
    const record = await vrConfigRepo().findOne({ where: { uuid: vrId } });
    if (!record || !record.config_json) throw new Error('VR config not found in DB');

    const config = JSON.parse(record.config_json);
    if (config.ipsec && Array.isArray(config.ipsec)) {
      config.ipsec = normalizeIpsecSliceForDevice(config.ipsec) as typeof config.ipsec;
    }

    const acknowledgeDrift = req.body?.acknowledgeDrift === true;
    console.log(`[IPSEC] Pushing config to VR: ${vrId}`);

    const result = await pushVRConfig({
      vrId,
      domain: 'ipsec',
      platformConfig: config,
      acknowledgeDrift,
    });

    res.json({ status: 200, data: result.deviceResponse, driftWarnings: result.driftWarnings });
  } catch (e: unknown) {
    const { status, body } = mapDeployErrorToResponse(e);
    console.error(`[IPSEC] Failed to push config`, e);
    res.status(status).json({ error: body.message, code: body.code, conflicts: body.conflicts });
  }
});

// Manual Deployment Step 3 & 6: Verify
ipsecRoutes.get('/deploy/verify', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const { vrId } = req.query;
    if (!vrId || typeof vrId !== 'string') throw new Error('Missing vrId');

    const cfg = await getVRConfigFromDevice(vrId);
    const ipsecCount = Array.isArray(cfg?.ipsec) ? cfg.ipsec.length : 0;

    res.json({ ipsecCount, config: cfg });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
