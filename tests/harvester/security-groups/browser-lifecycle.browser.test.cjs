const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  fetchSecurityGroups,
  createSecurityGroup,
  replaceSecurityGroupRules,
  deleteSecurityGroupsByPrefix,
  findSecurityGroupByName,
  resolveFlatSubnetName,
} = require('./lib/security-groups-api.cjs');
const {
  openSecurityGroupsPage,
  searchSecurityGroupRow,
  openSecurityGroupYamlDrawer,
  waitYamlDrawerContains,
  closeYamlDrawer,
  openSecurityGroupEditModal,
  submitSecurityGroupEditModal,
  openSecurityGroupRulesDrawer,
  addInboundRuleInAccessDrawer,
  saveAccessControlDrawer,
  tryJoinFirstAvailableMember,
  closeAccessControlDrawer,
  deleteSecurityGroupFromRow,
} = require('./lib/security-groups-page.cjs');

const prefix = process.env.TOWER_SG_NAME_PREFIX || 'tower-e2e-sg';
const sgName = process.env.TOWER_SG_GROUP_NAME || `${prefix}-lifecycle-${Date.now()}`;

test('Harvester 安全组 编辑/访问控制/YAML/删除', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '安全组', story: '访问控制与删除' });
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const subnetName = await resolveFlatSubnetName(token, cloudId);
  const cleaned = await deleteSecurityGroupsByPrefix(token, cloudId, prefix);

  const created = await createSecurityGroup(token, cloudId, {
    name: sgName,
    subnetName,
    description: 'tower browser lifecycle seed',
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(created.message || `seed create HTTP ${created.status}`);
  }

  const listSeed = await fetchSecurityGroups(token, cloudId);
  const seeded = findSecurityGroupByName(listSeed, sgName);
  if (!seeded?.id) throw new Error(`seed list missing security group ${sgName}`);
  const rulesRes = await replaceSecurityGroupRules(token, cloudId, seeded.id, [
    {
      priority: 100,
      direction: 'from-lport',
      action: 'allow',
      match: 'ip4 && tcp && ip4.src == 0.0.0.0/0',
    },
  ]);
  if (rulesRes.status !== 200) {
    throw new Error(rulesRes.message || `seed rules HTTP ${rulesRes.status}`);
  }

  let memberJoined = false;

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
    });
    await step(page, '打开安全组页', async () => {
      await openSecurityGroupsPage(page, cloudId);
    });

    const row = await step(page, '搜索安全组', async () => searchSecurityGroupRow(page, sgName));

    await step(page, '查看 YAML', async () => {
      await openSecurityGroupYamlDrawer(page, row);
      await waitYamlDrawerContains(page, ['hms.rivercloud.com/v1', 'SecurityGroup']);
      await closeYamlDrawer(page);
    });

    await step(page, '编辑安全组', async () => {
      const editModal = await openSecurityGroupEditModal(page, row);
      await editModal.getByLabel('描述').fill('tower browser lifecycle updated');
      await submitSecurityGroupEditModal(editModal);
      await page.getByText('安全组已更新').first().waitFor({ timeout: 60000 });
    });

    await step(page, '访问控制：查看规则并保存', async () => {
      const row2 = await searchSecurityGroupRow(page, sgName);
      await openSecurityGroupRulesDrawer(page, row2);
      await page.locator('.ant-segmented-item').filter({ hasText: /入方向\s*\(1\)/ }).waitFor({
        timeout: 60000,
      });
      await addInboundRuleInAccessDrawer(page);
      await saveAccessControlDrawer(page);
      await page.getByText('访问控制已保存').first().waitFor({ timeout: 120000 });
    });

    await step(page, '访问控制：尝试关联云主机', async () => {
      memberJoined = await tryJoinFirstAvailableMember(page);
      if (memberJoined) {
        await saveAccessControlDrawer(page);
        await page.getByText('访问控制已保存').first().waitFor({ timeout: 120000 });
      }
      await closeAccessControlDrawer(page);
    });

    await step(page, 'UI 删除安全组', async () => {
      const row3 = await searchSecurityGroupRow(page, sgName);
      await deleteSecurityGroupFromRow(page, row3, sgName);
      await page.getByText('已删除').first().waitFor({ timeout: 60000 });
    });
  });

  const list = await fetchSecurityGroups(token, cloudId);
  const stillThere = findSecurityGroupByName(list, sgName);
  if (stillThere?.id) {
    throw new Error(`security group ${sgName} still exists after UI delete`);
  }

  console.log(
    JSON.stringify(
      { ok: true, cloudId, sgName, subnetName, memberJoined, cleaned },
      null,
      2,
    ),
  );
});
