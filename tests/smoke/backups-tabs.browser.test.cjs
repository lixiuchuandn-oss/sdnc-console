/**
 * Smoke: ch03 §3.9 VM backup paths — read-only navigation.
 * Aligned with manual/capture-ch03-backups.browser.cjs.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

const BACKUPS_TAB_ROUTES = [
  { id: 'vm_backups', pathSuffix: 'backups/backups' },
  { id: 'vm_snapshots', pathSuffix: 'backups/vm_snapshots' },
  { id: 'schedule_vm_backups', pathSuffix: 'backups/schedule_vm_backups' },
  { id: 'vm_restores', pathSuffix: 'backups/vm_restores' },
];

test('Cloudmap 备份与恢复 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '备份与恢复',
    story: '备份/快照/计划/恢复任务列表',
    description: '对齐用户手册 ch03 §3.9；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of BACKUPS_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: BACKUPS_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
