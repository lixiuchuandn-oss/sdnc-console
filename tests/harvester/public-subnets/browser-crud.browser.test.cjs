const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const { cleanupTestKubeOvnArtifacts } = require('../lib/kube-ovn-e2e.cjs');
const {
  fetchPublicSubnets,
  pickUnusedPublicSubnetCidr,
  findPublicSubnetByAlias,
  deletePublicSubnet,
  deleteVlan,
  seedVlanForPublicSubnet,
} = require('./lib/public-subnets-api.cjs');
const {
  openPublicSubnetsPage,
  clickCreatePublicSubnet,
  fillPublicSubnetCreateForm,
  submitCreatePublicSubnetModal,
  searchPublicSubnetRow,
  openEditPublicSubnetName,
  submitEditNameModal,
  hasRuntimeErrorOverlay,
} = require('./lib/public-subnets-page.cjs');

const vlanPrefix = process.env.TOWER_VLAN_ALIAS_PREFIX || 'tower-e2e-vlan';
const subnetPrefix = process.env.TOWER_PUBLIC_SN_ALIAS_PREFIX || 'tower-e2e-pub-sn';
const subnetAlias = process.env.TOWER_PUBLIC_SN_ALIAS || `${subnetPrefix}-ui-${Date.now()}`;
const subnetAliasUpdated = `${subnetAlias}-renamed`;

test('Harvester 公共子网 创建与改名', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '公共子网', story: '创建与编辑名称' });
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const cleaned = await cleanupTestKubeOvnArtifacts(token, cloudId, vlanPrefix, subnetPrefix);

  const seed = await seedVlanForPublicSubnet(token, cloudId, vlanPrefix);
  const publicSubnets = await fetchPublicSubnets(token, cloudId, true);
  const { cidrBlock, gateway } = pickUnusedPublicSubnetCidr(publicSubnets);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
    });
    await step(page, '打开公共子网页', async () => {
      await openPublicSubnetsPage(page, cloudId);
    });
    await step(page, '创建公共子网', async () => {
      const modal = await clickCreatePublicSubnet(page);
      await fillPublicSubnetCreateForm(modal, {
        alias: subnetAlias,
        cidrBlock,
        gateway,
        vlanSearchText: seed.vlanAlias,
      });
      await submitCreatePublicSubnetModal(modal);
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('public subnet create triggered runtime error overlay');
      }
    });
    const row = await step(page, '搜索新建公共子网', async () => searchPublicSubnetRow(page, subnetAlias));
    await step(page, '编辑公共子网名称', async () => {
      const editModal = await openEditPublicSubnetName(page, row);
      await editModal.getByLabel('名称').fill(subnetAliasUpdated);
      await submitEditNameModal(editModal);
    });
    await step(page, '确认改名后列表可见', async () => {
      const row2 = await searchPublicSubnetRow(page, subnetAliasUpdated);
      const rowText = await row2.innerText();
      if (!rowText.includes(subnetAliasUpdated)) {
        throw new Error(`expected row to contain ${subnetAliasUpdated}`);
      }
    });
  });

  const list = await fetchPublicSubnets(token, cloudId, true);
  const created = findPublicSubnetByAlias(list, subnetAliasUpdated);
  if (!created?.metadata?.name) {
    throw new Error(`API list missing public subnet ${subnetAliasUpdated}`);
  }
  await deletePublicSubnet(token, cloudId, created.metadata.name);
  await deleteVlan(token, cloudId, seed.vlanCrName);

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        subnetAlias: subnetAliasUpdated,
        vlanAlias: seed.vlanAlias,
        cidrBlock,
        cleaned,
      },
      null,
      2,
    ),
  );
});
