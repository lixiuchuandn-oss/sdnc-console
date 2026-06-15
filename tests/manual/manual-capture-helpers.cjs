/**
 * Shared helpers for user-manual Playwright capture scripts.
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');
const { poolUrl, openPoolPage, openAdminPage } = require('../lib/pool-nav.cjs');

function modal(page, titlePattern) {
  return page.locator('.ant-modal').filter({ hasText: titlePattern }).last();
}

function drawer(page) {
  return page.locator('.ant-drawer').last();
}

async function clickAntTab(page, label) {
  const tab = page.locator('.ant-tabs-tab').filter({ hasText: label }).first();
  await tab.waitFor({ timeout: 15000 });
  await tab.click();
  await page.waitForTimeout(1200);
}

async function clickTableRowMenu(page, menuLabel, opts = {}) {
  const rows = page.locator('tr.ant-table-row');
  const count = await rows.count();
  for (let i = 0; i < Math.min(count, opts.maxRows ?? 30); i++) {
    const row = rows.nth(i);
    await row.scrollIntoViewIfNeeded();
    const trigger = row.locator('.row-actions-trigger, button.ant-dropdown-trigger').first();
    if ((await trigger.count()) === 0) continue;
    await trigger.click();
    const item = page.getByRole('menuitem', { name: menuLabel });
    try {
      await item.waitFor({ state: 'visible', timeout: 3000 });
    } catch {
      await page.keyboard.press('Escape');
      continue;
    }
    if (opts.requireEnabled !== false) {
      const disabled = await item.evaluate((el) =>
        el.classList.contains('ant-dropdown-menu-item-disabled'),
      );
      if (disabled) {
        await page.keyboard.press('Escape');
        continue;
      }
    }
    await item.click();
    return true;
  }
  return false;
}

async function runManualCapture(mainFn) {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, envCloudId || process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ slowMo: 60 });
  const { page } = await newMaximizedPage(browser);
  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await page.waitForTimeout(1200);
    await mainFn(page, cloudId);
  } finally {
    await browser.close();
  }
}

async function waitForAntModalSettled(page, modal, opts = {}) {
  const delayMs = opts.delayMs ?? 1500;
  await modal.waitFor({ state: 'visible', timeout: opts.timeout ?? 15000 });
  await page
    .waitForFunction(
      () => {
        const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap'));
        const active = wraps.find((w) => {
          const st = window.getComputedStyle(w);
          return st.display !== 'none' && st.visibility !== 'hidden';
        });
        if (!active) return false;
        const modalEl = active.querySelector('.ant-modal');
        if (!modalEl) return false;
        const opacity = Number.parseFloat(window.getComputedStyle(modalEl).opacity || '0');
        return opacity > 0.95;
      },
      { timeout: 10000 },
    )
    .catch(() => {});
  await page.waitForTimeout(delayMs);
}

module.exports = {
  webBase,
  shot,
  poolUrl,
  openPoolPage,
  openAdminPage,
  modal,
  drawer,
  clickAntTab,
  clickTableRowMenu,
  runManualCapture,
  waitForAntModalSettled,
};
