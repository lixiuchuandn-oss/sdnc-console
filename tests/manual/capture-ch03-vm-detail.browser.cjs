/**
 * Manual ch03 section 3.2.12: VM instance detail drawer and reconfigure sub-drawers.
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');

const SUBDIR = 'ch03-vm-detail';

function mainDrawer(page) {
  return page.locator('.ant-drawer').first();
}

function nestedDrawer(page) {
  return page.locator('.ant-drawer').last();
}

async function openFirstVmDetail(page, cloudId) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/compute/ecs`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('tr.ant-table-row').first().waitFor({ timeout: 60000 });
  await page.locator('tr.ant-table-row').first().locator('.cell-link').click();
  const drawer = mainDrawer(page);
  await drawer.waitFor({ timeout: 20000 });
  await drawer.locator('.ant-segmented').getByText('\u8be6\u60c5').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  return drawer;
}

async function switchTab(page, drawer, label) {
  await drawer.locator('.ant-segmented-item-label').filter({ hasText: label }).click();
  await page.waitForTimeout(800);
}

async function openResourceMenu(page, drawer, itemLabel) {
  await drawer.getByRole('button', { name: '\u8d44\u6e90\u914d\u7f6e' }).click();
  const item = page.locator('.ant-dropdown-menu-item').filter({ hasText: itemLabel }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
}

async function closeNestedDrawer(page, drawer) {
  const footerBtn = drawer
    .locator('.ant-drawer-footer button, .ant-drawer-body button')
    .filter({ hasText: /^(\u5173\u95ed|\u53d6\u6d88)$/ })
    .first();
  if ((await footerBtn.count()) > 0) {
    await footerBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(500);
}

async function main() {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, envCloudId || process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ slowMo: 60 });
  const { page } = await newMaximizedPage(browser);

  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await page.waitForTimeout(1200);

    let drawer = await openFirstVmDetail(page, cloudId);
    await shot(page, 'vm-detail-drawer-detail-tab.png', { subdir: SUBDIR, locator: drawer });

    await switchTab(page, drawer, '\u6027\u80fd');
    await shot(page, 'vm-detail-tab-performance.png', { subdir: SUBDIR, locator: drawer });

    await switchTab(page, drawer, '\u5907\u4efd/\u5feb\u7167');
    await shot(page, 'vm-detail-tab-backup.png', { subdir: SUBDIR, locator: drawer });

    await switchTab(page, drawer, '\u8be6\u60c5');
    const moreBtn = drawer.locator('button').filter({ has: page.locator('.anticon-ellipsis') });
    await moreBtn.click();
    const menu = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu').last();
    await menu.waitFor({ state: 'visible', timeout: 5000 });
    await shot(page, 'vm-detail-more-menu.png', { subdir: SUBDIR, locator: menu });

    await page.locator('.ant-dropdown-menu-submenu-title').filter({ hasText: '\u8c03\u5ea6\u7b56\u7565' }).hover();
    await page.waitForTimeout(400);
    await page.locator('.ant-dropdown-menu-item').filter({ hasText: '\u8282\u70b9\u9009\u62e9\u5668' }).click();
    const schedDrawer = nestedDrawer(page);
    await schedDrawer.waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await shot(page, 'vm-detail-node-scheduling.png', { subdir: SUBDIR, locator: schedDrawer });
    await closeNestedDrawer(page, schedDrawer);

    if (!(await mainDrawer(page).isVisible())) {
      drawer = await openFirstVmDetail(page, cloudId);
    } else {
      drawer = mainDrawer(page);
    }

    await openResourceMenu(page, drawer, '\u78c1\u76d8\u7ba1\u7406');
    const diskDrawer = nestedDrawer(page);
    await diskDrawer.waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await shot(page, 'vm-detail-disk-manage.png', { subdir: SUBDIR, locator: diskDrawer });
    await closeNestedDrawer(page, diskDrawer);

    if (!(await mainDrawer(page).isVisible())) {
      drawer = await openFirstVmDetail(page, cloudId);
    } else {
      drawer = mainDrawer(page);
    }

    await openResourceMenu(page, drawer, '\u8c03\u6574\u89c4\u683c');
    const specDrawer = nestedDrawer(page);
    await specDrawer.waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await shot(page, 'vm-detail-spec-config.png', { subdir: SUBDIR, locator: specDrawer });
    await closeNestedDrawer(page, specDrawer);

    if (!(await mainDrawer(page).isVisible())) {
      drawer = await openFirstVmDetail(page, cloudId);
    } else {
      drawer = mainDrawer(page);
    }

    await switchTab(page, drawer, '\u8be6\u60c5');
    const moreBtn2 = drawer.locator('button').filter({ has: page.locator('.anticon-ellipsis') });
    await moreBtn2.click();
    const cloneItem = page.locator('.ant-dropdown-menu-item').filter({ hasText: '\u514b\u9686' }).first();
    if (await cloneItem.isVisible().catch(() => false)) {
      await cloneItem.click();
      const cloneModal = page.locator('.ant-modal').filter({ hasText: '\u514b\u9686\u865a\u62df\u673a' }).last();
      await cloneModal.waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (await cloneModal.isVisible().catch(() => false)) {
        await shot(page, 'vm-detail-clone-modal.png', { subdir: SUBDIR, locator: cloneModal });
        await page.keyboard.press('Escape');
      }
    } else {
      await page.keyboard.press('Escape');
    }

    if (!(await mainDrawer(page).isVisible())) {
      drawer = await openFirstVmDetail(page, cloudId);
    } else {
      drawer = mainDrawer(page);
    }
    await switchTab(page, drawer, '\u8be6\u60c5');
    const moreBtn3 = drawer.locator('button').filter({ has: page.locator('.anticon-ellipsis') });
    await moreBtn3.click();
    const migrateItem = page.locator('.ant-dropdown-menu-item').filter({ hasText: '\u70ed\u8fc1\u79fb' }).first();
    if (await migrateItem.isVisible().catch(() => false)) {
      const disabled = await migrateItem.evaluate((el) =>
        el.classList.contains('ant-dropdown-menu-item-disabled'),
      );
      if (!disabled) {
        await migrateItem.click();
        const migrateModal = page.locator('.ant-modal').filter({ hasText: '\u70ed\u8fc1\u79fb' }).last();
        await migrateModal.waitFor({ timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(600);
        if (await migrateModal.isVisible().catch(() => false)) {
          await shot(page, 'vm-detail-migrate-modal.png', { subdir: SUBDIR, locator: migrateModal });
          await page.keyboard.press('Escape');
        }
      } else {
        await page.keyboard.press('Escape');
      }
    } else {
      await page.keyboard.press('Escape');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
