const { towerApi } = require('../../shared/tower-api.cjs');

const VLAN_ALIAS_KEY = 'tower.io/alies';
const SUBNET_ALIAS_KEY = 'tower.io/alias';
const SUBNET_TYPE_KEY = 'tower.io/subnet-type';
const PUBLIC_VPC = 'ovn-cluster';
const OVN_INTERNAL_ROUTE_CIDR = 'tower.io/ovn-internal-route-cidr';
const SUBNET_FINALIZER = 'tower.io/managed';

function generateVlanCrName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateSubnetUnderlayCrName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 11; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `id-sn-${rand}`;
}

function listItems(payload) {
  const items = payload?.items ?? payload?.data?.items;
  return Array.isArray(items) ? items : [];
}

function aliasFromVlan(row) {
  const ann = row?.metadata?.annotations || row?.annotations || {};
  return String(ann[VLAN_ALIAS_KEY] || '').trim();
}

function aliasFromSubnet(row) {
  const ann = row?.metadata?.annotations || row?.annotations || {};
  return String(ann[SUBNET_ALIAS_KEY] || '').trim();
}

function subnetType(row) {
  const ann = row?.metadata?.annotations || row?.annotations || {};
  return String(ann[SUBNET_TYPE_KEY] || '').trim().toLowerCase();
}

function providerMetaName(row) {
  const raw = row?.raw || row?.rawData || row;
  const meta = raw?.metadata || row?.metadata || {};
  return String(meta?.name || row?.name || '').trim();
}

function providerDisplayAlias(row) {
  const raw = row?.raw || row?.rawData || row;
  const ann = raw?.metadata?.annotations || row?.metadata?.annotations || row?.annotations || {};
  return String(ann[VLAN_ALIAS_KEY] || '').trim();
}

async function fetchProviderNetworks(token, cloudId, force = false) {
  const qs = force ? '?force=true&skipSync=true' : '';
  const { status, data } = await towerApi(
    'GET',
    `/api/clouds/${cloudId}/resources/provider-networks${qs}`,
    null,
    token,
  );
  if (status !== 200) {
    throw new Error(data?.message || `provider-networks HTTP ${status}`);
  }
  return listItems(data?.data || data);
}

async function resolveProviderNetworkName(token, cloudId) {
  const fromEnv = String(process.env.TOWER_PN_NAME || '').trim();
  if (fromEnv) return fromEnv;
  const items = await fetchProviderNetworks(token, cloudId, true);
  const first = items.find((row) => providerMetaName(row));
  const name = providerMetaName(first);
  if (!name) {
    throw new Error(
      '环境中无可用物理网络（仅引用存量，不创建）。请先在集群配置物理网络或设置 TOWER_PN_NAME',
    );
  }
  return name;
}

async function createVlan(token, cloudId, body) {
  const { status, data } = await towerApi('POST', `/api/clouds/${cloudId}/resources/vlans`, body, token);
  return { status, data: data?.data || data, message: data?.message || data?.error };
}

async function fetchVlans(token, cloudId, force = false) {
  const qs = force ? '?force=true' : '';
  const { status, data } = await towerApi('GET', `/api/clouds/${cloudId}/resources/vlans${qs}`, null, token);
  if (status !== 200) {
    throw new Error(data?.message || `vlans HTTP ${status}`);
  }
  return listItems(data?.data || data);
}

async function fetchPublicSubnets(token, cloudId, force = false) {
  const qs = force ? '?ovnNetworkScope=all&force=true' : '?ovnNetworkScope=all';
  const { status, data } = await towerApi('GET', `/api/clouds/${cloudId}/resources/subnets${qs}`, null, token);
  if (status !== 200) {
    throw new Error(data?.message || `subnets HTTP ${status}`);
  }
  return listItems(data?.data || data).filter((row) => subnetType(row) === 'public');
}

function pickUnusedVlanId(vlans, providerName) {
  const provider = String(providerName || '').trim();
  const used = new Set();
  for (const row of vlans) {
    if (String(row?.spec?.provider || '').trim() !== provider) continue;
    const id = Number(row?.spec?.id);
    if (Number.isFinite(id)) used.add(id);
  }
  const base = 3000 + Math.floor(Math.random() * 800);
  for (let id = base; id <= 4094; id++) {
    if (!used.has(id)) return id;
  }
  for (let id = 2; id < 4095; id++) {
    if (!used.has(id)) return id;
  }
  throw new Error('未找到可用的 VLAN ID');
}

function pickUnusedPublicSubnetCidr(publicSubnets) {
  const used = new Set(
    publicSubnets.map((row) => String(row?.spec?.cidrBlock || row?.spec?.cidr || '').trim()).filter(Boolean),
  );
  for (let i = 0; i < 200; i++) {
    const third = 10 + Math.floor(Math.random() * 200);
    const cidr = `10.241.${third}.0/24`;
    if (!used.has(cidr)) {
      return { cidrBlock: cidr, gateway: `10.241.${third}.1` };
    }
  }
  throw new Error('未找到可用的公共子网 CIDR');
}

function findVlanByAlias(vlans, alias) {
  const target = String(alias || '').trim();
  return vlans.find((row) => aliasFromVlan(row) === target) || null;
}

function findPublicSubnetByAlias(subnets, alias) {
  const target = String(alias || '').trim();
  return subnets.find((row) => aliasFromSubnet(row) === target) || null;
}

async function deleteVlan(token, cloudId, name) {
  const { status, data } = await towerApi(
    'DELETE',
    `/api/clouds/${cloudId}/resources/vlans/${encodeURIComponent(name)}`,
    null,
    token,
  );
  return { status, message: data?.message || data?.error };
}

async function deletePublicSubnet(token, cloudId, name) {
  const { status, data } = await towerApi(
    'DELETE',
    `/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(name)}`,
    null,
    token,
  );
  return { status, message: data?.message || data?.error };
}

async function deleteVlansByAliasPrefix(token, cloudId, prefix) {
  const vlans = await fetchVlans(token, cloudId, true);
  const removed = [];
  for (const row of vlans) {
    const alias = aliasFromVlan(row);
    if (!alias.startsWith(prefix)) continue;
    const name = String(row?.metadata?.name || '').trim();
    if (!name) continue;
    const { status } = await deleteVlan(token, cloudId, name);
    if (status === 200) removed.push(alias);
  }
  return removed;
}

async function deletePublicSubnetsByAliasPrefix(token, cloudId, prefix) {
  const subnets = await fetchPublicSubnets(token, cloudId, true);
  const removed = [];
  for (const row of subnets) {
    const alias = aliasFromSubnet(row);
    if (!alias.startsWith(prefix)) continue;
    const name = String(row?.metadata?.name || '').trim();
    if (!name) continue;
    const { status } = await deletePublicSubnet(token, cloudId, name);
    if (status === 200) removed.push(alias);
  }
  return removed;
}

async function cleanupTestKubeOvnArtifacts(token, cloudId, vlanPrefix, subnetPrefix) {
  const removedSubnets = await deletePublicSubnetsByAliasPrefix(token, cloudId, subnetPrefix);
  const removedVlans = await deleteVlansByAliasPrefix(token, cloudId, vlanPrefix);
  return { removedSubnets, removedVlans };
}

module.exports = {
  VLAN_ALIAS_KEY,
  SUBNET_ALIAS_KEY,
  SUBNET_TYPE_KEY,
  PUBLIC_VPC,
  OVN_INTERNAL_ROUTE_CIDR,
  SUBNET_FINALIZER,
  generateVlanCrName,
  generateSubnetUnderlayCrName,
  fetchProviderNetworks,
  resolveProviderNetworkName,
  createVlan,
  fetchVlans,
  fetchPublicSubnets,
  pickUnusedVlanId,
  pickUnusedPublicSubnetCidr,
  findVlanByAlias,
  findPublicSubnetByAlias,
  aliasFromVlan,
  aliasFromSubnet,
  providerDisplayAlias,
  deleteVlan,
  deletePublicSubnet,
  deleteVlansByAliasPrefix,
  deletePublicSubnetsByAliasPrefix,
  cleanupTestKubeOvnArtifacts,
};
