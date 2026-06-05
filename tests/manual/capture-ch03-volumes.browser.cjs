/**
 * Manual ch03 section 3.3: virtual volumes + volume snapshots.
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');

const SUBDIR = 'ch03-volumes';

function modal(page, titlePattern) {
  return page.locator('.ant-modal').filter({ hasText: titlePattern }).last();
}

async function openVolumesList(page, cloudId) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/storage/volumes`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: '\u521b\u5efa\u4e91\u76d8' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function openSnapshotsList(page, cloudId) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/storage/snapshots`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(2000);
  await page.locator('tr.ant-table-row').first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
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
    const item = page.getByRole('menuitem', { name: menuLabel });
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

    await openVolumesList(page, cloudId);
    const createBtn = page.getByRole('button', { name: '\u521b\u5efa\u4e91\u76d8' });
    const toolbar = page.locator('.shared-toolbar').first();
    await toolbar.waitFor({ timeout: 15000 });
    await shot(page, 'volume-list-toolbar.png', { subdir: SUBDIR, locator: toolbar });
    await shot(page, 'volume-list-page.png', { subdir: SUBDIR });

    await createBtn.click();
    const createModal = modal(page, '\u521b\u5efa\u4e91\u76d8');
    await createModal.waitFor({ timeout: 15000 });
    await createModal.getByLabel('\u540d\u79f0').fill('manual-doc-volume');
    await page.waitForTimeout(400);
    await shot(page, 'volume-create-modal.png', { subdir: SUBDIR, locator: createModal });
    await page.keyboard.press('Escape');
    await createModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const attachRow = await clickRowMenu(page, '\u6302\u8f7d\u5230\u865a\u62df\u673a');
    if (attachRow) {
      const attachModal = modal(page, '\u6302\u8f7d\u5230\u4e91\u4e3b\u673a');
      await attachModal.waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await shot(page, 'volume-attach-modal.png', { subdir: SUBDIR, locator: attachModal });
      await page.keyboard.press('Escape');
      await attachModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    } else {
      console.log('skip volume-attach-modal: no unattached volume found');
    }

    await openVolumesList(page, cloudId);
    const snapRow = await clickRowMenu(page, '\u521b\u5efa\u5feb\u7167', { requireEnabled: false });
    if (snapRow) {
      const snapCreateModal = modal(page, '\u521b\u5efa\u5feb\u7167');
      await snapCreateModal.waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      await shot(page, 'volume-snapshot-create-modal.png', { subdir: SUBDIR, locator: snapCreateModal });
      await page.keyboard.press('Escape');
    } else {
      console.log('skip volume-snapshot-create-modal: no volume row');
    }

    const editRow = await clickRowMenu(page, '\u7f16\u8f91\u914d\u7f6e');
    if (editRow) {
      const editModal = modal(page, '\u7f16\u8f91\u914d\u7f6e');
      await editModal.waitFor({ timeout: 15000 });
      await shot(page, 'volume-resize-modal.png', { subdir: SUBDIR, locator: editModal });
      await page.keyboard.press('Escape');
    }

    await openSnapshotsList(page, cloudId);
    await shot(page, 'snapshot-list-page.png', { subdir: SUBDIR });

    const restoreRow = await clickRowMenu(page, '\u6062\u590d');
    if (restoreRow) {
      const restoreModal = modal(page, '\u6062\u590d\u4e91\u76d8\u5feb\u7167');
      await restoreModal.waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      await shot(page, 'volume-snapshot-restore-modal.png', { subdir: SUBDIR, locator: restoreModal });
      await page.keyboard.press('Escape');
    } else {
      console.log('skip volume-snapshot-restore-modal: no snapshot row');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});