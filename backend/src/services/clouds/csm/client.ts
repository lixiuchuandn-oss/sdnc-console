import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';

export interface CsmConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  ignoreTls?: boolean;
}

// Helper for CSM signature
function md5Lower(s: string) { return crypto.createHash('md5').update(s || '').digest('hex'); }
function ts16() { return (Date.now() + '000').slice(0, 16); }

// Generic request helper
export async function csmRequest(config: CsmConfig, path: string, queryObj: any = {}, method: string = 'GET', body: any = null) {
  const { endpoint, accessKey, secretKey, ignoreTls } = config;
  const endpointRaw = String(endpoint || '').trim();
  
  const ak = decodeURIComponent(accessKey || '');
  const sk = decodeURIComponent(secretKey || '');

  const base = (() => {
    try {
      const u = endpointRaw.startsWith('http') ? new URL(endpointRaw) : new URL(`https://${endpointRaw}`);
      const host = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
      return host;
    } catch {
      const s = endpointRaw.replace(/\/.*$/, '');
      return /^https?:\/\//.test(s) ? s : `https://${s}`;
    }
  })();

  if (!ak || !sk) throw new Error('Missing CSM credentials');

  const agent = new https.Agent({ rejectUnauthorized: !ignoreTls });
  
  const sKeys = Object.keys(queryObj).sort();
  
  // For the actual request, we use '&' separator
  const queryStr = sKeys.map(k => `${k}=${queryObj[k]}`).join('&');

  // For remote signer, 'other' should be the query string itself (joined by &), 
  // NOT double-encoded with %26. Axios will handle the transport encoding.
  const otherForSign = queryStr;

  // Use remote signing service provided by CSM itself
  const signUrl = `${base}/api/sign`;
  
  // Note: We use manual string construction for the sign query params to ensure control over encoding
  // mimicking the frontend behavior (vr2Api.ts) and ensuring 'other' is correctly passed.
  // However, axios params usually work if we rely on standard encoding.
  // But let's be explicit: we want 'other' to be the %26 joined string.
  
  // Manually construct query string to ensure order and encoding matches working curl
  const signQuery = `url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(otherForSign)}&accessKey=${encodeURIComponent(ak)}&secretKey=${encodeURIComponent(sk)}`;
  const fullSignUrl = `${signUrl}?${signQuery}`;
  
  console.log(`[CSM Debug] Sign URL: ${fullSignUrl}`);

  let authHeader = '';
    let tonceHeader = '';
    
    try {
        // DEBUG: Use CURL for signing to ensure identical behavior to test_remote_sign.ts
        // Since test_remote_sign.ts works with curl but client.ts fails with axios (even with identical URL log),
        // there must be a subtle difference in headers or transport.
        const { execSync } = require('child_process');
        const signCurl = `curl.exe -k -X POST "${fullSignUrl}"`;
        // console.log(`[CSM Debug] Signing curl: ${signCurl}`);
        const signOut = execSync(signCurl, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        const signData = JSON.parse(signOut);
        
        if (signData.code !== 200 && signData.status_code !== 200) {
             throw new Error(`Signer returned ${signData.code}`);
        }

        authHeader = signData.data.Authorization;
        tonceHeader = String(signData.data.tonce);
    } catch (err: any) {
        console.error(`[CSM] Sign error: ${err.message}`);
        throw new Error(`CSM Sign failed: ${err.message}`);
    }

  // NOTE: Authorization header from CSM Signer ALREADY contains the necessary format.
  // We do NOT need to prepend "Basic ".
  // Example Auth header from successful curl: "Q2xvd..." (Base64 of AK:Signature).

  const reqUrl = `${base}${path}${queryStr ? '?' + queryStr : ''}`;

  console.log(`[CSM] Request: ${method} ${reqUrl}`);

  // DEBUG: Try using CURL for verification to match test_remote_sign.ts
  const { execSync } = require('child_process');
  let curlCmd = `curl.exe -k -X ${method} "${reqUrl}" -H "Authorization: ${authHeader}" -H "tonce: ${tonceHeader}" -H "Content-Type: application/json;charset=utf-8" -H "X-Request-ID: uuid-${Date.now()}"`;
  
  if (body) {
    // Escape double quotes in body JSON
    const bodyStr = JSON.stringify(body).replace(/"/g, '\\"');
    curlCmd += ` -d "${bodyStr}"`;
  }

  try {
      // console.log(`[CSM Debug] Executing curl: ${curlCmd}`);
      const stdout = execSync(curlCmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      // console.log(`[CSM Debug] Curl output: ${stdout}`);
      const json = JSON.parse(stdout);
      if (!stdout.includes('"code":10005')) {
          return json; // If curl works, return it!
      }
      console.log('[CSM Debug] Curl failed with 10005, falling back to axios...');
  } catch (e: any) {
      console.error(`[CSM Debug] Curl failed: ${e.message}`);
  }
  
  try {
    const resp = await axios({
      method,
      url: reqUrl,
      headers: {
        'Authorization': authHeader,
        'tonce': tonceHeader,
        'Content-Type': 'application/json;charset=utf-8',
        'X-Request-ID': uuidv4(),
      },
      data: body,
      httpsAgent: agent,
      timeout: 10000
    });
    return resp.data;
  } catch (error: any) {
    console.error('[CSM] Request Error:', error.response?.status, error.response?.data || error.message);
    throw error;
  }
}

export const listCsmVms = async (config: CsmConfig, queryParams: any = {}) => {
  // VM04/vms seems to be the correct endpoint for VMs
  const path = '/V2/ctcontrol/VM04/vms';
  const query = { page_size: 30, page_num: 1, ...queryParams };
  
  try {
    const raw = await csmRequest(config, path, query);
    console.log('[CSM Debug] Vms Raw:', JSON.stringify(raw).slice(0, 500));
    
    // Direct array
    if (Array.isArray(raw)) return raw;
    
    // Wrapped in data
    const data = raw?.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.page)) return data.page;
    
    // Direct page property (no data wrapper)
    if (Array.isArray(raw?.page)) return raw.page;
    if (Array.isArray(raw?.items)) return raw.items;

    return [];
  } catch (e) {
    console.error('[CSM Debug] Vms Error:', e);
    return [];
  }
};

export const listCsmHosts = async (config: CsmConfig) => {
    // VM02/hosts might be for physical hosts
    const path = '/V2/ctcontrol/VM02/hosts'; // Adjust if needed
    const query = { page_size: 30, page_num: 1 };
    
    try {
      const raw = await csmRequest(config, path, query);
      const data = raw?.data;
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.page)) return data.page;
      return [];
    } catch (e) {
      console.error('[CSM Debug] Hosts Error:', e);
      return [];
    }
};

export const operateCsmVm = async (config: CsmConfig, vmId: string, action: 'start' | 'stop' | 'reboot') => {
  // Guessing the path pattern: /V2/ctcontrol/VM04/vms/{id}/{action}
  // action: start, stop, restart (reboot)
  const act = action === 'reboot' ? 'restart' : action;
  const path = `/V2/ctcontrol/VM04/vms/${vmId}/${act}`;
  
  try {
    const raw = await csmRequest(config, path, {}, 'POST');
    return raw;
  } catch (e) {
    console.error(`[CSM] Action ${action} failed:`, e);
    throw e;
  }
};

export const getCsmVmConsole = async (config: CsmConfig, vmId: string) => {
  const path = `/V2/ctcontrol/VM04/vms/${vmId}/console`;
  try {
    const raw = await csmRequest(config, path, {}, 'GET');
    return raw;
  } catch (e) {
    console.error('[CSM] Console failed:', e);
    throw e;
  }
};

export const listCsmElementGroups = async (config: CsmConfig) => {
  const path = '/V2/ctcontrol/VM04/groups';
  const query = { page_size: 30, page_num: 1 };
  let groups: any[] = [];
  try {
    const raw = await csmRequest(config, path, query);
    const data = raw?.data;
    if (Array.isArray(raw)) groups = raw;
    else if (Array.isArray(data)) groups = data;
    else if (Array.isArray(data?.items)) groups = data.items;
    else if (Array.isArray(data?.page)) groups = data.page;
    else if (Array.isArray(raw?.items)) groups = raw.items;
    else if (Array.isArray(raw?.page)) groups = raw.page;
  } catch {}
  if (Array.isArray(groups) && groups.length) return groups;
  const vms = await listCsmVms(config);
  const map = new Map<string, any>();
  for (const r of vms) {
    const vendor = String((r as any)?.vm_vendor || '').trim() || '-';
    const type = String((r as any)?.vm_type || (r as any)?.Type || '').trim() || '-';
    const gid = `${vendor}::${type}`;
    const name = `${vendor} · ${type}`;
    const id = gid;
    const arr = map.get(gid) || { id, name, elements: [], Count: 0 };
    const vid = (r as any)?.id || (r as any)?.Id || (r as any)?.uuid || (r as any)?.vm_id;
    if (vid) (arr as any).elements.push(vid);
    (arr as any).Count = (arr as any).elements.length;
    map.set(gid, arr);
  }
  return Array.from(map.values());
};

export const listCsmServiceChains = async (config: CsmConfig, queryParams: any = {}) => {
  const endpoints = [
    '/V2/ctcontrol/SC01/service-chains',
    '/V2/ctcontrol/SC01/chains',
    '/V2/ctcontrol/SC01/serviceChains',
    '/V2/ctcontrol/SC03/service-chains',
    '/V2/ctcontrol/SC03/chains',
    '/V2/ctcontrol/VM08/service-chains',
    '/V2/ctcontrol/VM08/service-chain/list',
    '/V1.0/ctcontrol/VM08/service-chains',
    '/V2/ctcontrol/VSW01/service-chains',
    '/V2/ctcontrol/VSW01/chains',
    '/V2/ctcontrol/VSW02/service-chains',
    '/V2/ctcontrol/VSW02/chains',
    '/V2/ctcontrol/VM04/service-chains'
  ];
  const query = { page_size: 30, page_num: 1, ...queryParams };
  for (const p of endpoints) {
    try {
      const raw = await csmRequest(config, p, query);
      const data = raw?.data;
      if (Array.isArray(raw)) return raw;
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      // common paged shapes
      if (Array.isArray(data?.page)) return data.page;
      if (Array.isArray(raw?.items)) return raw.items;
      if (Array.isArray(raw?.page)) return raw.page;
      // nested page.items
      if (Array.isArray(data?.page?.items)) return data.page.items;
      if (Array.isArray(raw?.page?.items)) return raw.page.items;
      // other common keys
      if (Array.isArray(data?.list)) return data.list;
      if (Array.isArray(raw?.list)) return raw.list;
      if (Array.isArray(data?.records)) return data.records;
      if (Array.isArray(raw?.records)) return raw.records;
      if (Array.isArray(data?.serviceChains)) return data.serviceChains;
      if (Array.isArray(raw?.serviceChains)) return raw.serviceChains;
    } catch {}
  }
  return [];
};

export const deleteCsmServiceChain = async (config: CsmConfig, serviceChainId: string, queryParams: any = {}) => {
  const endpoints = [
    '/V2/ctcontrol/VM08/service-chain',
    '/V1.0/ctcontrol/VM08/service-chain'
  ];
  const query = { service_chain_id: serviceChainId, ...queryParams };
  for (const p of endpoints) {
    try {
      const raw = await csmRequest(config, p, query, 'DELETE');
      return raw;
    } catch {}
  }
  throw new Error('删除服务链失败：未命中可用端点');
};
