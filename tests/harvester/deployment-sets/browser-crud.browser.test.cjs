const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  fetchDeploymentSetOverview,
  deleteDeploymentSetsByPrefix,
  deleteDeploymentSet,
  findDeploymentSetByName,
} = require('./lib/deployment-sets-api.cjs');
const {
  openDeploymentSetsPage,
  clickCreateDeploymentSet,
  fillDeploymentSetForm,
  submitDeploymentSetModal,
  searchDeploymentSetRow,
  hasRuntimeErrorOverlay,
  closeAntModal,
} = require('./lib/deployment-sets-page.cjs');

const prefix = process.env.TOWER_DS_NAME_PREFIX || 'tower-e2e-ds';
const setName = process.env.TOWER_DS_SET_NAME || `${prefix}-${Date.now()}`;

test('Harvester 部署集 CRUD', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '部署集', story: '创建' });
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const cleaned = await deleteDeploymentSetsByPrefix(token, cloudId, prefix);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
    });
    await step(page, '打开部署集页', async () => {
      await openDeploymentSetsPage(page, cloudId);
    });

    await step(page, '空表单提交校验', async () => {
      const emptyModal = await clickCreateDeploymentSet(page);
      await submitDeploymentSetModal(emptyModal);
      await page.getByText('请输入部署集名称').first().waitFor({ timeout: 10000 });
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('empty submit should not trigger Uncaught runtime errors overlay');
      }
      await closeAntModal(emptyModal);
    });

    await step(page, '创建部署集', async () => {
      const createModal = await clickCreateDeploymentSet(page);
      await fillDeploymentSetForm(createModal, {
        name: setName,
        description: 'tower browser e2e',
      });
      await submitDeploymentSetModal(createModal);
      await page.getByText('已创建').first().waitFor({ timeout: 60000 });
    });

    await step(page, '搜索新建部署集', async () => {
      const row = await searchDeploymentSetRow(page, setName);
      const rowText = await row.innerText();
      if (!rowText.includes(setName)) {
        throw new Error(`expected row to contain ${setName}`);
      }
    });
  });

  const overview1 = await fetchDeploymentSetOverview(token, cloudId);
  const created = findDeploymentSetByName(overview1, setName);
  if (!created?.id) throw new Error(`API overview missing deployment set ${setName}`);
  await deleteDeploymentSet(token, cloudId, created.id);

  console.log(
    JSON.stringify({ ok: true, cloudId, setName, cleaned }, null, 2),
  );
});
