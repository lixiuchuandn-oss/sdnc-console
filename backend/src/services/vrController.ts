import axios from 'axios';
import https from 'https';
import { getSystemSetting } from '../config/systemSettings';
import { csmRequest, CsmConfig } from './clouds/csm/client';

const DEFAULT_URL = 'https://10.20.255.93:8016';
const ACCESS_KEY = "Cloudmap%23123";
const SECRET_KEY = "Cloudmap%23123";

// Create an agent that ignores SSL errors (like in setupProxy.js secure: false)
const httpsAgent = new https.Agent({  
  rejectUnauthorized: false
});

const getClient = () => {
  const baseURL = getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL;
  return axios.create({
    baseURL,
    httpsAgent,
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json'
    }
  });
};

interface AuthInfo {
  Authorization: string;
  tonce: number;
}

export const vrController = {
  getAuthInfo: async (path: string, method: string, other: string, body?: any): Promise<AuthInfo> => {
    try {
      const authUrl = `/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${ACCESS_KEY}&` +
        `secretKey=${SECRET_KEY}`;

      const client = getClient();
      const response = await client.post(authUrl, body ? body : '');
      
      if (!response.data || !response.data.data) {
        throw new Error('Invalid auth response format');
      }
      
      return response.data.data as AuthInfo;
    } catch (error: any) {
      console.error('[VR_CONTROLLER] Auth failed:', error.message);
      throw error;
    }
  },

  getVRConfig: async (uuid: string) => {
    const path = `/V2/ctcontrol/VR2/VRConfig`;
    const method = 'GET';
    const other = `uuid=${uuid}`;
    
    const auth = await vrController.getAuthInfo(path, method, other);
    
    const client = getClient();
    const response = await client.get(`${path}?${other}`, {
      headers: {
        'Authorization': auth.Authorization,
        'tonce': auth.tonce
      }
    });
    const raw = response.data;
    const dataField = raw && raw.data ? raw.data : raw;
    return dataField;
  },

  updateVRConfig: async (uuid: string, data: any) => {
    const path = `/V2/ctcontrol/VR2/VRConfig`;
    const method = 'POST';
    const other = ''; // POST has no query params usually for this API, based on usage patterns
    
    const body = { uuid, ...data };
    
    const auth = await vrController.getAuthInfo(path, method, other, body);
    
    const client = getClient();
    const response = await client.post(path, body, {
      headers: {
        'Authorization': auth.Authorization,
        'tonce': auth.tonce
      }
    });
    
    return response.data;
  },

  getVRList: async (pageSize: number = 50, pageNum: number = 1) => {
    // 使用 csmRequest (基于 curl) 来避免 axios 签名问题
    const config: CsmConfig = {
      endpoint: getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      ignoreTls: true
    };
    
    const path = '/V2/ctcontrol/VR1/pagelist';
    const query = { page_size: pageSize, page_num: pageNum };

    try {
      console.log(`[VR_CONTROLLER] getVRList via csmRequest: ${path}`, query);
      const raw = await csmRequest(config, path, query);
      const dataField = raw && raw.data ? raw.data : raw;
      return dataField;
    } catch (error: any) {
      console.error(`[VR_CONTROLLER] getVRList error:`, error.message);
      throw error;
    }
  }
};
