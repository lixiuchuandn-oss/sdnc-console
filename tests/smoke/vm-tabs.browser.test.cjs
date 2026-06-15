/**
 * Smoke: ch03 §3.2 compute / VM tabs — read-only navigation.
 * Routes from pool nav (compute/*) + manual/capture-ch03-vm-create.browser.cjs (ecs list).
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

/** @type {{ id: string; pathSuffix: string; openOpts?: Record<string, unknown> }[]} */
const VM_TAB_ROUTES = [
  { id: 'ecs', pathSuffix: 'compute/ecs', openOpts: { waitButton: '创建向导' } },
  { id: 'images', pathSuffix: 'compute/images', openOpts: { waitButton: '新增镜像' } },
  { id: 'templates', pathSuffix: 'compute/templates' },
  { id: 'recycle_bin', pathSuffix: 'compute/recycle_bin' },
  { id: 'ssh_keys', pathSuffix: 'compute/ssh_keys' },
  { id: 'cloud_inits', pathSuffix: 'compute/cloud_inits' },
  { id: 'migrations', pathSuffix: 'compute/migrations' },
];

test('Cloudmap 云主机 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '云主机',
    story: '侧栏 Tab 遍历',
    description: '对齐用户手册 ch03 §3.2；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of VM_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: VM_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
