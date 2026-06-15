const { towerApi } = require('../../../shared/tower-api.cjs');
const {
  SUBNET_ALIAS_KEY,
  SUBNET_TYPE_KEY,
  PUBLIC_VPC,
  OVN_INTERNAL_ROUTE_CIDR,
  SUBNET_FINALIZER,
  generateSubnetUnderlayCrName,
  fetchPublicSubnets,
  pickUnusedPublicSubnetCidr,
  findPublicSubnetByAlias,
  deletePublicSubnet,
  deletePublicSubnetsByAliasPrefix,
  fetchVlans,
  resolveProviderNetworkName,
  pickUnusedVlanId,
  findVlanByAlias,
  deleteVlan,
  VLAN_ALIAS_KEY,
  generateVlanCrName,
} = require('../../lib/kube-ovn-e2e.cjs');
const { createVlan } = require('../../vlans/lib/vlans-api.cjs');

async function createPublicSubnet(token, cloudId, body) {
  const { status, data } = await towerApi(
    'POST',
    `/api/clouds/${cloudId}/resources/subnets`,
    body,
    token,
  );
  return { status, data: data?.data || data, message: data?.message || data?.error };
}

async function updatePublicSubnetAlias(token, cloudId, subnetName, alias) {
  const { status, data } = await towerApi(
    'PUT',
    `/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(subnetName)}`,
    {
      annotations: { [SUBNET_ALIAS_KEY]: String(alias).trim() },
    },
    token,
  );
  return { status, message: data?.message || data?.error };
}

async function seedVlanForPublicSubnet(token, cloudId, vlanAliasPrefix) {
  const provider = await resolveProviderNetworkName(token, cloudId);
  const vlans = await fetchVlans(token, cloudId, true);
  const vlanAlias = `${vlanAliasPrefix}-vlan-${Date.now()}`;
  const vlanId = pickUnusedVlanId(vlans, provider);
  const crName = generateVlanCrName();
  const created = await createVlan(token, cloudId, {
    name: crName,
    id: vlanId,
    provider,
    annotations: { [VLAN_ALIAS_KEY]: vlanAlias },
  });
  if (created.status !== 200) {
    throw new Error(created.message || `seed vlan HTTP ${created.status}`);
  }
  const list = await fetchVlans(token, cloudId, true);
  const row = findVlanByAlias(list, vlanAlias);
  if (!row?.metadata?.name) {
    throw new Error(`seed vlan missing after create: ${vlanAlias}`);
  }
  return {
    provider,
    vlanAlias,
    vlanId,
    vlanCrName: row.metadata.name,
    vlanSpecProvider: String(row?.spec?.provider || provider).trim(),
  };
}

function buildPublicSubnetPayload({
  name,
  alias,
  cidrBlock,
  gateway,
  vlanCrName,
  provider,
}) {
  return {
    name,
    cidrBlock,
    gateway,
    vlan: vlanCrName,
    protocol: 'IPv4',
    allowEWTraffic: false,
    vpc: PUBLIC_VPC,
    gatewayType: 'distributed',
    private: false,
    natOutgoing: true,
    ...(provider ? { provider } : {}),
    annotations: {
      [SUBNET_TYPE_KEY]: 'public',
      [OVN_INTERNAL_ROUTE_CIDR]: '0.0.0.0/0',
      [SUBNET_ALIAS_KEY]: alias,
    },
    finalizers: [SUBNET_FINALIZER],
  };
}

module.exports = {
  createPublicSubnet,
  updatePublicSubnetAlias,
  fetchPublicSubnets,
  pickUnusedPublicSubnetCidr,
  findPublicSubnetByAlias,
  deletePublicSubnet,
  deletePublicSubnetsByAliasPrefix,
  seedVlanForPublicSubnet,
  buildPublicSubnetPayload,
  generateSubnetUnderlayCrName,
  deleteVlan,
  SUBNET_ALIAS_KEY,
};
