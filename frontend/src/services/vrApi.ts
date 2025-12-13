import axios from 'axios';

// 调试日志函数
function logDebug(message: string) {
  console.log(`[VR_DEBUG] ${message}`);
}

function logError(message: string) {
  console.error(`[VR_DEBUG_ERROR] ${message}`);
}

// 基础URL配置 - 开发环境使用代理路径，生产环境使用直接URL
const API_BASE_URL = process.env.NODE_ENV === 'development' ? '' : 'https://10.20.255.93:8016';
const API_PROXY_PATH = '/api-proxy';

// 认证信息接口
export interface AuthInfo {
  Authorization: string; // 使用大写开头，与test-vr-api.js一致
  tonce: number;
}



// 获取认证信息 - 完全复制test-vr-api.js的实现方式
export const getAuthInfo = async (pageSize: number = 3, pageNum: number = 1): Promise<AuthInfo> => {
  logDebug('开始获取认证信息');
  
  try {
    // 与test-vr-api.js完全相同的参数
    const ACCESS_KEY = "Cloudmap%23123";
    const SECRET_KEY = "Cloudmap%23123";
    const path = "/V2/ctcontrol/VR1/pagelist";
    const method = "GET";
    const other = `page_size=${pageSize}&page_num=${pageNum}`;
    
    // 详细打印参数信息，便于调试
    logDebug(`构建认证参数详情:`);
    logDebug(`  path: ${path}`);
    logDebug(`  method: ${method}`);
    logDebug(`  other: ${other}`);
    logDebug(`  ACCESS_KEY: ${ACCESS_KEY}`);
    logDebug(`  SECRET_KEY: ${SECRET_KEY}`);
    
    // 构建URL - 开发环境使用代理路径，生产环境使用直接URL
    const baseUrl = process.env.NODE_ENV === 'development' ? API_PROXY_PATH : API_BASE_URL;
    const authUrl = `${baseUrl}/api/sign?` +
      `url=${encodeURIComponent(path)}&` +
      `method=${method}&` +
      `other=${encodeURIComponent(other)}&` +
      `accessKey=${ACCESS_KEY}&` +
      `secretKey=${SECRET_KEY}`;
    
    logDebug(`认证请求URL: ${authUrl}`);
    
    // 发送POST请求，与test-vr-api.js完全一致
    const response = await axios.post(authUrl, '', {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    logDebug(`认证响应状态: ${response.status}`);
    logDebug(`认证响应数据: ${JSON.stringify(response.data)}`);
    
    // 检查响应格式
    if (!response.data || !response.data.data) {
      throw new Error('认证响应数据格式错误');
    }
    
    // 提取认证信息，保持与test-vr-api.js一致
    const authInfo = response.data.data;
    
    if (!authInfo.Authorization || !authInfo.tonce) {
      throw new Error('认证信息不完整');
    }
    
    logDebug(`✅ 认证成功，获取到授权信息`);
    return authInfo as AuthInfo;
  } catch (error: any) {
    logError(`❌ 获取认证信息失败: ${error.message}`);
    if (axios.isAxiosError(error) && error.response) {
      logError(`错误响应: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
};

// 导出额外的测试函数
export const vrApiUtils = {
  testAuth: async () => {
    logDebug('开始认证测试');
    try {
      const authInfo = await getAuthInfo();
      logDebug(`认证测试成功! Authorization: ${authInfo.Authorization}`);
      return { success: true, authInfo };
    } catch (error: any) {
      logError(`认证测试失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
};

// VR API服务 - 完全按照test-vr-api.js的方式实现
export const vrApi = {
  // 获取VR实例列表
  getVRInstances: async (pageSize: number = 3, pageNum: number = 1) => {
    logDebug(`获取VR实例列表: pageSize=${pageSize}, pageNum=${pageNum}`);
    try {
      // 获取认证信息
      const authInfo = await getAuthInfo(pageSize, pageNum);
      
      logDebug(`使用认证信息: Authorization=${authInfo.Authorization}, tonce=${authInfo.tonce}`);
      
      // 构建API URL - 开发环境使用代理路径，生产环境使用直接URL
      const baseUrl = process.env.NODE_ENV === 'development' ? API_PROXY_PATH : API_BASE_URL;
      const apiUrl = `${baseUrl}/V2/ctcontrol/VR1/pagelist?page_size=${pageSize}&page_num=${pageNum}`;
      
      // 构建请求头，与test-vr-api.js完全一致
      // 注意：使用大写的Authorization，并添加Bearer前缀
      const response = await axios.get(apiUrl, {
        headers: {
            'Content-Type': 'application/json',
            // 与 VR 实例管理页保持一致：不加 Bearer，仅传 Authorization 与小写 tonce
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          },
        timeout: 20000
      });
      
      logDebug(`获取VR实例列表成功，响应状态: ${response.status}`);
      logDebug(`响应数据: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: any) {
      logError(`获取VR实例列表失败: ${error.message}`);
      if (axios.isAxiosError(error) && error.response) {
        logError(`响应错误数据: ${JSON.stringify(error.response.data)}`);
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  // 其他API方法使用相同的认证方式
  getVRInstance: async (vmId: string) => {
    try {
      const authInfo = await getAuthInfo(1, 1);
      const baseUrl = process.env.NODE_ENV === 'development' ? API_PROXY_PATH : API_BASE_URL;
      const response = await axios.get(`${baseUrl}/V2/ctcontrol/VR1/${vmId}`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      logError(`获取VR实例详情失败: ${error.message}`);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  createVRInstance: async (data: any) => {
    try {
      const authInfo = await getAuthInfo(1, 1);
      const baseUrl = process.env.NODE_ENV === 'development' ? API_PROXY_PATH : API_BASE_URL;
      const response = await axios.post(`${baseUrl}/V2/ctcontrol/VR1`, data, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      logError(`创建VR实例失败: ${error.message}`);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  updateVRInstance: async (vmId: string, data: any) => {
    try {
      const authInfo = await getAuthInfo(1, 1);
      const baseUrl = process.env.NODE_ENV === 'development' ? API_PROXY_PATH : API_BASE_URL;
      const response = await axios.put(`${baseUrl}/V2/ctcontrol/VR1/${vmId}`, data, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      logError(`更新VR实例失败: ${error.message}`);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  },
  
  deleteVRInstance: async (vmId: string) => {
    try {
      const authInfo = await getAuthInfo(1, 1);
      const baseUrl = process.env.NODE_ENV === 'development' ? API_PROXY_PATH : API_BASE_URL;
      const response = await axios.delete(`${baseUrl}/V2/ctcontrol/VR1/${vmId}`, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authInfo.Authorization,
            'tonce': authInfo.tonce
          }
      });
      return response.data;
    } catch (error: any) {
      logError(`删除VR实例失败: ${error.message}`);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`[错误码: ${error.response.data.code}] ${error.response.data.msg}`);
      }
      throw error;
    }
  }
}