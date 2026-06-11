const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  fetchVlans,
  resolveProviderNetworkName,
  pickUnusedVlanId,
  findVlanByAlias,
  deleteVlan,
  deleteVlansByAliasPrefix,
} = require('./lib/vlans-api.cjs');
const { fetchProviderNetworks, providerDisplayAlias } = require('../lib/kube-ovn-e2e.cjs');
const {
  openVlansPage,
  openVlanPlanDrawer,
  selectProviderInVlanPlanDrawer,
  openAddVlanModal,
  fillAddVlanModal,
  submitAddVlanModal,
  searchVlanRow,
  hasRuntimeErrorOverlay,
} = require('./lib/vlans-page.cjs');

const prefix = process.env.TOWER_VLAN_ALIAS_PREFIX || 'tower-e2e-vlan';
const vlanAlias = process.env.TOWER_VLAN_ALIAS || `${prefix}-ui-${Date.now()}`;

test('Harvester VLAN 创建', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: 'VLAN', story: '网络规划创建' });
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const cleaned = await deleteVlansByAliasPrefix(token, cloudId, prefix);

  const provider = await resolveProviderNetworkName(token, cloudId);
  const providers = await fetchProviderNetworks(token, cloudId, true);
  const providerRow = providers.find((p) => {
    const raw = p?.raw || p?.rawData || p;
    return String(raw?.metadata?.name || p?.name || '').trim() === provider;
  });
  const providerLabel = providerDisplayAlias(providerRow) || provider;

  const vlansBefore = await fetchVlans(token, cloudId, true);
  const vlanId = pickUnusedVlanId(vlansBefore, provider);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
    });
    await step(page, '打开 VLAN 页', async () => {
      await openVlansPage(page, cloudId);
    });
    await step(page, '网络规划添加 VLAN', async () => {
      await openVlanPlanDrawer(page);
      await selectProviderInVlanPlanDrawer(page, providerLabel);
      const modal = await openAddVlanModal(page);
      await fillAddVlanModal(modal, {
        alias: vlanAlias,
        vlanId,
      });
      await submitAddVlanModal(modal);
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('VLAN create triggered runtime error overlay');
      }
    });
    await step(page, '列表搜索新建 VLAN', async () => {
      const row = await searchVlanRow(page, vlanAlias);
      const rowText = await row.innerText();
      if (!rowText.includes(vlanAlias)) {
        throw new Error(`expected row to contain ${vlanAlias}`);
      }
    });
  });

  const vlansAfter = await fetchVlans(token, cloudId, true);
  const created = findVlanByAlias(vlansAfter, vlanAlias);
  if (!created?.metadata?.name) {
    throw new Error(`API list missing vlan ${vlanAlias}`);
  }
  await deleteVlan(token, cloudId, created.metadata.name);

  console.log(
    JSON.stringify({ ok: true, cloudId, vlanAlias, vlanId, provider, cleaned }, null, 2),
  );
});
