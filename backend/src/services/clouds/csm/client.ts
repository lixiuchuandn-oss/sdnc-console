import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger';

const csmLog = logger.child('CSM');

export interface CsmConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  ignoreTls?: boolean;
}

// Helper for CSM signature
function _md5Lower(s: string) {
  return crypto
    .createHash('md5')
    .update(s || '')
    .digest('hex');
}
function _ts16() {
  return (Date.now() + '000').slice(0, 16);
}

// Generic request helper
export async function csmRequest(
  config: CsmConfig,
  path: string,
  queryObj: any = {},
  method: string = 'GET',
  body: any = null,
  options?: {
    basicAuth?: boolean;
    includeCookie?: boolean;
    cookie?: string;
    webPort?: string;
    noAuth?: boolean;
    extraHeaders?: Record<string, string>;
  },
) {
  const { endpoint, accessKey, secretKey, ignoreTls } = config;
  const endpointRaw = String(endpoint || '').trim();

  const ak = decodeURIComponent(accessKey || '');
  const sk = decodeURIComponent(secretKey || '');

  const base = (() => {
    try {
      const u = endpointRaw.startsWith('http')
        ? new URL(endpointRaw)
        : new URL(`https://${endpointRaw}`);
      if (options?.webPort) u.port = String(options.webPort);
      return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
    } catch {
      const s = endpointRaw.replace(/\/.*$/, '');
      const withProto = /^https?:\/\//.test(s) ? s : `https://${s}`;
      if (options?.webPort) {
        try {
          const u = new URL(withProto);
          u.port = String(options.webPort);
          return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
        } catch {
          return withProto;
        }
      }
      return withProto;
    }
  })();

  if (!ak || !sk) throw new Error('Missing CSM credentials');

  const agent = new https.Agent({ rejectUnauthorized: !ignoreTls });

  const sKeys = Object.keys(queryObj).sort();

  // For the actual request, we use '&' separator
  const queryStr = sKeys.map((k) => `${k}=${queryObj[k]}`).join('&');

  // LOCAL SIGNING (Replaces remote signer)
  // Format: METHOD|URL|TONCE|ACCESS_KEY|QUERY_PARAMS|BODY_HASH
  const tonce = (Date.now() * 1000).toString();

  let md5Body = '';
  if (body) {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    // Only hash if not empty? Or always hash if body exists?
    // Assuming empty string for empty/null body (GET), and MD5 for actual body (POST)
    // If body is empty object {}, JSON.stringify is "{}". MD5("{}")?
    // For now, let's assume if method is GET/DELETE, body is ignored/empty.
    // If POST/PUT, we use body.
    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      md5Body = crypto.createHash('md5').update(bodyStr).digest('hex');
    }
  }

  const signStr = `${method}|${path}|${tonce}|${ak}|${queryStr}|${md5Body}`;
  // console.log(`[CSM Debug] Sign String: ${signStr}`);

  const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
  const sigHeader = Buffer.from(`${ak}:${signHex}`).toString('base64');
  const basicHeader = Buffer.from(`${ak}:${sk}`).toString('base64');
  const tonceHeader = tonce;

  const reqUrl = `${base}${path}${queryStr ? '?' + queryStr : ''}`;

  const _displayAuth = options?.basicAuth ? basicHeader : sigHeader;
  // console.log(`[CSM] Request: ${method} ${reqUrl} (Auth: ${displayAuth.substring(0, 20)}...)`);

  try {
    const headers: any = {
      tonce: tonceHeader,
      'X-Request-ID': uuidv4(),
      Platform: 'ComputeTower',
      'User-Agent': 'PostmanRuntime/7.29.2',
      'Cache-Control': 'no-cache',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      ...(options?.cookie
        ? { Cookie: options.cookie }
        : options?.includeCookie
          ? { Cookie: 'sessionid_vpc=cf752941-f66c-4890-b388-eb9d55c0ca35' }
          : {}),
      Accept: '*/*',
    };
    if (!options?.noAuth) {
      headers['Authorization'] = options?.basicAuth ? `Basic ${basicHeader}` : sigHeader;
    }
    if (options?.extraHeaders) {
      for (const [k, v] of Object.entries(options.extraHeaders)) {
        headers[k] = v;
      }
    }

    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      headers['Content-Type'] = 'application/json;charset=utf-8';
    }

    const resp = await axios({
      method,
      url: reqUrl,
      headers,
      data: body,
      httpsAgent: agent,
      timeout: 10000,
      // params: queryObj, // REMOVED: URL already includes query params. Passing them here causes duplication!
    });
    return resp.data;
  } catch (error: any) {
    if (
      error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      error.message?.includes('self-signed certificate')
    ) {
      csmLog.warn('Self-signed certificate detected, retrying with ignoreTls=true...');
      const insecureAgent = new https.Agent({ rejectUnauthorized: false });

      const retryHeaders: any = {
        tonce: tonceHeader,
        'X-Request-ID': uuidv4(),
        Platform: 'ComputeTower',
        'User-Agent': 'PostmanRuntime/7.29.2',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        ...(options?.cookie
          ? { Cookie: options.cookie }
          : options?.includeCookie
            ? { Cookie: 'sessionid_vpc=cf752941-f66c-4890-b388-eb9d55c0ca35' }
            : {}),
        Accept: '*/*',
      };
      if (!options?.noAuth) {
        retryHeaders['Authorization'] = options?.basicAuth ? `Basic ${basicHeader}` : sigHeader;
      }
      if (options?.extraHeaders) {
        for (const [k, v] of Object.entries(options.extraHeaders)) {
          retryHeaders[k] = v;
        }
      }

      if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        retryHeaders['Content-Type'] = 'application/json;charset=utf-8';
      }

      const resp = await axios({
        method,
        url: reqUrl,
        headers: retryHeaders,
        data: body,
        httpsAgent: insecureAgent,
        timeout: 10000,
      });
      return resp.data;
    }
    csmLog.error(
      'Request Error:',
      error.response?.status,
      typeof error.response?.data === 'string'
        ? error.response.data.slice(0, 200)
        : error.response?.data != null
          ? JSON.stringify(error.response.data).slice(0, 200)
          : error.message,
    );
    throw error;
  }
}

export const listCsmVms = async (config: CsmConfig, queryParams: any = {}) => {
  // VM04/vms seems to be the correct endpoint for VMs
  const path = '/V2/ctcontrol/VM04/vms';
  const query = { page_size: 1000, page_num: 1, ...queryParams };

  try {
    const raw = await csmRequest(config, path, query);
    // console.log('[CSM Debug] Vms Raw:', JSON.stringify(raw).slice(0, 500));

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
    csmLog.debug('listCsmVms error:', e instanceof Error ? e.message : String(e));
    return [];
  }
};

export const getCsmVRouterDetail = async (config: CsmConfig, vrouterId: string) => {
  const path = '/V2/ctcontrol/VM06/vrouter';
  const query = { vrouter_id: vrouterId };
  try {
    const raw = await csmRequest(config, path, query);
    return raw?.data || raw;
  } catch (e: any) {
    csmLog.warn(`Failed to get detail for vrouter ${vrouterId}: ${e.message}`);
    return null;
  }
};

export const listCsmVRouters = async (config: CsmConfig, queryParams: any = {}) => {
  // Based on KB: 6.6 虚拟交换机管理 (VM06)
  // 6.6.1 查询资源池下虚拟交换机 -> Likely /V2/ctcontrol/VM06/vrouters or /V2/ctcontrol/VM06/vrouter/list
  // 6.6.2 查询资源池下虚拟交换机详情 -> GET:/V2/ctcontrol/VM06/vrouter
  const endpoints = [
    '/V2/ctcontrol/VM06/vrouters',
    '/V2/ctcontrol/VM06/vrouter/list',
    '/V2/ctcontrol/VM06/vrouter', // Fallback
  ];
  const query = { page_size: 1000, page_num: 1, ...queryParams };

  let list: any[] = [];
  let found = false;

  for (const path of endpoints) {
    try {
      const raw = await csmRequest(config, path, query);
      csmLog.debug(`vRouters raw response for ${path}:`, JSON.stringify(raw).slice(0, 500));

      if (Array.isArray(raw)) {
        list = raw;
        found = true;
        break;
      }

      const data = raw?.data;
      if (Array.isArray(data)) {
        list = data;
        found = true;
        break;
      }

      // Check for common pagination keys
      if (Array.isArray(data?.items)) {
        list = data.items;
        found = true;
        break;
      }
      if (Array.isArray(data?.page)) {
        list = data.page;
        found = true;
        break;
      }
      if (Array.isArray(data?.vrouters)) {
        list = data.vrouters;
        found = true;
        break;
      }
      if (Array.isArray(data?.v_routers)) {
        list = data.v_routers;
        found = true;
        break;
      }

      // Check top level keys
      if (Array.isArray(raw?.items)) {
        list = raw.items;
        found = true;
        break;
      }
      if (Array.isArray(raw?.page)) {
        list = raw.page;
        found = true;
        break;
      }
      if (Array.isArray(raw?.vrouters)) {
        list = raw.vrouters;
        found = true;
        break;
      }
    } catch (e: any) {
      csmLog.debug(`Failed to list vRouters from ${path}: ${e.message}`);
    }
  }

  if (!found || !list.length) return [];

  // Enhance with details (batch processing to avoid rate limits)
  const detailedList: any[] = [];
  const chunkSize = 5;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (item: any) => {
        const vid = item.vrouter_id || item.id || item.uuid || item.Id;
        if (!vid) return item;

        // If already has detail fields, skip
        if (item.vm_list && item.vrouter_port_list) return item;

        if (!vid) {
          csmLog.debug('vRouter item missing ID:', JSON.stringify(item).slice(0, 300));
          return item;
        }

        const detail = await getCsmVRouterDetail(config, vid);
        if (detail) {
          const vmCount = Array.isArray(detail.vm_list) ? detail.vm_list.length : 0;
          const portCount = Array.isArray(detail.vrouter_port_list)
            ? detail.vrouter_port_list.length
            : 0;
          csmLog.debug(`Enriched vRouter ${vid}: ${vmCount} VMs, ${portCount} ports`);
          return { ...item, ...detail };
        }
        return item;
      }),
    );
    detailedList.push(...results);
  }

  return detailedList;
};

export const getCsmPoolInfo = async (config: CsmConfig) => {
  // Try VR1/pagelist first as it contains pool_id
  try {
    const vrPath = '/V2/ctcontrol/VR1/pagelist';
    const vrQuery = { page_num: 1, page_size: 1 };
    const vrRaw = await csmRequest(config, vrPath, vrQuery, 'GET');
    const vrData = vrRaw?.data || vrRaw;

    if (vrData?.page && vrData.page.length > 0) {
      return vrData.page[0]; // Returns object with pool_id
    }
  } catch (e: any) {
    csmLog.warn('Failed to get pool info from VR1:', e.message);
  }

  // Fallback to VM01/pool
  const path = '/V2/ctcontrol/VM01/pool';
  try {
    const raw = await csmRequest(config, path, {}, 'GET');
    const data = raw?.data || raw;
    return data || null;
  } catch (e: any) {
    csmLog.debug('Get pool info (VM01 fallback) error:', e?.message || String(e));
    return null;
  }
};

export const csmSsoLogin = async (
  config: CsmConfig,
  payload: { id: string; currentLoginWebPort: string },
  extraHeaders?: Record<string, string>,
) => {
  const path = '/csm/api/v1.0/security/domain/attach/callOnSSO';
  return await csmRequest(
    config,
    path,
    {},
    'POST',
    {
      id: payload.id,
      currentLoginWebPort: payload.currentLoginWebPort,
    },
    { basicAuth: true, includeCookie: false, webPort: payload.currentLoginWebPort, extraHeaders },
  );
};

export const csmAdminLogin = async (
  config: CsmConfig,
  username: string,
  password: string,
  webPort?: string,
  loginPath?: string,
) => {
  const { endpoint, ignoreTls } = config;
  const endpointRaw = String(endpoint || '').trim();
  const base = (() => {
    try {
      const u = endpointRaw.startsWith('http')
        ? new URL(endpointRaw)
        : new URL(`https://${endpointRaw}`);
      if (webPort) u.port = String(webPort);
      const host = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
      return host;
    } catch {
      const s = endpointRaw.replace(/\/.*$/, '');
      return /^https?:\/\//.test(s) ? s : `https://${s}`;
    }
  })();
  const agent = new https.Agent({ rejectUnauthorized: !ignoreTls });
  const tryUrls = [
    String(loginPath || '/user/customUser'),
    '/csm/login',
    '/login',
    '/uaa/login',
    '/csm/uaa/login',
  ];
  const body = new URLSearchParams({ username, password }).toString();
  const jsonBody = { username, password };
  let baseCookie = '';
  for (const p of tryUrls) {
    try {
      const pre = await axios({
        method: 'GET',
        url: `${base}${p}`,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        httpsAgent: agent,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const preCookies: string[] = pre.headers?.['set-cookie'] || [];
      if (Array.isArray(preCookies) && preCookies.length) {
        const pairs = preCookies.map((s) => String(s).split(';')[0]).filter(Boolean);
        baseCookie = pairs.join('; ');
      }
      const html = String(pre.data || '');
      const m = html.match(/name=["']?_csrf["']?\s+value=["']?([^"']+)["']?/i);
      const csrf = m ? m[1] : '';
      const form = csrf ? `${body}&_csrf=${encodeURIComponent(csrf)}` : body;
      const resp = await axios({
        method: 'POST',
        url: `${base}${p}`,
        headers: {
          'Content-Type':
            p === '/user/customUser'
              ? 'application/json;charset=utf-8'
              : 'application/x-www-form-urlencoded',
          Accept: '*/*',
          ...(baseCookie ? { Cookie: baseCookie } : {}),
          ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}),
        },
        data: p === '/user/customUser' ? jsonBody : form,
        httpsAgent: agent,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const setCookies: string[] = resp.headers?.['set-cookie'] || [];
      const pairs = setCookies.map((s) => String(s).split(';')[0]).filter(Boolean);
      const cookie = [baseCookie, ...pairs].filter(Boolean).join('; ');
      if (cookie) return cookie;
    } catch {}
    try {
      const respJson = await axios({
        method: 'POST',
        url: `${base}${p}`,
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          Accept: 'application/json,*/*;q=0.8',
          ...(baseCookie ? { Cookie: baseCookie } : {}),
        },
        data: jsonBody,
        httpsAgent: agent,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const setCookies: string[] = respJson.headers?.['set-cookie'] || [];
      const pairs = setCookies.map((s) => String(s).split(';')[0]).filter(Boolean);
      const cookie = [baseCookie, ...pairs].filter(Boolean).join('; ');
      if (cookie) return cookie;
    } catch {}
  }
  for (const p of tryUrls) {
    try {
      const resp = await axios({
        method: 'POST',
        url: `${base}${p}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
        },
        data: body,
        httpsAgent: agent,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const setCookies: string[] = resp.headers?.['set-cookie'] || [];
      if (Array.isArray(setCookies) && setCookies.length) {
        const pairs = setCookies.map((s) => String(s).split(';')[0]).filter(Boolean);
        const cookie = pairs.join('; ');
        if (cookie) return cookie;
      }
    } catch {}
  }
  return '';
};

export const csmPreAuthLogin = async (
  config: CsmConfig,
  username: string,
  encryptedPassword: string,
  webPort?: string,
) => {
  const path = '/csm/api/v1.0/authentication/auth';
  const body = { username, password: encryptedPassword };
  try {
    const resp = await csmRequest(config, path, {}, 'POST', body, { noAuth: true, webPort });
    return resp;
  } catch (e) {
    return null;
  }
};

export const getCsmHostDetail = async (config: CsmConfig, hostId: string) => {
  const path = '/V2/ctcontrol/VM02/host';
  const query = { host_id: hostId };
  try {
    const raw = await csmRequest(config, path, query);
    return raw?.data || raw;
  } catch (e: any) {
    csmLog.warn(`Failed to get detail for host ${hostId}: ${e.message}`);
    return null;
  }
};

export const listCsmHosts = async (config: CsmConfig) => {
  // VM02/hosts might be for physical hosts
  const path = '/V2/ctcontrol/VM02/hosts'; // Adjust if needed
  const query = { page_size: 1000, page_num: 1 };

  let list: any[] = [];
  try {
    const raw = await csmRequest(config, path, query);
    const data = raw?.data;
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data?.items)) list = data.items;
    else if (Array.isArray(data?.page)) list = data.page;
    else list = [];
  } catch (e) {
    csmLog.debug('listCsmHosts error:', e instanceof Error ? e.message : String(e));
    return [];
  }

  if (!list.length) return [];

  // Enhance with details
  const detailedList: any[] = [];
  const chunkSize = 5;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (item: any) => {
        const hid = item.host_id || item.id || item.Id || item.uuid;
        if (!hid) return item;

        // If already has detail fields (e.g. cpu_usage), skip
        if (item.cpu_usage !== undefined && item.mem_usage !== undefined) return item;

        const detail = await getCsmHostDetail(config, hid);
        return detail ? { ...item, ...detail } : item;
      }),
    );
    detailedList.push(...results);
  }

  return detailedList;
};

export const operateCsmVm = async (
  config: CsmConfig,
  vmId: string,
  action: 'start' | 'stop' | 'reboot',
) => {
  // Guessing the path pattern: /V2/ctcontrol/VM04/vms/{id}/{action}
  // action: start, stop, restart (reboot)
  const act = action === 'reboot' ? 'restart' : action;
  const path = `/V2/ctcontrol/VM04/vms/${vmId}/${act}`;

  try {
    const raw = await csmRequest(config, path, {}, 'POST');
    return raw;
  } catch (e) {
    csmLog.error(`Action ${action} failed:`, e instanceof Error ? e.message : String(e));
    throw e;
  }
};

export const getCsmVmConsole = async (config: CsmConfig, vmId: string) => {
  const path = `/V2/ctcontrol/VM04/vms/${vmId}/console`;
  try {
    const raw = await csmRequest(config, path, {}, 'GET');
    return raw;
  } catch (e) {
    csmLog.error('Console failed:', e instanceof Error ? e.message : String(e));
    throw e;
  }
};

export const listCsmElementGroups = async (config: CsmConfig) => {
  // Correct API: GET /V2/ctcontrol/VM05/vm-groups
  const path = '/V2/ctcontrol/VM05/vm-groups';
  const query = { page_size: 1000, page_num: 1 };

  try {
    const raw = await csmRequest(config, path, query);
    csmLog.debug('VM Groups Raw:', JSON.stringify(raw).slice(0, 500));

    // Handle nested page structure as per example
    // { "page": { "page": [ ... ] } }
    let groups: any[] = [];
    if (Array.isArray(raw?.page?.page)) groups = raw.page.page;
    else if (Array.isArray(raw?.data?.page)) groups = raw.data.page;
    // Fallback for standard structures
    else if (Array.isArray(raw)) groups = raw;
    else if (Array.isArray(raw?.data)) groups = raw.data;
    else if (Array.isArray(raw?.data?.items)) groups = raw.data.items;
    else if (Array.isArray(raw?.page)) groups = raw.page;

    return groups.map((g) => {
      const elements = g.vm_id_list
        ? String(g.vm_id_list)
            .split(';')
            .filter((s: string) => s.trim())
        : g.elements || [];
      return {
        ...g, // Preserve original fields
        id: g.vm_group_id || g.id,
        name: g.vm_group_name || g.name,
        elements,
        count: elements.length,
        // Frontend uses 'count' or 'Count' or elements.length
        Count: elements.length,
      };
    });
  } catch (e: any) {
    csmLog.debug('Failed to list VM groups:', e.message);
    return [];
  }
};

export const listCsmServiceChains = async (config: CsmConfig, queryParams: any = {}) => {
  const endpoints = [
    '/V2/ctcontrol/VM08/service-chains', // Working endpoint (returns { data: { page: [...] } })
    '/V2/ctcontrol/SC01/service-chains',
    '/V2/ctcontrol/SC01/chains',
    '/V2/ctcontrol/SC03/service-chains',
  ];
  const query = { page_size: 1000, page_num: 1, ...queryParams };

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
    } catch (e: any) {
      csmLog.debug(`Service Chain endpoint failed: ${p}`, e.message);
    }
  }
  return [];
};

export const listCsmVRPageList = async (config: CsmConfig, queryParams: any = {}) => {
  const path = '/V2/ctcontrol/VR1/pagelist';
  const query = { page_size: 1000, page_num: 1, ...queryParams };
  try {
    const raw = await csmRequest(config, path, query);
    const data = raw?.data || raw;
    // Common shapes: { total, page_size, page_num, page: [] }
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.page)) return data.page;
    if (Array.isArray(raw?.page)) return raw.page;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(raw?.items)) return raw.items;
    return [];
  } catch (e) {
    csmLog.debug('VR1 pagelist error:', e instanceof Error ? e.message : String(e));
    return [];
  }
};

export const deleteCsmServiceChain = async (
  config: CsmConfig,
  serviceChainId: string,
  queryParams: any = {},
) => {
  const endpoints = ['/V2/ctcontrol/VM08/service-chain', '/V1.0/ctcontrol/VM08/service-chain'];
  const query = { service_chain_id: serviceChainId, ...queryParams };
  for (const p of endpoints) {
    try {
      const raw = await csmRequest(config, p, query, 'DELETE');
      return raw;
    } catch {}
  }
  throw new Error('删除服务链失败：未命中可用端点');
};

export const createCsmServiceChain = async (
  config: CsmConfig,
  payload: any,
  queryParams: any = {},
) => {
  const endpoints = [
    '/V2/ctcontrol/VM08/service-chains',
    '/V2/ctcontrol/VM08/service-chain',
    '/V1.0/ctcontrol/VM08/service-chain',
    '/V2/ctcontrol/SC01/service-chains',
    '/V2/ctcontrol/SC03/service-chains',
    '/V2/ctcontrol/VSW01/service-chains',
    '/V2/ctcontrol/VSW02/service-chains',
  ];
  for (const p of endpoints) {
    try {
      const raw = await csmRequest(config, p, queryParams || {}, 'POST', payload);
      return raw?.data || raw;
    } catch {}
  }
  throw new Error('创建服务链失败：未命中可用端点');
};

export const createCsmServiceChainRawBody = async (
  config: CsmConfig,
  payload: any,
  queryParams: any = {},
) => {
  const endpoints = [
    '/V2/ctcontrol/VM08/service-chain',
    '/V1.0/ctcontrol/VM08/service-chain',
    '/V2/ctcontrol/SC01/service-chains',
    '/V2/ctcontrol/SC03/service-chains',
    '/V2/ctcontrol/VSW01/service-chains',
    '/V2/ctcontrol/VSW02/service-chains',
  ];
  for (const p of endpoints) {
    try {
      const raw = await csmRequest(config, p, queryParams || {}, 'POST', payload);
      return raw;
    } catch {}
  }
  throw new Error('创建服务链失败：未命中可用端点');
};

export const createCsmAsset = async (config: CsmConfig, payload: any, queryParams: any = {}) => {
  // 6.7.1 新增网络信息 -> POST /V2/ctcontrol/VM07/customer/network
  const path = '/V2/ctcontrol/VM07/customer/network';
  try {
    const raw = await csmRequest(config, path, queryParams || {}, 'POST', payload);
    return raw?.data || raw;
  } catch (e: any) {
    csmLog.error('Failed to create asset:', e.message);
    throw e;
  }
};

export const deleteCsmAsset = async (config: CsmConfig, assetId: string) => {
  // 6.7.2 删除网络信息 -> DELETE /V2/ctcontrol/VM07/customer/network?network_id=...
  const path = '/V2/ctcontrol/VM07/customer/network';
  const query = { network_id: assetId };
  try {
    const raw = await csmRequest(config, path, query, 'DELETE');
    return raw;
  } catch (e: any) {
    csmLog.error(`Failed to delete asset ${assetId}:`, e.message);
    throw e;
  }
};

export const getCsmAssetDetail = async (config: CsmConfig, assetId: string) => {
  const path = '/V2/ctcontrol/VM07/customer/network';
  const query = { network_id: assetId };
  try {
    const raw = await csmRequest(config, path, query);
    return raw?.data || raw;
  } catch (e: any) {
    csmLog.warn(`Failed to get detail for asset ${assetId}: ${e.message}`);
    return null;
  }
};

export const listCsmAssets = async (config: CsmConfig, queryParams: any = {}) => {
  // 6.7.4 查询资源池下的资产列表
  // Spec History:
  // 1. User provided Plural: GET /V2/ctcontrol/VM07/customer/networks
  // 2. User provided Singular (latest): GET /V2/ctcontrol/VM07/customer/network (Title: Query Detail List, Desc: Query Asset List)
  // We try multiple endpoints to be robust.

  const assetsMap = new Map<string, any>();
  const networkToChainMap = new Map<string, string>();

  const endpoints = [
    '/V2/ctcontrol/VM07/customer/networks', // Plural (User's explicit instruction: Query Asset List)
    '/V2/ctcontrol/VM07/customer/network', // Singular (Fallback)
    '/V2/ctcontrol/VM07/customer/networks/list',
    '/V2/ctcontrol/VM07/customer/network/list',
  ];

  // 1. Query VM07 List
  let list: any[] = [];
  let successEndpoint = '';

  const { page_size = 1000, page_num = 1, pool_id } = queryParams;
  const query: any = { page_size, page_num };
  if (pool_id) query.pool_id = pool_id;

  for (const path of endpoints) {
    try {
      const raw = await csmRequest(config, path, query);

      // Debug Log
      const rawStr = JSON.stringify(raw).slice(0, 500);
      csmLog.debug(`Trying Asset Endpoint: ${path} | Response: ${rawStr}`);

      let currentList: any[] = [];
      let found = false;

      // Strategy 1: Standard Page Wrapper
      if (raw?.data?.page && Array.isArray(raw.data.page)) {
        currentList = raw.data.page;
        found = true;
      }
      // Strategy 2: Direct Data Array
      else if (Array.isArray(raw?.data)) {
        currentList = raw.data;
        found = true;
      }
      // Strategy 3: Items Array
      else if (Array.isArray(raw?.data?.items)) {
        currentList = raw.data.items;
        found = true;
      }
      // Strategy 4: Top Level Array
      else if (Array.isArray(raw)) {
        currentList = raw;
        found = true;
      }
      // Strategy 5: Single Object (Detail-like) treated as List of 1
      // Only if it has an ID and looks like an asset
      else if (raw?.data?.network_id || raw?.data?.id) {
        csmLog.warn(
          `Endpoint ${path} returned a single object (detail format) instead of a list; treating as list of 1.`,
        );
        currentList = [raw.data];
        found = true;
      } else if (raw?.network_id || raw?.id) {
        csmLog.warn(
          `Endpoint ${path} returned a single object (detail format) instead of a list; treating as list of 1.`,
        );
        currentList = [raw];
        found = true;
      }

      if (found) {
        // If we found something (or empty list but valid structure), use it
        // We assume empty list is valid if structure matched (e.g. data.page exists but empty)
        // But here we rely on found=true which implies we extracted an array or object
        if (currentList.length > 0 || (raw?.data?.page && Array.isArray(raw.data.page))) {
          list = currentList;
          successEndpoint = path;
          break;
        }
      }
    } catch (e: any) {
      // console.warn(`[CSM Debug] Failed endpoint ${path}: ${e.message}`);
    }
  }

  if (!successEndpoint) {
    csmLog.warn('All VM07 Asset endpoints failed or returned invalid data.');
  } else {
    csmLog.info(`Successfully fetched assets from: ${successEndpoint}, count: ${list.length}`);
  }

  list.forEach((item: any) => {
    const id = item.network_id || item.id;
    if (id) assetsMap.set(id, item);
  });

  // 2. Query VM08 Service Chains (Optional decoration)
  try {
    const chainPath = '/V2/ctcontrol/VM08/service-chains';
    const chainQuery = { page_size: 100, page_num: 1 };

    const chainRaw = await csmRequest(config, chainPath, chainQuery);

    let chains: any[] = [];
    const chainData = chainRaw?.data;
    if (Array.isArray(chainData)) chains = chainData;
    else if (Array.isArray(chainData?.items)) chains = chainData.items;
    else if (Array.isArray(chainData?.page)) chains = chainData.page;

    chains.forEach((chain: any) => {
      const chainId = chain.service_chain_id || chain.id;
      if (chain.network_ids) {
        const ids = String(chain.network_ids).split(';');
        ids.forEach((id) => {
          const trimmed = id.trim();
          if (trimmed) networkToChainMap.set(trimmed, chainId);
        });
      }
    });
  } catch (e) {
    // Silent fail for decoration
  }

  // 3. Convert
  const finalAssets = Array.from(assetsMap.values()).map((item: any) => {
    const valStr = item.value ? (item.port ? `${item.value}:${item.port}` : item.value) : '';
    const id = item.network_id || item.id;
    return {
      ...item,
      id: id,
      name: item.name || valStr || 'Unknown Asset',
      ip: item.value,
      type: item.type || 'Asset',
      displayValue: valStr,
      serviceChainId: networkToChainMap.get(id),
    };
  });

  return finalAssets;
};
