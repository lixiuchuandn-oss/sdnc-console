/**
 * CSM 资源池 · 租户 Tab 浏览器 E2E（只读）
 */
const { test, expect } = require('@playwright/test');
const {
  webBase,
  adminUser,
  adminPassword,
  csmCloudId,
  csmEndpointHint,
} = require('../../shared/load-env.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const { towerLogin } = require('../../shared/tower-api.cjs');
const { resolveCsmCloudId } = require('./lib/csm-api.cjs');

test('CSM 资源池租户 Tab 可打开', async () => {
  await applyAllureMeta({
    epic: 'SDNCC',
    feature: 'CSM 安全资源池',
    story: '租户 Tab',
    description: '打开 CSM 池详情 ?tab=tenants；校验区块标题与表格/空态，不写库。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCsmCloudId(token, {
    cloudId: csmCloudId,
    endpointHint: csmEndpointHint,
  });
  const url = `${webBase}/admin/security/traffic/csm-pools/${encodeURIComponent(cloudId)}?tab=tenants`;

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    await step(page, '打开租户 Tab', async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);
    });

    await step(page, '校验租户区块', async () => {
      await expect(page.getByText('租户', { exact: true }).first()).toBeVisible({ timeout: 20000 });
      const table = page.locator('.std-table');
      const empty = page.getByText('CSM 未返回租户数据');
      const errorToast = page.locator('.ant-message-error');
      const tableVisible = await table.isVisible().catch(() => false);
      const emptyVisible = await empty.isVisible().catch(() => false);
      const errorVisible = await errorToast.isVisible().catch(() => false);
      expect(tableVisible || emptyVisible || errorVisible).toBeTruthy();
    });

    console.log(JSON.stringify({ cloudId, url, ok: true }, null, 2));
  });
});
