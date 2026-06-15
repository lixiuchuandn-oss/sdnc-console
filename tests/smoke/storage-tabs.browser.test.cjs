/**
 * Smoke: ch03 §3.3 volumes + snapshots — read-only navigation.
 * Aligned with manual/capture-ch03-volumes.browser.cjs list paths.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

const STORAGE_TAB_ROUTES = [
  { id: 'volumes', pathSuffix: 'storage/volumes' },
  { id: 'snapshots', pathSuffix: 'storage/snapshots', openOpts: { delay: 2000 } },
];

test('Cloudmap 块存储 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '块存储',
    story: '云盘与快照列表',
    description: '对齐用户手册 ch03 §3.3；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of STORAGE_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: STORAGE_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
