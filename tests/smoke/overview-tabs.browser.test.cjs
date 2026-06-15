/**
 * Smoke: ch03 §4 resource hub — read-only navigation.
 * Aligned with manual/capture-ch03-overview.browser.cjs.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

const OVERVIEW_TAB_ROUTES = [
  { id: 'overview', pathSuffix: 'resource_hub/overview' },
  { id: 'datacenter_topology', pathSuffix: 'resource_hub/datacenter_topology', openOpts: { delay: 3000 } },
  { id: 'network_topology', pathSuffix: 'resource_hub/network_topology', openOpts: { delay: 3000 } },
];

test('Cloudmap 资源总览 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '资源总览',
    story: '概览与拓扑',
    description: '对齐用户手册 ch03 §4；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of OVERVIEW_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: OVERVIEW_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
