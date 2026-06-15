/**
 * Smoke: ch03 §10 container services — read-only list pages.
 * Aligned with manual/capture-ch03-containers.browser.cjs LIST_PAGES.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

const CONTAINERS_TAB_ROUTES = [
  { id: 'workloads', pathSuffix: 'containers/workloads' },
  { id: 'pods', pathSuffix: 'containers/pods' },
  { id: 'jobs', pathSuffix: 'containers/jobs' },
  { id: 'services', pathSuffix: 'containers/services' },
  { id: 'ingresses', pathSuffix: 'containers/ingresses' },
  { id: 'gateway_api', pathSuffix: 'containers/gateway_api' },
  { id: 'service_topology', pathSuffix: 'containers/service_topology', openOpts: { delay: 2500 } },
  { id: 'pdbs', pathSuffix: 'containers/pdbs' },
  { id: 'networkpolicies', pathSuffix: 'containers/networkpolicies' },
  { id: 'configs', pathSuffix: 'containers/configs' },
  { id: 'registries', pathSuffix: 'containers/registries' },
];

test('Cloudmap 容器服务 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '容器服务',
    story: '列表页遍历',
    description: '对齐用户手册 ch03 §10；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of CONTAINERS_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: CONTAINERS_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
