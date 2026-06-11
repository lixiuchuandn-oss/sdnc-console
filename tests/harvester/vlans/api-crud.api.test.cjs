const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const {
  createVlan,
  fetchVlans,
  resolveProviderNetworkName,
  pickUnusedVlanId,
  findVlanByAlias,
  deleteVlan,
  deleteVlansByAliasPrefix,
  generateVlanCrName,
  VLAN_ALIAS_KEY,
} = require('./lib/vlans-api.cjs');

const prefix = process.env.TOWER_VLAN_ALIAS_PREFIX || 'tower-e2e-vlan';
const vlanAlias = process.env.TOWER_VLAN_ALIAS || `${prefix}-${Date.now()}`;

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const cleaned = await deleteVlansByAliasPrefix(token, cloudId, prefix);

  const provider = await resolveProviderNetworkName(token, cloudId);
  const vlansBefore = await fetchVlans(token, cloudId, true);
  const vlanId = pickUnusedVlanId(vlansBefore, provider);
  const crName = generateVlanCrName();

  const created = await createVlan(token, cloudId, {
    name: crName,
    id: vlanId,
    provider,
    annotations: { [VLAN_ALIAS_KEY]: vlanAlias },
  });
  if (created.status !== 200) {
    throw new Error(created.message || `create HTTP ${created.status}`);
  }

  const vlansAfter = await fetchVlans(token, cloudId, true);
  const row = findVlanByAlias(vlansAfter, vlanAlias);
  if (!row?.metadata?.name) {
    throw new Error(`vlan not found after create: ${vlanAlias}`);
  }

  const deleted = await deleteVlan(token, cloudId, row.metadata.name);
  if (deleted.status !== 200) {
    throw new Error(deleted.message || `delete HTTP ${deleted.status}`);
  }

  console.log(
    JSON.stringify(
      { ok: true, cloudId, vlanAlias, vlanId, provider, crName, cleaned },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
