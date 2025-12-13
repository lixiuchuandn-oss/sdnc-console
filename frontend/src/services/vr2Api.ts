// VR2 配置查询（远端）
// 通过开发代理 /api-proxy 转发到远端 10.20.255.93:8016，并在调用前进行签名以附带 Authorization/tonce

// 使用 fetch，避免额外依赖；按 vrApi 的签名逻辑自行实现一次签名

const API_PROXY_PATH = '/api-proxy';

interface SignResp {
  data?: { Authorization?: string; tonce?: number };
  code?: number;
  msg?: string;
}

export const getVR2Config = async (uuid: string): Promise<any> => {
  if (!uuid) throw new Error('缺少UUID');

  const baseUrl = API_PROXY_PATH; // 开发环境使用代理路径
  // 按远端签名服务的规范构建签名请求
  const ACCESS_KEY = 'Cloudmap%23123';
  const SECRET_KEY = 'Cloudmap%23123';
  const path = '/V2/ctcontrol/VR2/VRConfig';
  const method = 'GET';
  // 与专家模式一致：other 不做额外编码，后续请求 query 也保持一致
  const other = `uuid=${uuid}`;

  const signUrl = `${baseUrl}/api/sign?` +
    `url=${encodeURIComponent(path)}&` +
    `method=${method}&` +
    `other=${encodeURIComponent(other)}&` +
    `accessKey=${ACCESS_KEY}&` +
    `secretKey=${SECRET_KEY}`;

  // 调用签名服务
  const signRes = await fetch(signUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  if (!signRes.ok) {
    throw new Error(`签名请求失败: ${signRes.status}`);
  }
  const signJson: SignResp = await signRes.json();
  const auth = signJson?.data;
  if (!auth?.Authorization || !auth?.tonce) {
    throw new Error(`签名响应格式错误: ${JSON.stringify(signJson)}`);
  }

  // 调用 VR2 配置查询
  // 与专家模式一致：使用与签名相同的 other 作为查询串，确保签名匹配
  const cfgUrl = `${baseUrl}${path}?${other}`;
  const res = await fetch(cfgUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      // 与“专家模式/查询现有配置”完全一致：不加 Bearer，仅传 Authorization 与小写 tonce
      'Authorization': auth.Authorization,
      'tonce': String(auth.tonce)
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`VR2配置查询失败: ${res.status} ${txt}`);
  }
  const json = await res.json();
  // 兼容可能的返回结构
  const data = (json as any)?.data ?? json;
  return data;
};

export default { getVR2Config };