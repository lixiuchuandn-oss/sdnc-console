import axios from 'axios';
import https from 'https';
import { getSystemSetting } from '../config/systemSettings';
import { csmRequest, CsmConfig } from './clouds/csm/client';

// 默认 CSM 控制台地址
const DEFAULT_URL = 'https://47.111.13.103:8016';
// 硬编码的 AccessKey 和 SecretKey (用于 CSM 认证)
const ACCESS_KEY = 'Cloudmap%23123';
const SECRET_KEY = 'Cloudmap%23123';

// 创建一个忽略 SSL 错误的 https 代理 (类似 setupProxy.js 中的 secure: false)
// 用于连接自签名证书的 CSM 服务
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * 获取 axios 客户端实例
 * 配置了基础 URL、HTTPS 代理和超时时间
 */
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

/**
 * CSM 认证信息接口
 */
export interface AuthInfo {
  Authorization: string;
  tonce: number;
}

/**
 * VR 控制器服务
 * 负责与 CSM (Cloud Service Management) 控制台进行交互，管理 VR 设备配置
 */
export const vrController = {
  /**
   * 获取 API 请求的认证信息 (签名)
   * 通过调用 /api/sign 接口获取 Authorization 头和 tonce
   * 
   * @param path 请求路径
   * @param method 请求方法 (GET, POST 等)
   * @param other 查询参数字符串 (key=value&...)
   * @param body 请求体 (可选)
   */
  getAuthInfo: async (
    path: string,
    method: string,
    other: string,
    body?: any,
  ): Promise<AuthInfo> => {
    try {
      // 构造签名接口的 URL，包含原始请求的所有关键参数
      const authUrl =
        `/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${ACCESS_KEY}&` +
        `secretKey=${SECRET_KEY}`;

      const client = getClient();
      // 发送签名请求，body 需要与原始请求一致
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

  /**
   * 获取指定 VR 设备的详细配置 (VR2 协议)
   * 包含重试机制，最多重试 3 次
   * 使用 csmRequest (curl 封装) 避免 axios 签名计算不一致的问题
   * 
   * @param uuid VR 设备的 UUID
   */
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
    // 重试循环
    for (let i = 0; i < 3; i++) {
      try {
        const raw = await csmRequest(config, path, query, 'GET');
        const dataField = raw && raw.data ? raw.data : raw;

        // 检查业务层面的签名错误 (code 10005)
        if (dataField && dataField.code === 10005) {
          throw new Error(`签名不匹配: ${dataField.msg}`);
        }

        return dataField;
      } catch (e: any) {
        console.warn(`[VRCTL] 获取VR配置重试 ${i + 1}/3 失败 (${uuid}): ${e.message}`);
        lastError = e;
        // 等待 1 秒后重试
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw lastError || new Error('重试后仍无法获取 VR 配置');
  },

  /**
   * 更新 VR 设备配置 (VR2 协议)
   * 先获取签名，再发送 POST 请求更新配置
   * 
   * @param uuid VR 设备的 UUID
   * @param data 配置数据对象
   */
  updateVRConfig: async (
    uuid: string,
    data: any,
  ): Promise<{ status: number; headers: any; data: any }> => {
    const path = `/V2/ctcontrol/VR2/VRConfig`;
    const method = 'POST';
    const other = `uuid=${uuid}`;

    const body = { uuid, ...data };

    // 输出原始请求载荷，用于调试
    console.log(`[VRCTL] POST ${path}?${other}`, JSON.stringify(body));

    // 1. 获取签名信息
    const auth = await vrController.getAuthInfo(path, method, other, body);


    // 2. 发送实际更新请求
    const client = getClient();
    const response = await client.post(`${path}?${other}`, body, {
      headers: {
        Authorization: auth.Authorization,
        tonce: auth.tonce,
      },
    });

    // 返回完整响应以便调试
    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
    };
  },

  /**
   * 获取所有 VR3 配置列表
   * 使用 csmRequest 统一签名逻辑，解决 axios 自动处理导致 signature_hash 不一致问题
   * 
   * @param pageSize 每页数量
   * @param pageNum 页码
   */
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

  /**
   * 获取 VR1 分页列表
   * 使用 csmRequest (基于 curl) 来避免 axios 签名问题
   * 
   * @param pageSize 每页数量
   * @param pageNum 页码
   */
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
