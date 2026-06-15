const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  fetchSecurityGroups,
  deleteSecurityGroupsByPrefix,
  deleteSecurityGroup,
  findSecurityGroupByName,
  resolveFlatSubnetName,
} = require('./lib/security-groups-api.cjs');
const {
  openSecurityGroupsPage,
  clickCreateSecurityGroup,
  fillSecurityGroupCreateForm,
  submitSecurityGroupCreateModal,
  searchSecurityGroupRow,
  hasRuntimeErrorOverlay,
  closeAntModal,
} = require('./lib/security-groups-page.cjs');

const prefix = process.env.TOWER_SG_NAME_PREFIX || 'tower-e2e-sg';
const sgName = process.env.TOWER_SG_GROUP_NAME || `${prefix}-${Date.now()}`;

test('Harvester 安全组 CRUD', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '安全组', story: '创建' });
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const subnetName = await resolveFlatSubnetName(token, cloudId);
  const cleaned = await deleteSecurityGroupsByPrefix(token, cloudId, prefix);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
    });
    await step(page, '打开安全组页', async () => {
      await openSecurityGroupsPage(page, cloudId);
    });

    await step(page, '空表单提交校验', async () => {
      const emptyModal = await clickCreateSecurityGroup(page);
      await submitSecurityGroupCreateModal(emptyModal);
      await page.getByText('请输入名称').first().waitFor({ timeout: 10000 });
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('empty submit should not trigger Uncaught runtime errors overlay');
      }
      await closeAntModal(emptyModal);
    });

    await step(page, '创建安全组', async () => {
      const createModal = await clickCreateSecurityGroup(page);
      await fillSecurityGroupCreateForm(createModal, {
        name: sgName,
        description: 'tower browser e2e',
        subnetName,
      });
      await submitSecurityGroupCreateModal(createModal);
      await page.getByText('安全组已创建').first().waitFor({ timeout: 60000 });
    });

    await step(page, '搜索新建安全组', async () => {
      const row = await searchSecurityGroupRow(page, sgName);
      const rowText = await row.innerText();
      if (!rowText.includes(sgName)) {
        throw new Error(`expected row to contain ${sgName}`);
      }
    });
  });

  const list1 = await fetchSecurityGroups(token, cloudId);
  const created = findSecurityGroupByName(list1, sgName);
  if (!created?.id) throw new Error(`API list missing security group ${sgName}`);
  await deleteSecurityGroup(token, cloudId, created.id);

  console.log(
    JSON.stringify({ ok: true, cloudId, sgName, subnetName, cleaned }, null, 2),
  );
});
