const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { adminLoginPage, resolvePlaywrightHeadless } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');

test('管理员浏览器登录', async () => {
  await applyAllureMeta({ epic: '认证', feature: '管理员登录' });
    const headless = resolvePlaywrightHeadless();
    await runWithBrowser(async (page) => {
      await step(page, '打开登录页并提交', async () => {
        await adminLoginPage(page, webBase, adminUser, adminPassword);
      });
      const token = await page.evaluate(() => localStorage.getItem('token'));
      console.log(JSON.stringify({ ok: !!token, url: page.url() }, null, 2));
      if (!token) throw new Error('login failed: no token in localStorage');
      if (!headless) await page.waitForTimeout(5000);
    });
});
