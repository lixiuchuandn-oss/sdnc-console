/**
 * Manual ch03 section 3.4: flat network + VPC main paths.
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');

const SUBDIR = 'ch03-network';

function modal(page, titlePattern) {
  return page.locator('.ant-modal').filter({ hasText: titlePattern }).last();
}

async function openPoolPage(page, cloudId, pathSuffix, waitButtonName) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/${pathSuffix}`, {
    waitUntil: 'domcontentloaded',
  });
  if (waitButtonName) {
    await page
      .getByRole('button', { name: waitButtonName })
      .waitFor({ timeout: 60000 })
      .catch(async () => {
        await page.locator('tr.ant-table-row, .ant-empty').first().waitFor({ timeout: 30000 }).catch(() => {});
      });
  } else {
    await page.locator('tr.ant-table-row, .ant-empty').first().waitFor({ timeout: 60000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);
}

async function main() {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, envCloudId || process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ slowMo: 60 });
  const { page } = await newMaximizedPage(browser);

  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await page.waitForTimeout(1200);

    // --- Flat: subnet ---
    await openPoolPage(page, cloudId, 'flat_network/flat_public_subnets', '\u521b\u5efa\u6241\u5e73\u5b50\u7f51');
    const flatToolbar = page.locator('.shared-toolbar, .toolbar-actions').first();
    await shot(page, 'flat-subnet-list-toolbar.png', { subdir: SUBDIR, locator: flatToolbar });
    await shot(page, 'flat-subnet-list-page.png', { subdir: SUBDIR });

    await page.getByRole('button', { name: '\u521b\u5efa\u6241\u5e73\u5b50\u7f51' }).click();
    const flatCreate = modal(page, '\u521b\u5efa\u6241\u5e73\u5b50\u7f51');
    await flatCreate.waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await shot(page, 'flat-subnet-create-modal.png', { subdir: SUBDIR, locator: flatCreate });
    await page.keyboard.press('Escape');
    await flatCreate.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    // --- Flat: EIP ---
    await openPoolPage(page, cloudId, 'flat_network/flat_kubeovn_eips', '\u521b\u5efa\u516c\u7f51IP');
    await shot(page, 'flat-eip-list-page.png', { subdir: SUBDIR });
    await page.getByRole('button', { name: '\u521b\u5efa\u516c\u7f51IP' }).click();
    const flatEip = modal(page, '\u521b\u5efa\u516c\u7f51IP');
    await flatEip.waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    await shot(page, 'flat-eip-create-modal.png', { subdir: SUBDIR, locator: flatEip });
    await page.keyboard.press('Escape');

    // --- Flat: security group (optional quick) ---
    await openPoolPage(page, cloudId, 'flat_network/security_groups', '\u65b0\u5efa\u5b89\u5168\u7ec4');
    await shot(page, 'flat-security-group-list-page.png', { subdir: SUBDIR });

    const aclOpened = await (async () => {
      const rows = page.locator('tr.ant-table-row');
      const count = await rows.count();
      for (let i = 0; i < Math.min(count, 20); i++) {
        const row = rows.nth(i);
        const trigger = row.locator('.row-actions-trigger').first();
        if ((await trigger.count()) === 0) continue;
        await trigger.click();
        const item = page.getByRole('menuitem', { name: '\u8bbf\u95ee\u63a7\u5236' });
        try {
          await item.waitFor({ state: 'visible', timeout: 3000 });
          await item.click();
          return true;
        } catch {
          await page.keyboard.press('Escape');
        }
      }
      return false;
    })();
    if (aclOpened) {
      const aclDrawer = page.locator('.ant-drawer').last();
      await aclDrawer.waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      await shot(page, 'security-group-acl-drawer.png', { subdir: SUBDIR, locator: aclDrawer });
      await page.keyboard.press('Escape');
    }

    await openPoolPage(page, cloudId, 'flat_network/flat_kubeovn_snat', '\u521b\u5efa SNAT \u7f51\u5173');
    await shot(page, 'flat-snat-list.png', { subdir: SUBDIR });
    await page.getByRole('button', { name: '\u521b\u5efa SNAT \u7f51\u5173' }).click().catch(() => {});
    const flatSnatModal = modal(page, 'SNAT');
    if (await flatSnatModal.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
    }

    await openPoolPage(page, cloudId, 'flat_network/flat_kubeovn_dnat', '\u521b\u5efa DNAT \u89c4\u5219');
    await shot(page, 'flat-dnat-list.png', { subdir: SUBDIR });

    // --- VPC ---
    await openPoolPage(page, cloudId, 'kube_ovn/vpcs', '\u521b\u5efa VPC');
    await shot(page, 'vpc-list-page.png', { subdir: SUBDIR });

    await page.getByRole('button', { name: '\u521b\u5efa VPC' }).click();
    const vpcModal = modal(page, '\u521b\u5efa VPC');
    await vpcModal.waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    await shot(page, 'vpc-create-modal.png', { subdir: SUBDIR, locator: vpcModal });
    await page.keyboard.press('Escape');

    await openPoolPage(page, cloudId, 'kube_ovn/subnets', '\u65b0\u5efa VPC \u5b50\u7f51');
    await shot(page, 'vpc-subnet-list-page.png', { subdir: SUBDIR });

    await page.getByRole('button', { name: '\u65b0\u5efa VPC \u5b50\u7f51' }).click();
    const vpcSubnetModal = modal(page, '\u65b0\u5efa VPC \u5b50\u7f51');
    await vpcSubnetModal.waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await shot(page, 'vpc-subnet-create-modal.png', { subdir: SUBDIR, locator: vpcSubnetModal });

    // --- VPC EIP tab ---
    await openPoolPage(page, cloudId, 'kube_ovn/kubeovn_eips', '\u521b\u5efa\u516c\u7f51IP');
    await shot(page, 'vpc-eip-list-page.png', { subdir: SUBDIR });

    await openPoolPage(page, cloudId, 'kube_ovn/kubeovn_snat', '\u521b\u5efa SNAT \u7f51\u5173');
    await shot(page, 'vpc-snat-list.png', { subdir: SUBDIR });

    await openPoolPage(page, cloudId, 'kube_ovn/kubeovn_dnat', '\u521b\u5efa DNAT \u89c4\u5219');
    await shot(page, 'vpc-dnat-list.png', { subdir: SUBDIR });
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});