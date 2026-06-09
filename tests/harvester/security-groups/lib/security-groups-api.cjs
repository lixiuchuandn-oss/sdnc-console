const { towerApi } = require('../../../shared/tower-api.cjs');

const SUBNET_TYPE_KEY = 'tower.io/subnet-type';

async function fetchSecurityGroups(token, cloudId) {
  const { status, data } = await towerApi(
    'GET',
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups`,
    null,
    token,
  );
  if (status !== 200) {
    throw new Error(data?.message || `list HTTP ${status}`);
  }
  return data?.data || data;
}

async function fetchSecurityGroupDetail(token, cloudId, sgId) {
  const { status, data } = await towerApi(
    'GET',
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}`,
    null,
    token,
  );
  if (status !== 200) {
    throw new Error(data?.message || `detail HTTP ${status}`);
  }
  return data?.data || data;
}

async function createSecurityGroup(token, cloudId, body) {
  const { status, data } = await towerApi(
    'POST',
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups`,
    body,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function updateSecurityGroup(token, cloudId, sgId, body) {
  const { status, data } = await towerApi(
    'PATCH',
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}`,
    body,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function replaceSecurityGroupRules(token, cloudId, sgId, rules) {
  const { status, data } = await towerApi(
    'PUT',
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}/rules`,
    { rules },
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function deleteSecurityGroup(token, cloudId, sgId) {
  const { status, data } = await towerApi(
    'DELETE',
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}`,
    null,
    token,
  );
  return { status, message: data?.message };
}

function listItems(payload) {
  const items = payload?.items;
  return Array.isArray(items) ? items : [];
}

function findSecurityGroupByName(payload, name) {
  return listItems(payload).find((row) => String(row?.name || '') === name) || null;
}

async function deleteSecurityGroupsByPrefix(token, cloudId, prefix) {
  const payload = await fetchSecurityGroups(token, cloudId);
  const removed = [];
  for (const row of listItems(payload)) {
    if (!String(row?.name || '').startsWith(prefix)) continue;
    const { status } = await deleteSecurityGroup(token, cloudId, row.id);
    if (status === 200) removed.push(row.name);
  }
  return removed;
}

async function resolveFlatSubnetName(token, cloudId) {
  const fromEnv = String(process.env.TOWER_SG_SUBNET_NAME || '').trim();
  if (fromEnv) return fromEnv;

  const { status, data } = await towerApi(
    'GET',
    `/api/clouds/${cloudId}/resources/subnets?ovnNetworkScope=all&force=true`,
    null,
    token,
  );
  if (status !== 200) {
    throw new Error(data?.message || `subnets HTTP ${status}`);
  }
  const items = Array.isArray(data?.data?.items) ? data.data.items : [];
  for (const item of items) {
    const ann = item?.metadata?.annotations || item?.annotations || {};
    if (String(ann[SUBNET_TYPE_KEY] || '').trim().toLowerCase() !== 'flat') continue;
    const name = String(item?.metadata?.name || item?.name || '').trim();
    if (name) return name;
  }
  throw new Error('未找到扁平子网，请设置 TOWER_SG_SUBNET_NAME');
}

module.exports = {
  fetchSecurityGroups,
  fetchSecurityGroupDetail,
  createSecurityGroup,
  updateSecurityGroup,
  replaceSecurityGroupRules,
  deleteSecurityGroup,
  findSecurityGroupByName,
  deleteSecurityGroupsByPrefix,
  resolveFlatSubnetName,
};
