import axios from 'axios';
import https from 'https';
import { getSystemSetting } from '../../config/systemSettings';
import { csmRequest, CsmConfig } from '../clouds/csm/client';

const DEFAULT_URL = 'https://47.111.13.103:8016';
const ACCESS_KEY = 'Cloudmap%23123';
const SECRET_KEY = 'Cloudmap%23123';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const getClient = () => {
  const baseURL = getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL;
  return axios.create({
    baseURL,
    httpsAgent,
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};

export interface AuthInfo {
  Authorization: string;
  tonce: number;
}

export const vrController = {
  getAuthInfo: async (
    path: string,
    method: string,
    other: string,
    body?: any,
  ): Promise<AuthInfo> => {
    try {
      const authUrl =
        `/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${ACCESS_KEY}&` +
        `secretKey=${SECRET_KEY}`;

      const client = getClient();
      const response = await client.post(authUrl, body ? body : '');

      if (!response.data || !response.data.data) {
        throw new Error('认证响应格式无效');
      }

      return response.data.data as AuthInfo;
    } catch (error: any) {
      console.error('[VRCTL] 认证失败:', error.message);
      throw error;
    }
  },

  getVRConfig: async (uuid: string) => {
    const config: CsmConfig = {
      endpoint: getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      ignoreTls: true,
    };

    const path = `/V2/ctcontrol/VR2/VRConfig`;
    const query = { uuid };

    let lastError;
    for (let i = 0; i < 3; i++) {
      try {
        const raw = await csmRequest(config, path, query, 'GET');
        const dataField = raw && raw.data ? raw.data : raw;

        if (dataField && dataField.code === 10005) {
          throw new Error(`签名不匹配: ${dataField.msg}`);
        }

        return dataField;
      } catch (e: any) {
        console.warn(`[VRCTL] 获取VR配置重试 ${i + 1}/3 失败 (${uuid}): ${e.message}`);
        lastError = e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw lastError || new Error('重试后仍无法获取 VR 配置');
  },

  updateVRConfig: async (
    uuid: string,
    data: any,
  ): Promise<{ status: number; headers: any; data: any }> => {
    const path = `/V2/ctcontrol/VR2/VRConfig`;
    const method = 'POST';
    const other = `uuid=${uuid}`;

    const body = { uuid, ...data };

    console.log(`[VRCTL] POST ${path}?${other}`, JSON.stringify(body));

    const auth = await vrController.getAuthInfo(path, method, other, body);

    const client = getClient();
    const response = await client.post(`${path}?${other}`, body, {
      headers: {
        Authorization: auth.Authorization,
        tonce: auth.tonce,
      },
    });

    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
    };
  },

  getVR3List: async (pageSize: number = 1000, pageNum: number = 1) => {
    const config: CsmConfig = {
      endpoint: getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      ignoreTls: true,
    };

    const path = '/V2/ctcontrol/VR3/VRConfig/list';
    const query = { page_size: pageSize, page_num: pageNum };

    try {
      console.log(`[VR-CTL] 通过 csmRequest 获取 VR3 列表: ${path}`, query);
      const raw = await csmRequest(config, path, query);
      const dataField = raw && raw.data ? raw.data : raw;
      return dataField;
    } catch (error: any) {
      console.error(`[VR-CTL] 获取 VR3 列表失败:`, error.message);
      throw error;
    }
  },

  getVRList: async (pageSize: number = 50, pageNum: number = 1) => {
    const config: CsmConfig = {
      endpoint: getSystemSetting('CSMCTL_ADDRESS') || DEFAULT_URL,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      ignoreTls: true,
    };

    const path = '/V2/ctcontrol/VR1/pagelist';
    const query = { page_size: pageSize, page_num: pageNum };

    try {
      console.log(`[VR-CTL] 通过 csmRequest 获取 VR 列表: ${path}`, query);
      const raw = await csmRequest(config, path, query);
      const dataField = raw && raw.data ? raw.data : raw;
      return dataField;
    } catch (error: any) {
      console.error(`[VR-CTL] 获取 VR 列表失败:`, error.message);
      throw error;
    }
  },
};

