/**
 * Manual ch03 section 3.9: VM backup, snapshot, schedule, restore tasks.
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');

const SUBDIR = 'ch03-backups';

function modal(page, titlePattern) {
  return page.locator('.ant-modal').filter({ hasText: titlePattern }).last();
}

async function openPage(page, cloudId, pathSuffix, waitButtonName) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/${pathSuffix}`, {
    waitUntil: 'domcontentloaded',
  });
  if (waitButtonName) {
    await page.getByRole('button', { name: waitButtonName }).waitFor({ timeout: 60000 });
  }
  await page.waitForTimeout(1500);
}

async function clickRowMenu(page, menuLabel, { requireEnabled = true } = {}) {
  const rows = page.locator('tr.ant-table-row');
  const count = await rows.count();
  for (let i = 0; i < Math.min(count, 30); i++) {
    const row = rows.nth(i);
    await row.scrollIntoViewIfNeeded();
    const trigger = row.locator('.row-actions-trigger');
    if ((await trigger.count()) === 0) continue;
    await trigger.click();
    const item = page.locator('.ant-dropdown-menu-item').filter({ hasText: menuLabel }).first();
    try {
      await item.waitFor({ state: 'visible', timeout: 3000 });
    } catch {
      await page.keyboard.press('Escape');
      continue;
    }
    if (requireEnabled) {
      const disabled = await item.evaluate((el) =>
        el.classList.contains('ant-dropdown-menu-item-disabled'),
      );
      if (disabled) {
        await page.keyboard.press('Escape');
        continue;
      }
    }
    await item.click();
    return row;
  }
  return null;
}

async function main() {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, envCloudId || process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ slowMo: 60 });
  const { page } = await newMaximizedPage(browser);

  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await page.waitForTimeout(1200);

    // --- VM backups ---
    await openPage(page, cloudId, 'backups/backups', '\u521b\u5efa\u5907\u4efd');
    const backupToolbar = page.locator('.toolbar-actions, .shared-toolbar').first();
    await backupToolbar.waitFor({ timeout: 15000 });
    await shot(page, 'vm-backup-list-toolbar.png', { subdir: SUBDIR, locator: backupToolbar });
    await shot(page, 'vm-backup-list-page.png', { subdir: SUBDIR });

    await page.getByRole('button', { name: '\u521b\u5efa\u5907\u4efd' }).click();
    let createModal = modal(page, '\u521b\u5efa\u865a\u62df\u673a\u5907\u4efd');
    await createModal.waitFor({ timeout: 20000 });
    await createModal.getByLabel('\u663e\u793a\u540d\u79f0\uff08\u522b\u540d\uff09').fill('manual-doc-backup');
    await page.waitForTimeout(400);
    await shot(page, 'vm-backup-create-modal.png', { subdir: SUBDIR, locator: createModal });
    await page.keyboard.press('Escape');
    await createModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const restoreRow = await clickRowMenu(page, '\u6062\u590d');
    if (restoreRow) {
      const restoreModal = modal(page, '\u6062\u590d\u865a\u62df\u673a');
      await restoreModal.waitFor({ timeout: 20000 });
      await page.waitForTimeout(500);
      await shot(page, 'vm-backup-restore-modal.png', { subdir: SUBDIR, locator: restoreModal });
      await page.keyboard.press('Escape');
    } else {
      console.log('skip vm-backup-restore-modal: no restorable backup row');
    }

    // --- VM snapshots (backup type) ---
    await openPage(page, cloudId, 'backups/vm_snapshots', '\u521b\u5efa\u5feb\u7167');
    await shot(page, 'vm-snapshot-list-page.png', { subdir: SUBDIR });

    await page.getByRole('button', { name: '\u521b\u5efa\u5feb\u7167' }).click();
    createModal = modal(page, '\u521b\u5efa\u865a\u62df\u673a\u5feb\u7167');
    await createModal.waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    await shot(page, 'vm-snapshot-create-modal.png', { subdir: SUBDIR, locator: createModal });
    await page.keyboard.press('Escape');

    // --- Schedule policies ---
    await openPage(page, cloudId, 'backups/schedule_vm_backups', '\u521b\u5efa\u5b9a\u65f6\u7b56\u7565');
    const schedToolbar = page.locator('.toolbar-actions, .shared-toolbar').first();
    await schedToolbar.waitFor({ timeout: 15000 });
    await shot(page, 'schedule-backup-list-toolbar.png', { subdir: SUBDIR, locator: schedToolbar });
    await shot(page, 'schedule-backup-list-page.png', { subdir: SUBDIR });

    await page.getByRole('button', { name: '\u521b\u5efa\u5b9a\u65f6\u7b56\u7565' }).click();
    const schedModal = modal(page, '\u521b\u5efa\u5b9a\u65f6\u7b56\u7565');
    await schedModal.waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await shot(page, 'schedule-backup-create-modal.png', { subdir: SUBDIR, locator: schedModal });
    await page.keyboard.press('Escape');

    // --- Restore tasks ---
    await openPage(page, cloudId, 'backups/vm_restores', null);
    await page.locator('tr.ant-table-row, .ant-empty').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, 'restore-tasks-list-page.png', { subdir: SUBDIR });
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});