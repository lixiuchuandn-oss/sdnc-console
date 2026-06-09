const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  fetchDeploymentSetOverview,
  createDeploymentSet,
  deleteDeploymentSetsByPrefix,
  findDeploymentSetByName,
} = require('./lib/deployment-sets-api.cjs');
const {
  openDeploymentSetsPage,
  searchDeploymentSetRow,
  openDeploymentSetEditModal,
  fillDeploymentSetForm,
  submitDeploymentSetModal,
  openDeploymentSetYamlDrawer,
  waitYamlDrawerContains,
  closeYamlDrawer,
  deleteDeploymentSetFromRow,
} = require('./lib/deployment-sets-page.cjs');

const prefix = process.env.TOWER_DS_NAME_PREFIX || 'tower-e2e-ds';
const setName = process.env.TOWER_DS_SET_NAME || `${prefix}-lifecycle-${Date.now()}`;

test('Harvester 部署集 编辑/YAML/删除', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '部署集', story: '编辑与删除' });
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const cleaned = await deleteDeploymentSetsByPrefix(token, cloudId, prefix);

  const created = await createDeploymentSet(token, cloudId, {
    name: setName,
    description: 'tower browser lifecycle seed',
    sortOrder: 1,
    schedulingPolicy: 'none',
    schedulingStrength: 'preferred',
    topologyKey: 'kubernetes.io/hostname',
  });
  if (created.status !== 200) {
    throw new Error(created.message || `seed create HTTP ${created.status}`);
  }

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
    });
    await step(page, '打开部署集页', async () => {
      await openDeploymentSetsPage(page, cloudId);
    });

    const row = await step(page, '搜索部署集', async () => searchDeploymentSetRow(page, setName));

    await step(page, '查看 YAML', async () => {
      await openDeploymentSetYamlDrawer(page, row);
      await waitYamlDrawerContains(page, ['hms.rivercloud.com/v1', 'DeploySet']);
      await closeYamlDrawer(page);
    });

    await step(page, '编辑部署集', async () => {
      const editModal = await openDeploymentSetEditModal(page, row);
      await fillDeploymentSetForm(editModal, { description: 'tower browser lifecycle updated' });
      await submitDeploymentSetModal(editModal);
      await page.getByText('已更新').first().waitFor({ timeout: 60000 });
    });

    await step(page, 'UI 删除部署集', async () => {
      const row2 = await searchDeploymentSetRow(page, setName);
      await deleteDeploymentSetFromRow(page, row2, setName);
      await page.getByText('已删除').first().waitFor({ timeout: 60000 });
    });
  });

  const overview = await fetchDeploymentSetOverview(token, cloudId);
  const stillThere = findDeploymentSetByName(overview, setName);
  if (stillThere?.id) {
    throw new Error(`deployment set ${setName} still exists after UI delete`);
  }

  console.log(
    JSON.stringify({ ok: true, cloudId, setName, cleaned }, null, 2),
  );
});
