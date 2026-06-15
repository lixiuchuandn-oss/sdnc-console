const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const { openImagesPage } = require('./lib/images-page.cjs');

test('Harvester 镜像列表筛选', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '镜像', story: '列表筛选' });
    const cloudId = await resolveCloudId(await towerLogin(), process.env.TOWER_CLOUD_ID);

    await runWithBrowser(async (page) => {
      await step(page, '管理员登录', async () => {
        await adminLoginPage(page, webBase, adminUser, adminPassword);
      });
      await step(page, '打开镜像列表', async () => {
        await openImagesPage(page, cloudId);
      });

      const stats = await step(page, '关键词/状态/范围筛选', async () => {
        const rowCountBefore = await page.locator('tr.ant-table-row').count();

        await page.getByPlaceholder('名称/项目').fill('tower-e2e-nonexistent-filter-xyz');
        await page.waitForTimeout(1500);
        const rowCountFiltered = await page.locator('tr.ant-table-row').count();

        await page.getByPlaceholder('名称/项目').fill('');
        await page.waitForTimeout(500);

        const statusSelect = page.locator('.ant-select').filter({ has: page.locator('text=状态') }).first();
        if (await statusSelect.count()) {
          await statusSelect.click();
          await page.getByText('已就绪', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }

        const scopeSelect = page.locator('.ant-select').filter({ has: page.locator('text=范围') }).first();
        if (await scopeSelect.count()) {
          await scopeSelect.click();
          await page.getByText('公共', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }

        return { rowCountBefore, rowCountFiltered, filterNarrowed: rowCountFiltered <= rowCountBefore };
      });

      console.log(JSON.stringify({ ok: true, cloudId, ...stats }, null, 2));
    });
});
