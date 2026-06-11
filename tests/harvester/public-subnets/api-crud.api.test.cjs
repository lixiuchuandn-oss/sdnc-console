const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { cleanupTestKubeOvnArtifacts } = require('../lib/kube-ovn-e2e.cjs');
const {
  createPublicSubnet,
  fetchPublicSubnets,
  pickUnusedPublicSubnetCidr,
  findPublicSubnetByAlias,
  deletePublicSubnet,
  deleteVlan,
  seedVlanForPublicSubnet,
  buildPublicSubnetPayload,
  generateSubnetUnderlayCrName,
  updatePublicSubnetAlias,
} = require('./lib/public-subnets-api.cjs');

const vlanPrefix = process.env.TOWER_VLAN_ALIAS_PREFIX || 'tower-e2e-vlan';
const subnetPrefix = process.env.TOWER_PUBLIC_SN_ALIAS_PREFIX || 'tower-e2e-pub-sn';
const subnetAlias = process.env.TOWER_PUBLIC_SN_ALIAS || `${subnetPrefix}-${Date.now()}`;

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const cleaned = await cleanupTestKubeOvnArtifacts(token, cloudId, vlanPrefix, subnetPrefix);

  const seed = await seedVlanForPublicSubnet(token, cloudId, vlanPrefix);
  const publicSubnets = await fetchPublicSubnets(token, cloudId, true);
  const { cidrBlock, gateway } = pickUnusedPublicSubnetCidr(publicSubnets);
  const crName = generateSubnetUnderlayCrName();

  const payload = buildPublicSubnetPayload({
    name: crName,
    alias: subnetAlias,
    cidrBlock,
    gateway,
    vlanCrName: seed.vlanCrName,
    provider: seed.vlanSpecProvider,
  });

  const created = await createPublicSubnet(token, cloudId, payload);
  if (created.status !== 200 && created.status !== 201) {
    await deleteVlan(token, cloudId, seed.vlanCrName).catch(() => {});
    throw new Error(created.message || `create HTTP ${created.status}`);
  }

  const list1 = await fetchPublicSubnets(token, cloudId, true);
  const row = findPublicSubnetByAlias(list1, subnetAlias);
  if (!row?.metadata?.name) {
    await deleteVlan(token, cloudId, seed.vlanCrName).catch(() => {});
    throw new Error(`public subnet not found after create: ${subnetAlias}`);
  }

  const updatedAlias = `${subnetAlias}-upd`;
  const updated = await updatePublicSubnetAlias(token, cloudId, row.metadata.name, updatedAlias);
  if (updated.status !== 200) {
    throw new Error(updated.message || `update HTTP ${updated.status}`);
  }

  const list2 = await fetchPublicSubnets(token, cloudId, true);
  const row2 = findPublicSubnetByAlias(list2, updatedAlias);
  if (!row2?.metadata?.name) {
    throw new Error(`public subnet not found after alias update: ${updatedAlias}`);
  }

  const deleted = await deletePublicSubnet(token, cloudId, row2.metadata.name);
  if (deleted.status !== 200) {
    throw new Error(deleted.message || `delete HTTP ${deleted.status}`);
  }
  await deleteVlan(token, cloudId, seed.vlanCrName);

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        subnetAlias: updatedAlias,
        cidrBlock,
        vlanAlias: seed.vlanAlias,
        cleaned,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
