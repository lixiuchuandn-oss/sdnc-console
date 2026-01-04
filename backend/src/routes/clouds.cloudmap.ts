import { Router, Response } from 'express';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { v4 as uuidv4 } from 'uuid';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) { res.status(404).json({ message: '云资源不存在' }); return null; }
  return cloud;
};

const ensureCloudmap = (cloud: any, res: Response, msg: string) => {
  const pv = String((cloud as any)?.config?.provider || '').toLowerCase().trim();
  const ok = pv === 'cloudmap' || pv.startsWith('cloudmap');
  if (!ok) {
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

// Helper for Cloudmap signature
function md5Lower(s: string) { return crypto.createHash('md5').update(s || '').digest('hex'); }
function ts16() { return (Date.now() + '000').slice(0, 16); }

export const registerCloudmapRoutes = (router: Router, checkAdminPermission: any) => {
  router.get('/:id/cloudmap/security/virtual-elements', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCloudmap(cloud, res, '仅支持 CSM')) return;
      
      const endpointRaw = String(cloud.endpoint || '').trim();
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
      
      const ak = String(cloud.accessKey || '').trim();
      const sk = String(cloud.secretKey || '').trim();
      if (!ak || !sk) return res.status(400).json({ message: '缺少访问密钥（accessKey/secretKey）' });
      
      const ignoreTls = !!((cloud as any)?.config?.ignoreTls);
      const agent = new https.Agent({ rejectUnauthorized: !ignoreTls });
      
      // Use VM04/host/vms endpoint as per Table 26 (Host Security Capabilities)
      const path = '/V2/ctcontrol/VM04/host/vms';
      const queryObj: any = {};
      if (req.query.host_id) queryObj.host_id = String(req.query.host_id).trim();
      
      // Signature Generation Logic (from pre-request-script.md)
      const tonce = ts16();
      const method = 'GET';
      const body = ''; // GET has no body
      
      // 1. Sort query keys (Standard practice, though script implies order matters or handled by Postman)
      const sKeys = Object.keys(queryObj).sort();
      
      // 2. Generate otherStr: join with %26
      const otherStr = sKeys.map(k => `${k}=${queryObj[k]}`).join('%26');
      
      // 3. Generate signature string
      // method|url|tonce|accesskey|other|MD5(body)
      const signStr = `${method}|${path}|${tonce}|${ak}|${otherStr}|${md5Lower(body)}`;
      
      // 4. HMAC-SHA256
      const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
      
      // 5. Authorization Header: Base64(ak:signHex)
      const auth = Buffer.from(`${ak}:${signHex}`).toString('base64');
      
      // 6. Final URL
      const queryStr = sKeys.map(k => `${k}=${queryObj[k]}`).join('&');
      const listUrl = `${base}${path}${queryStr ? '?' + queryStr : ''}`;
      
      console.log(`Cloudmap Request: ${method} ${listUrl}`);
      console.log(`SignStr: ${signStr}`);
      console.log(`Auth: Basic ${auth.substring(0, 10)}...`);

      try {
        const resp = await axios.get(listUrl, {
          headers: {
            'Authorization': `Basic ${auth}`,
            'tonce': tonce,
            'Content-Type': 'application/json;charset=utf-8',
            'X-Request-ID': uuidv4(),
          },
          httpsAgent: agent,
          timeout: 10000
        });
        
        const raw = resp.data;
        // Table 26 response format: { code: 200, data: [ ... ] }
        const items = Array.isArray(raw?.data) ? raw?.data : [];
        
        // Log raw response for debugging
        console.log('Cloudmap Response:', JSON.stringify(raw).substring(0, 200));

        res.json({
          message: '查询成功',
          data: { items },
          capabilities: { isCloudmap: true },
          raw: raw
        });
      } catch (e: any) {
        console.error('Cloudmap Error:', e.message, e.response?.data);
        res.status(500).json({ 
          message: '查询虚拟安全网元失败', 
          error: e.message,
          details: e.response?.data 
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: '查询虚拟安全网元失败', error: error.message });
    }
  });

  router.get('/:id/cloudmap/security/physical-elements', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCloudmap(cloud, res, '仅支持 CSM')) return;
      res.json({ message: '查询成功', data: { items: [] }, capabilities: { isCloudmap: true } });
    } catch (error: any) {
      res.status(500).json({ message: '查询物理安全网元失败', error: error.message });
    }
  });

  router.get('/:id/cloudmap/security/element-groups', checkAdminPermission, async (req: any, res: Response) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!ensureCloudmap(cloud, res, '仅支持 CSM')) return;
      res.json({ message: '查询成功', data: { items: [] }, capabilities: { isCloudmap: true } });
    } catch (error: any) {
      res.status(500).json({ message: '查询安全网元组失败', error: error.message });
    }
  });
};
