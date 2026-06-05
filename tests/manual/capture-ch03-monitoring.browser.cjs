/**
 * Manual ch03 section 3.14: monitoring and alerts main paths.
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');

const SUBDIR = 'ch03-monitoring';

function pageRoot(page) {
  return page.locator('.cloudmap-monitoring-page-root').first();
}

async function openPoolPage(page, cloudId, pathSuffix, waitText) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/${pathSuffix}`, {
    waitUntil: 'domcontentloaded',
  });
  if (waitText) {
    await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 60000 });
  } else {
    await pageRoot(page).waitFor({ timeout: 60000 }).catch(() => {});
  }
  await page.waitForTimeout(2000);
}

async function clickDashboardView(page, label) {
  const tag = page.locator('.ant-tag-checkable').filter({ hasText: label }).first();
  await tag.waitFor({ timeout: 15000 });
  await tag.click();
  await page.waitForTimeout(1500);
}

async function openOpsAlertDropdown(page, menuLabel, itemLabel, menuShotName) {
  const trigger = page.locator('.ant-tag-checkable').filter({ hasText: menuLabel }).first();
  await trigger.click();
  const item = page.locator('.ant-dropdown-menu-item').filter({ hasText: itemLabel }).first();
  await item.waitFor({ state: 'visible', timeout: 8000 });
  if (menuShotName) {
    await shot(page, menuShotName, {
      subdir: SUBDIR,
      locator: page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').last(),
    });
  }
  await item.click();
  await page.waitForTimeout(2000);
}

async function main() {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, envCloudId || process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ slowMo: 60 });
  const { page } = await newMaximizedPage(browser);

  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await page.waitForTimeout(1200);

    await openPoolPage(page, cloudId, 'monitoring_alerts/alerts-list', '\u96c6\u7fa4\u6982\u89c8');
    const root = pageRoot(page);
    await shot(page, 'ops-dashboard-cluster-tab.png', { subdir: SUBDIR, locator: root });
    await clickDashboardView(page, '\u8282\u70b9\u6982\u89c8');
    await shot(page, 'ops-dashboard-nodes-tab.png', { subdir: SUBDIR, locator: root });

    await openPoolPage(page, cloudId, 'monitoring_alerts/ops-alert-dashboard', '\u544a\u8b66\u4e2d\u5fc3\u6982\u89c8');
    await shot(page, 'ops-alert-overview.png', { subdir: SUBDIR, locator: root });

    await openOpsAlertDropdown(
      page,
      '\u544a\u8b66\u7ba1\u7406',
      '\u544a\u8b66\u89c4\u5219',
      'ops-alert-rules-menu.png',
    );
    await shot(page, 'ops-alert-rules-page.png', { subdir: SUBDIR, locator: root });

    await openOpsAlertDropdown(
      page,
      '\u901a\u77e5\u7ba1\u7406',
      '\u901a\u77e5\u7b56\u7565',
      'ops-notification-policy-menu.png',
    );
    await shot(page, 'ops-notification-policy-page.png', { subdir: SUBDIR, locator: root });

    await openPoolPage(page, cloudId, 'monitoring_alerts/access-management', 'Prometheus');
    await shot(page, 'access-management-page.png', { subdir: SUBDIR });
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});