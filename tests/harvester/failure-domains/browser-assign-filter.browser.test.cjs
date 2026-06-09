/**
 * 分配节点下拉应排除已归属其他故障域的节点（仅展示未分配 + 当前域节点）。
 * 需要至少 2 个可分配节点；否则跳过。
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  fetchFailureDomainOverview,
  createFailureDomain,
  setFailureDomainNodes,
  deleteFailureDomain,
  deleteDomainsByPrefix,
} = require('./lib/failure-domains-api.cjs');
const {
  openFailureDomainsPage,
  searchFailureDomainRow,
  openAssignNodesModal,
  closeAntModal,
} = require('./lib/failure-domains-page.cjs');

const prefix = process.env.TOWER_FD_NAME_PREFIX || 'tower-e2e-fd-filter';
const domainA = `${prefix}-a-${Date.now()}`;
const domainB = `${prefix}-b-${Date.now()}`;

test('Harvester 故障域分配节点筛选', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '故障域', story: '分配下拉过滤' });
  const token = await towerLogin();
    const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
    await deleteDomainsByPrefix(token, cloudId, prefix);

    const overview = await fetchFailureDomainOverview(token, cloudId, true);
    const unassigned = Array.isArray(overview?.unassignedNodeNames) ? overview.unassignedNodeNames : [];
    if (unassigned.length < 1) {
      test.skip(true, 'no unassigned nodes');
      return;
    }
    const nodeA = unassigned[0];
    const nodeB = unassigned[1] || null;

    const resA = await createFailureDomain(token, cloudId, { name: domainA, domainType: 'rack' });
    if (resA.status !== 200) throw new Error(resA.message || 'create domain A failed');
    const idA = resA.data?.id;

    const assignA = await setFailureDomainNodes(token, cloudId, idA, [nodeA]);
    if (assignA.status !== 200) throw new Error(assignA.message || 'assign node to A failed');

    const resB = await createFailureDomain(token, cloudId, { name: domainB, domainType: 'zone' });
    if (resB.status !== 200) throw new Error(resB.message || 'create domain B failed');

    await runWithBrowser(async (page) => {
      await step(page, '管理员登录', async () => {
        await adminLoginPage(page, webBase, adminUser, adminPassword);
      });
      await step(page, '打开故障域页', async () => {
        await openFailureDomainsPage(page, cloudId);
      });

      await step(page, '校验分配下拉过滤已占用节点', async () => {
        const rowB = await searchFailureDomainRow(page, domainB);
        const assignModal = await openAssignNodesModal(page, rowB);
        await assignModal.locator('.ant-select').first().click();
        await page.waitForTimeout(500);

        const optionA = page.locator('.ant-select-item-option').filter({ hasText: nodeA });
        if (await optionA.count()) {
          throw new Error(`node ${nodeA} should not appear in domain B assign dropdown`);
        }

        if (nodeB) {
          const optionB = page.locator('.ant-select-item-option').filter({ hasText: nodeB });
          if (!(await optionB.count())) {
            throw new Error(`unassigned node ${nodeB} should appear in domain B assign dropdown`);
          }
        }

        await closeAntModal(assignModal);
      });
    });

    await deleteFailureDomain(token, cloudId, resB.data?.id);
    await deleteFailureDomain(token, cloudId, idA);

    console.log(
      JSON.stringify({ ok: true, cloudId, domainA, domainB, nodeA, nodeB, filterVerified: true }, null, 2),
    );
});
