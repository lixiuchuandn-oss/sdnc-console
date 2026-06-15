/**
 * Smoke/E2E: ch02 header edge pool wizard — connection test only, no save.
 * Requires TOWER_CLOUDMAP_ENDPOINT and TOWER_CLOUDMAP_TOKEN in tests/.env.
 */
const { test } = require('@playwright/test');
const {
  webBase,
  adminUser,
  adminPassword,
  cloudmapEndpoint,
  cloudmapToken,
} = require('../shared/load-env.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { openHeaderEdgeWizard, fillEdgePoolForm } = require('../lib/pool-edge-wizard.cjs');
const { hasRuntimeErrorOverlay } = require('../harvester/failure-domains/lib/failure-domains-page.cjs');

const endpoint = String(cloudmapEndpoint || process.env.TOWER_CLOUDMAP_ENDPOINT || '').trim();
const apiToken = String(cloudmapToken || process.env.TOWER_CLOUDMAP_TOKEN || '').trim();

test('顶栏边缘云向导连接测试（不写库）', async () => {
  test.skip(!endpoint || !apiToken, '需要 TOWER_CLOUDMAP_ENDPOINT 与 TOWER_CLOUDMAP_TOKEN');

  await applyAllureMeta({
    epic: '平台',
    feature: '资源池',
    story: '边缘云接入向导测连',
    description: '对齐 ch02 顶栏向导；仅连接测试，不提交保存。',
  });

  const probeName = `tower-smoke-edge-${Date.now()}`;

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(1200);
    });

    let modal;
    await step(page, '打开顶栏边缘云向导', async () => {
      modal = await openHeaderEdgeWizard(page);
      await fillEdgePoolForm(modal, { name: probeName, endpoint, token: apiToken });
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('Uncaught runtime errors overlay in edge wizard');
      }
    });

    await step(page, '连接测试成功', async () => {
      await modal.getByRole('button', { name: '连接测试' }).click();
      await modal.getByText('连接成功').waitFor({ timeout: 90000 });
    });

    await step(page, '关闭向导', async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    });

    console.log(JSON.stringify({ endpoint, probeName, ok: true }, null, 2));
  });
});
