const { towerApi, listCloudPools } = require('../../../shared/tower-api.cjs');

function isCsmCloud(pool) {
  return (
    String(pool?.config?.provider || '')
      .trim()
      .toLowerCase() === 'cloudmap.csm'
  );
}

async function resolveCsmCloudId(token, { cloudId, endpointHint } = {}) {
  if (cloudId) return cloudId;
  const pools = await listCloudPools(token);
  const csmPools = pools.filter(isCsmCloud);
  if (endpointHint) {
    const hint = String(endpointHint).trim().toLowerCase();
    const hit = csmPools.find((p) => String(p.endpoint || '').toLowerCase().includes(hint));
    if (hit?.id) return hit.id;
  }
  const online = csmPools.find((p) => String(p.status || '').toLowerCase() === 'online');
  if (online?.id) return online.id;
  if (csmPools[0]?.id) return csmPools[0].id;
  throw new Error('未找到 CSM 资源池；请设置 TOWER_CSM_CLOUD_ID 或 TOWER_CSM_ENDPOINT_HINT');
}

async function fetchCsmCloud(token, cloudId) {
  const { status, data } = await towerApi('GET', `/api/clouds/${cloudId}`, null, token);
  if (status !== 200 || !data?.id) {
    throw new Error(`读取 CSM 资源池失败 HTTP ${status}`);
  }
  if (!isCsmCloud(data)) {
    throw new Error(`资源池 ${cloudId} 不是 cloudmap.csm 类型`);
  }
  return data;
}

async function getCsmBff(token, cloudId, subPath) {
  return towerApi('GET', `/api/clouds/${cloudId}/csm/${subPath}`, null, token);
}

async function patchCsmRepairAuth(token, cloudId, cloud, repairAuth) {
  const cfg = { ...(cloud.config || {}) };
  if (repairAuth.username) cfg.csmRepairUsername = repairAuth.username;
  if (repairAuth.password) cfg.csmRepairPassword = repairAuth.password;
  if (repairAuth.passwordEncrypted) cfg.csmRepairPasswordEncrypted = repairAuth.passwordEncrypted;
  if (repairAuth.webPort) cfg.csmWebPort = repairAuth.webPort;
  // 仅更新 config，避免 PUT 回写 GET 中已脱敏的 accessKey/secretKey
  return towerApi('PUT', `/api/clouds/${cloudId}`, { config: cfg }, token);
}

function hasCsmRepairAuthInConfig(cloud) {
  const cfg = cloud?.config || {};
  return Boolean(
    String(
      cfg.csmRepairPassword ??
        cfg.csmRepairPasswordEncrypted ??
        cfg.csmApiPasswordEncrypted ??
        '',
    ).trim(),
  );
}

module.exports = {
  isCsmCloud,
  resolveCsmCloudId,
  fetchCsmCloud,
  getCsmBff,
  patchCsmRepairAuth,
  hasCsmRepairAuthInConfig,
};
