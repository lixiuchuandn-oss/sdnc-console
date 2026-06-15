/**
 * Smoke: misc pool paths — database, VNE, logging (capture-ch03-misc).
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

const MISC_TAB_ROUTES = [
  { id: 'database/rds', pathSuffix: 'paas_databases/rds' },
  { id: 'vne/virtual_routers', pathSuffix: 'oniaas_network/virtual_routers' },
  { id: 'vne/slb', pathSuffix: 'oniaas_network/slb' },
  { id: 'logging/logs_target', pathSuffix: 'logs_config/logs-target' },
  { id: 'logging/log_outputs', pathSuffix: 'logs_config/log-outputs' },
  { id: 'logging/logs_flow', pathSuffix: 'logs_config/logs-flow-config' },
];

test('Cloudmap 扩展能力 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '扩展能力',
    story: '云数据库 / VNE / 日志',
    description: '对齐 manual/capture-ch03-misc 池内路径；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of MISC_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: MISC_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
