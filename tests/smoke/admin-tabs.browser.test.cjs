/**
 * Smoke: platform admin pages — settings + tenants (capture-ch03-misc).
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokeAdminTab } = require('../lib/smoke-admin-tab.cjs');

const ADMIN_TAB_ROUTES = [
  { id: 'settings/roles', pathSuffix: 'access/roles', openOpts: { waitText: '角色' } },
  { id: 'settings/users', pathSuffix: 'access/users' },
  { id: 'tenants/list', pathSuffix: 'tenants', openOpts: { waitText: '租户' } },
  { id: 'tenants/org_users', pathSuffix: 'tenants/users', openOpts: { waitText: '组织' } },
];

test('平台管理页只读冒烟', async () => {
  await applyAllureMeta({
    epic: '平台',
    feature: '系统设置与租户',
    story: '管理页遍历',
    description: '对齐 ch04 设置 / ch05 租户 capture；不写库、不截图。',
  });

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of ADMIN_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokeAdminTab(page, route);
      });
    }

    console.log(JSON.stringify({ tabs: ADMIN_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
