// VR2 配置查询（远端）
// 通过开发代理 /api-proxy 转发到远端 10.20.255.93:8016，并在调用前进行签名以附带 Authorization/tonce

// 使用 fetch，避免额外依赖；按 vrApi 的签名逻辑自行实现一次签名

import { API_BASE_URL, getAuthHeaders } from './api';

// 保留原函数签名以兼容其他模块，但内部改为调用后端API
export const getVR2Config = async (uuid: string): Promise<any> => {
  return await fetchVR2(uuid);
};

// 获取原始响应 (Expert Mode) - 现在走后端正规军 API
export const getVR2ConfigRaw = async (uuid: string): Promise<any> => {
  return await fetchVR2(uuid);
};

// 内部实现：调用后端 /api/vr-config/:uuid/realtime
  const fetchVR2 = async (uuid: string): Promise<any> => {
    if (!uuid) throw new Error('缺少UUID');
    
    const url = `${API_BASE_URL}/api/vr-config/${uuid}/realtime`;
  
  const res = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders()
  });

  if (!res.ok) {
    const txt = await res.text();
    // 尝试解析 JSON 错误信息
    try {
        const json = JSON.parse(txt);
        throw new Error(json.msg || json.message || `VR配置查询失败: ${res.status}`);
    } catch (e) {
        if (e instanceof Error && e.message.startsWith('VR配置查询失败')) throw e;
        throw new Error(`VR配置查询失败: ${res.status} ${txt}`);
    }
  }

  const json = await res.json();
  // 后端返回结构为 { code: 200, msg: 'ok', data: {...} }
  // 我们需要返回 data 部分以保持兼容性
  return json.data;
};

export default { getVR2Config };