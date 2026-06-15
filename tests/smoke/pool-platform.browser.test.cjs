/**
 * Smoke: ch02 platform entry — login page + resource pool list (no wizard writes).
 * Subset of manual/capture-ch02-pool.browser.cjs.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { openAdminPage } = require('../lib/pool-nav.cjs');
const { hasRuntimeErrorOverlay } = require('../harvester/failure-domains/lib/failure-domains-page.cjs');
const { DEFAULT_SMOKE_DELAY_MS } = require('../lib/smoke-pool-tab.cjs');

test('平台入口与资源池列表只读冒烟', async () => {
  await applyAllureMeta({
    epic: '平台',
    feature: '资源池',
    story: '登录与池列表',
    description: '对齐用户手册 ch02 主路径；不打开向导、不提交表单。',
  });

  await runWithBrowser(async (page) => {
    await step(page, '登录页可打开', async () => {
      await page.goto(`${webBase}/admin/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForSelector('#admin-login_username', { timeout: 60000 });
      await page.waitForTimeout(DEFAULT_SMOKE_DELAY_MS);
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('Uncaught runtime errors overlay on login page');
      }
    });

    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    await step(page, '资源池列表页', async () => {
      await openAdminPage(page, 'clouds', { delay: DEFAULT_SMOKE_DELAY_MS });
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('Uncaught runtime errors overlay on clouds list');
      }
    });

    await step(page, '顶栏全局搜索可打开', async () => {
      await page.keyboard.press('Control+k');
      await page.getByPlaceholder(/搜索页面/).waitFor({ state: 'visible', timeout: 15000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('Uncaught runtime errors overlay after global search');
      }
    });

    console.log(JSON.stringify({ ok: true }, null, 2));
  });
});
