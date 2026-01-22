import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { listCsmVms, listCsmHosts, operateCsmVm, getCsmVmConsole, listCsmElementGroups, listCsmServiceChains, createCsmServiceChain, deleteCsmServiceChain, listCsmVRouters, listCsmAssets, createCsmAsset, deleteCsmAsset, listCsmVRPageList, createCsmServiceChainRawBody, getCsmPoolInfo, csmSsoLogin, csmAdminLogin, csmRequest, csmPreAuthLogin } from '../services/clouds/csm/client';
import { ServiceChain } from '../entities/ServiceChain';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) { res.status(404).json({ message: '云资源不存在' }); return null; }
  return cloud;
};

const ensureCsm = (cloud: any, res: Response, msg: string) => {
  const pvRaw = String((cloud as any)?.config?.provider || '').trim().toLowerCase();
  const ok = pvRaw === 'cloudmap.csm';
  if (!ok) {
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

export const registerCsmRoutes = (router: Router, checkAdminPermission: any) => {
  router.get('/:id/csm/security/virtual-elements', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const queryObj: any = {};
      if (req.query.host_id) queryObj.host_id = String(req.query.host_id).trim();

      const items = await listCsmVms(config, queryObj);
      res.json({
        message: '查询成功',
        data: { items },
        capabilities: { isCsm: true }
      });
    } catch (error: any) {
      console.error('CSM Route Error:', error);
      res.status(500).json({ message: 'CSM 查询失败', error: error.message });
    }
  });

  router.get('/:id/csm/network/vrouters', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const queryObj: any = {};
      if (req.query.pool_id) queryObj.pool_id = String(req.query.pool_id).trim();
      
      const items = await listCsmVRouters(config, queryObj);
      res.json({
        message: '查询成功',
        data: { items },
        capabilities: { isCsm: true }
      });
    } catch (error: any) {
      console.error('CSM vRouter Route Error:', error);
      res.status(500).json({ message: 'CSM 虚拟交换机查询失败', error: error.message });
    }
  });

  router.get('/:id/csm/network/vr-pagelist', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      // if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      // Find global CSM cloud
      const repo = AppDataSource.getRepository(Cloud);
      const allClouds = await repo.find();
      const csmCloud = allClouds.find(c => {
         const p = String((c as any)?.config?.provider || '').trim().toLowerCase();
         return p === 'cloudmap.csm' || p.includes('csm'); 
      });

      if (!csmCloud) {
          return res.status(500).json({ message: '未找到全局 CSM 控制器配置' });
      }

      const config = {
        endpoint: String(csmCloud.endpoint || '').trim(),
        accessKey: String(csmCloud.accessKey || '').trim(),
        secretKey: String(csmCloud.secretKey || '').trim(),
        ignoreTls: !!((csmCloud as any)?.config?.ignoreTls)
      };
      
      // Transparent Proxy to CSM VR1 Interface
      const path = '/V2/ctcontrol/VR1/pagelist';
      // Forward all query parameters directly, but exclude cache-busting '_t'
      const queryObj = { ...req.query };
      delete queryObj._t;
      
      // Call csmRequest directly to get raw response
      const raw = await csmRequest(config, path, queryObj);
      
      // Return raw response without any wrapping or transformation
      res.json(raw);
    } catch (error: any) {
      console.error('CSM VR pagelist Proxy Error:', error);
      res.status(500).json({ message: 'CSM VR 列表查询失败', error: error.message });
    }
  });

  router.get('/:id/csm/network/pool-id', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      let poolId: string = '';
      let source: string = '';
      try {
        const info = await getCsmPoolInfo(config);
        const pickPid = (obj: any) => String(((obj?.pool_id ?? obj?.PoolId ?? obj?.poolId) || '')).trim();
        if (Array.isArray(info)) {
          const first = info.find((it: any) => pickPid(it));
          const pid = pickPid(first);
          if (pid) { poolId = pid; source = 'VM01/pool'; }
        } else if (info && typeof info === 'object') {
          let pid = pickPid(info);
          if (!pid) {
            const arrays: any[] = [];
            if (Array.isArray((info as any).items)) arrays.push((info as any).items);
            if (Array.isArray((info as any).page)) arrays.push((info as any).page);
            if (Array.isArray((info as any).list)) arrays.push((info as any).list);
            if (Array.isArray((info as any).data)) arrays.push((info as any).data);
            for (const arr of arrays) {
              const first = arr.find((it: any) => pickPid(it));
              pid = pickPid(first);
              if (pid) break;
            }
          }
          if (pid) { poolId = pid; source = 'VM01/pool'; }
        }
      } catch {}
      try {
        const page = await listCsmVRPageList(config, { page_size: 10, page_num: 1 });
        const first = (page || []).find((it: any) => it && (it.pool_id != null || it.poolId != null));
        const pid = String((first?.pool_id ?? first?.poolId ?? '') || '').trim();
        if (pid) { poolId = pid; source = 'vr-pagelist'; }
      } catch {}
      if (!poolId) {
        try {
          const vrs = await listCsmVRouters(config, {});
          const first = (vrs || []).find((it: any) => it && (it.pool_id != null || it.poolId != null));
          const pid = String((first?.pool_id ?? first?.poolId ?? '') || '').trim();
          if (pid) { poolId = pid; source = 'vrouters'; }
        } catch {}
      }
      if (!poolId) {
        try {
          const hosts = await listCsmHosts(config);
          const first = (hosts || []).find((it: any) => it && (it.pool_id != null || (it as any).poolId != null));
          const pid = String((first?.pool_id ?? (first as any)?.poolId ?? '') || '').trim();
          if (pid) { poolId = pid; source = 'hosts'; }
        } catch {}
      }
      if (!poolId) {
        try {
          const assets = await listCsmAssets(config, {});
          const first = (assets || []).find((it: any) => it && (it.pool_id != null || it.poolId != null));
          const pid = String((first?.pool_id ?? first?.poolId ?? '') || '').trim();
          if (pid) { poolId = pid; source = 'assets'; }
        } catch {}
      }
      res.json({ message: '查询成功', data: { pool_id: poolId || null, source } });
    } catch (error: any) {
      res.status(500).json({ message: '查询 pool_id 失败', error: error.message });
    }
  });

  router.get('/:id/csm/network/assets', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;

      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const queryObj: any = { ...req.query };
      if (queryObj.pool_id) queryObj.pool_id = String(queryObj.pool_id).trim();
      
      const items = await listCsmAssets(config, queryObj);
      res.json({
        message: '查询成功',
        data: { items },
        capabilities: { isCsm: true }
      });
    } catch (error: any) {
      console.error('CSM Assets Route Error:', error);
      res.status(500).json({ message: 'CSM 资产查询失败', error: error.message });
    }
  });

  router.post('/:id/csm/network/assets', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const queryObj: any = {};
      if (req.query.pool_id) queryObj.pool_id = String(req.query.pool_id).trim();

      const result = await createCsmAsset(config, req.body, queryObj);
      const code = Number((result as any)?.code ?? 0);
      const msg = String((result as any)?.msg ?? '');
      if (Number.isFinite(code) && code >= 400) {
        return res.status(code >= 500 ? 500 : 400).json({
          message: '创建失败',
          error: msg || 'CSM 返回错误',
          data: result
        });
      }
      res.json({ message: '创建成功', data: result });
    } catch (error: any) {
      console.error('CSM Create Asset Route Error:', error);
      res.status(500).json({ message: 'CSM 资产创建失败', error: error.message });
    }
  });

  router.delete('/:id/csm/network/assets/:assetId', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id, assetId } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      await deleteCsmAsset(config, assetId);
      res.json({
        message: '删除成功',
        data: { success: true }
      });
    } catch (error: any) {
      console.error('CSM Delete Asset Route Error:', error);
      res.status(500).json({ message: 'CSM 资产删除失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/physical-elements', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;

      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const queryObj: any = {};
      // Add any specific query params for hosts if needed
      
      const items = await listCsmHosts(config);
      res.json({ message: '查询成功', data: { items }, capabilities: { isCsm: true } });
    } catch (error: any) {
      console.error('CSM Host Route Error:', error);
      res.status(500).json({ message: '查询物理安全网元失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/element-groups', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const items = await listCsmElementGroups(config);
      res.json({ message: '查询成功', data: { items }, capabilities: { isCsm: true } });
    } catch (error: any) {
      res.status(500).json({ message: '查询安全网元组失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/service-chains', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const queryObj: any = {};
      if (req.query.page_size) queryObj.page_size = Number(req.query.page_size);
      if (req.query.page_num) queryObj.page_num = Number(req.query.page_num);
      if (req.query.pool_id) queryObj.pool_id = String(req.query.pool_id).trim();
      const items = await listCsmServiceChains(config, queryObj);
      if (Array.isArray(items) && items.length) {
        return res.json({ message: '查询成功', data: { items }, capabilities: { isCsm: true } });
      }
      const repo = AppDataSource.getRepository(ServiceChain);
      const filtered = await repo.find({ where: { clusterName: cloud.name }, order: { createdAt: 'DESC' } });
      if (Array.isArray(filtered) && filtered.length) {
        return res.json({ message: '查询成功', data: { items: filtered }, capabilities: { isCsm: true } });
      }
      const all = await repo.find({ order: { createdAt: 'DESC' } });
      res.json({ message: '查询成功', data: { items: all }, capabilities: { isCsm: true } });
    } catch (error: any) {
      res.status(500).json({ message: '查询服务链失败', error: error.message });
    }
  });
  
  router.post('/:id/csm/security/service-chains', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const queryObj: any = {};
      if (req.query.pool_id) queryObj.pool_id = String(req.query.pool_id).trim();
      if (String(req.query.raw || '') === '1') {
        const rawBody = await createCsmServiceChainRawBody(config, req.body, queryObj);
        return res.json(rawBody);
      }
      const result = await createCsmServiceChain(config, req.body, queryObj);
      const code = Number((result as any)?.code ?? 0);
      const msg = String((result as any)?.msg ?? '');
      if (Number.isFinite(code) && code >= 400) {
        return res.status(code >= 500 ? 500 : 400).json({
          message: '创建失败',
          error: msg || 'CSM 返回错误',
          data: result
        });
      }
      const name = String(req.body?.name || '').trim();
      const maxTries = 10;
      let found: any = null;
      for (let i = 0; i < maxTries; i++) {
        try {
          const list = await listCsmServiceChains(config, queryObj);
          found = (list || []).find((it: any) => String(it?.name || it?.Name || '').trim() === name);
          if (found) break;
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!found && name) {
        return res.json({ message: '创建成功，验证中', data: result, verification: false });
      }
      res.json({ message: '创建成功', data: found || result });
    } catch (error: any) {
      console.error('CSM Create Service Chain Error:', error);
      res.status(500).json({ message: '创建服务链失败', error: error.message });
    }
  });

  router.post('/:id/csm/security/virtual-elements/:vmId/action', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id, vmId } = req.params;
      const { action } = req.body; // start, stop, reboot
      
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      await operateCsmVm(config, vmId, action);
      res.json({ message: '操作成功', data: { success: true } });
    } catch (error: any) {
      console.error('CSM Action Error:', error);
      res.status(500).json({ message: '操作失败', error: error.message });
    }
  });

  router.get('/:id/csm/security/virtual-elements/:vmId/console', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id, vmId } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };

      const result = await getCsmVmConsole(config, vmId);
      res.json({ message: '获取控制台成功', data: result });
    } catch (error: any) {
      console.error('CSM Console Error:', error);
      res.status(500).json({ message: '获取控制台失败', error: error.message });
    }
  });

  const handleCsmSso = async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const body = req.body || {};
      const query = req.query || {};
      const webIdRaw =
        body.web_id ??
        body.webId ??
        body.id ??
        query.web_id ??
        query.webId ??
        query.id ??
        query.service_id;
      const webId = webIdRaw ? String(webIdRaw).trim() : '';
      if (!webId) {
        return res.status(400).json({ message: '缺少 web_id' });
      }
      const portRaw = body.currentLoginWebPort ?? query.currentLoginWebPort ?? query.port;
      const webPort = String(portRaw || '8020');
      const usernameRaw = body.username ?? query.username;
      const passwordRaw = body.password ?? query.password;
      const authPwdRaw = body.authPassword ?? query.authPassword;
      const username = String(usernameRaw || 'admin').trim();
      const encPwd = String(authPwdRaw || passwordRaw || '+yNpVuicvsiBzpDpeaIq3g==').trim();
      const payloadBase = { id: String(webId), currentLoginWebPort: webPort };
      const preAuthResp = await csmPreAuthLogin(config, username, encPwd, webPort);
      console.log('CSM SSO Auth Response:', JSON.stringify(preAuthResp));
      const dataToken = String((preAuthResp?.data ?? preAuthResp?.data?.data ?? '') || '').trim();

      if (!dataToken) {
        console.error('CSM SSO Auth Failed: No token returned', preAuthResp);
      } else {
        console.log('CSM SSO Auth Token obtained');
      }

      const mask = (s: string) => {
        const t = String(s || '');
        if (!t) return '';
        if (t.length <= 8) return '***';
        return `${t.slice(0, 4)}***${t.slice(-4)}`;
      };
      const authReq = {
        method: 'POST',
        path: '/csm/api/v1.0/authentication/auth',
        webPort,
        body: { username, password: mask(encPwd) }
      };

      let adminResp: any = {};
      let adminId = '';
      const adminReq = {
        method: 'GET',
        path: '/csm/api/v1.0/user/getAdmin',
        webPort,
        headers: dataToken ? { data: dataToken } : undefined
      };

      if (dataToken) {
        try {
          adminResp = await csmRequest(config, '/csm/api/v1.0/user/getAdmin', {}, 'GET', null, {
            noAuth: true,
            webPort,
            extraHeaders: { data: dataToken }
          });
          adminId = String(adminResp?.data?.id ?? adminResp?.id ?? '').trim();
          console.log('CSM Admin ID obtained:', adminId);
        } catch (e) {
          console.warn('CSM Get Admin failed:', e);
        }
      }

      const ssoBody: any = adminId ? { ...payloadBase, userId: adminId } : { ...payloadBase };

      const ssoReq: any = {
        method: 'POST',
        path: '/csm/api/v1.0/security/domain/attach/callOnSSO',
        webPort,
        body: ssoBody,
        headers: dataToken ? { token: dataToken } : undefined
      };

      const loginU = username;
      const loginP = String(passwordRaw || 'cloudmap').trim();
      const loginPath = '/user/customUser';
      const loginReq = {
        method: 'POST',
        path: loginPath,
        webPort,
        body: { username: loginU, password: loginP }
      };
      let loginCookie = '';
      try {
        loginCookie = await csmAdminLogin(config, loginU, loginP, webPort, loginPath);
      } catch (e) {
        console.warn('SSO Pre-login failed:', e);
      }
      const loginResp = { cookie: loginCookie, message: loginCookie ? 'Login success' : 'Login failed' };
      if (loginCookie) {
        ssoReq.cookie = loginCookie;
      }

      let result = await csmRequest(config, '/csm/api/v1.0/security/domain/attach/callOnSSO', {}, 'POST', ssoBody, {
        noAuth: true,
        webPort,
        extraHeaders: dataToken ? { token: dataToken } : undefined,
        cookie: loginCookie || undefined
      });
      const code = Number((result as any)?.code ?? 0);
      const msg = String((result as any)?.message ?? (result as any)?.msg ?? '');
      if ((code === 403 || /未登录|登录状态已过期/.test(msg)) && !loginCookie) {
        const u = loginU;
        const p = loginP;
        const cookie = await csmAdminLogin(config, u, p, webPort, '/user/customUser');
        if (cookie) {
          const path = '/csm/api/v1.0/security/domain/attach/callOnSSO';
          result = await csmRequest(config, path, {}, 'POST', ssoBody, { basicAuth: false, cookie, webPort });
          ssoReq['usingCookie'] = true as any;
        }
      }
      const respData: any = {
        steps: {
          auth: { request: authReq, response: preAuthResp },
          getAdmin: { request: adminReq, response: adminResp },
          sso: { request: ssoReq, response: result }
        }
      };
      const url = String(result?.data?.url ?? result?.url ?? '').trim();
      if (url) respData.url = url;
      res.json({ message: 'SSO 调用成功', data: respData });
    } catch (error: any) {
      console.error('CSM SSO Error:', error);
      res.status(500).json({ message: 'SSO 调用失败', error: error.message });
    }
  };

  router.post('/:id/csm/security/domain/attach/callOnSSO', checkAdminPermission, handleCsmSso);
  router.get('/:id/csm/security/domain/attach/callOnSSO', checkAdminPermission, handleCsmSso);

  router.delete('/:id/csm/security/service-chains/:chainId', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id, chainId } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCsm(cloud, res, '仅支持 CSM')) return;
      const config = {
        endpoint: String(cloud.endpoint || '').trim(),
        accessKey: String(cloud.accessKey || '').trim(),
        secretKey: String(cloud.secretKey || '').trim(),
        ignoreTls: !!((cloud as any)?.config?.ignoreTls)
      };
      const queryObj: any = {};
      if (req.query.pool_id) queryObj.pool_id = String(req.query.pool_id).trim();
      const result = await deleteCsmServiceChain(config, chainId, queryObj);
      res.json({ message: '删除成功', data: result });
    } catch (error: any) {
      console.error('CSM Delete Service Chain Error:', error);
      res.status(500).json({ message: '删除服务链失败', error: error.message });
    }
  });
};
