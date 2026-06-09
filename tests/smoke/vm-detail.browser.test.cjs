/**
 * Smoke: open first VM detail drawer and switch main tabs (read-only).
 * Aligned with manual/capture-ch03-vm-detail.browser.cjs entry path.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { poolUrl } = require('../lib/pool-nav.cjs');
const { hasRuntimeErrorOverlay } = require('../harvester/failure-domains/lib/failure-domains-page.cjs');
const { DEFAULT_SMOKE_DELAY_MS } = require('../lib/smoke-pool-tab.cjs');

const DETAIL_TABS = ['详情', '性能', '备份/快照'];

test('云主机详情抽屉只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '云主机',
    story: '详情抽屉',
    description: '打开首台 VM 详情并切换 Segmented Tab；不写库。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    await step(page, '打开首台 VM 详情', async () => {
      await page.goto(poolUrl(cloudId, 'compute/ecs'), { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: '创建向导' }).waitFor({ timeout: 60000 });
      const vmLink = page.locator('tr.ant-table-row .cell-link').first();
      try {
        await vmLink.waitFor({ timeout: 60000 });
      } catch {
        console.log(
          JSON.stringify({ cloudId, skipped: true, reason: 'no_vm_rows_in_pool' }, null, 2),
        );
        return;
      }
      await vmLink.click();
      const drawer = page.locator('.ant-drawer').first();
      await drawer.waitFor({ timeout: 20000 });
      await drawer.locator('.ant-segmented').getByText('详情').waitFor({ timeout: 15000 });
      await page.waitForTimeout(DEFAULT_SMOKE_DELAY_MS);
      if (await hasRuntimeErrorOverlay(page)) {
        throw new Error('Uncaught runtime errors overlay in VM detail drawer');
      }
    });

    const drawerOpen = await page.locator('.ant-drawer').first().isVisible().catch(() => false);
    if (!drawerOpen) {
      return;
    }

    for (const label of DETAIL_TABS) {
      await step(page, `详情 Tab：${label}`, async () => {
        const drawer = page.locator('.ant-drawer').first();
        await drawer.locator('.ant-segmented-item-label').filter({ hasText: label }).click();
        await page.waitForTimeout(DEFAULT_SMOKE_DELAY_MS);
        if (await hasRuntimeErrorOverlay(page)) {
          throw new Error(`Uncaught runtime errors overlay on VM detail tab: ${label}`);
        }
      });
    }

    await step(page, '关闭详情抽屉', async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    });

    console.log(JSON.stringify({ cloudId, detailTabs: DETAIL_TABS.length, ok: true }, null, 2));
  });
});
