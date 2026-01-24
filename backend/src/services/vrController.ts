import axios from 'axios';
import https from 'https';
import { getSystemSetting } from '../config/systemSettings';
import { csmRequest, CsmConfig } from './clouds/csm/client';

const DEFAULT_URL = 'https://47.111.13.103:8016';
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

export interface AuthInfo {
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
    const config: CsmConfig = {
      endpoint: getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      ignoreTls: true
    };
    
    const path = `/V2/ctcontrol/VR2/VRConfig`;
    const query = { uuid };

    // Use csmRequest (curl-based) to avoid axios signature issues
    let lastError;
    for (let i = 0; i < 3; i++) {
        try {
            const raw = await csmRequest(config, path, query, 'GET');
            const dataField = raw && raw.data ? raw.data : raw;
            
            // Check for signature error in response content
            if (dataField && dataField.code === 10005) {
                throw new Error(`Signature mismatch: ${dataField.msg}`);
            }
            
            return dataField;
        } catch (e: any) {
            console.warn(`[CSMCTL] getVRConfig retry ${i+1}/3 failed for ${uuid}: ${e.message}`);
            lastError = e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw lastError || new Error('Failed to fetch VR config after retries');
  },

  updateVRConfig: async (uuid: string, data: any): Promise<{ status: number; headers: any; data: any }> => {
    const path = `/V2/ctcontrol/VR2/VRConfig`;
    const method = 'POST';
    const other = `uuid=${uuid}`;
    
    const body = { uuid, ...data };
    
    // Log raw payload as requested for debugging
    console.log(`[CSM_RAW_PAYLOAD] POST ${path}?${other}`, JSON.stringify(body, null, 2));

    const auth = await vrController.getAuthInfo(path, method, other, body);
    
    const client = getClient();
    const response = await client.post(`${path}?${other}`, body, {
      headers: {
        'Authorization': auth.Authorization,
        'tonce': auth.tonce
      }
    });
    
    // Return full response for debugging transparency
    return {
      status: response.status,
      headers: response.headers,
      data: response.data
    };
  },

  // 获取所有 VR3 配置列表（非单个查询）
  getVR3List: async (pageSize: number = 1000, pageNum: number = 1) => {
    // 使用 csmRequest 统一签名逻辑，解决 signature_hash 不一致问题
    const config: CsmConfig = {
      endpoint: getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      ignoreTls: true
    };
    
    const path = '/V2/ctcontrol/VR3/VRConfig/list';
    const query = { page_size: pageSize, page_num: pageNum };

    try {
      console.log(`[VR_CONTROLLER] getVR3List via csmRequest: ${path}`, query);
      const raw = await csmRequest(config, path, query);
      const dataField = raw && raw.data ? raw.data : raw;
      return dataField;
    } catch (error: any) {
      console.error(`[VR_CONTROLLER] getVR3List error:`, error.message);
      throw error;
    }
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
