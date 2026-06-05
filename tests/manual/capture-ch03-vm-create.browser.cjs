/**
 * Manual ch03 section 3.2: VM list + quick create + create wizard (6 steps).
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');

const SUBDIR = 'ch03-vm';
const WIZARD_STEPS = [
  { key: 'basic', label: '\u57fa\u672c\u4fe1\u606f' },
  { key: 'compute', label: '\u8ba1\u7b97\u4e0e\u89c4\u683c' },
  { key: 'disks', label: '\u5b58\u50a8\u4e0e\u78c1\u76d8' },
  { key: 'networks', label: '\u7f51\u7edc\u4e0e\u8fde\u63a5' },
  { key: 'login', label: '\u767b\u5f55\u4e0e\u51ed\u636e' },
  { key: 'advanced', label: '\u9ad8\u7ea7\u8bbe\u7f6e' },
];

async function openEcsList(page, cloudId) {
  const url = `${webBase}/admin/clouds/${cloudId}/compute/ecs`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '\u521b\u5efa\u5411\u5bfc' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
}

function wizardModal(page) {
  return page.locator('.ant-modal').filter({ hasText: '\u521b\u5efa\u4e91\u4e3b\u673a' }).last();
}

async function gotoWizardStep(page, modal, label) {
  const step = modal.locator('.wizard-step').filter({ hasText: label });
  await step.waitFor({ timeout: 15000 });
  await step.click();
  await page.waitForTimeout(800);
  await modal.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
}

async function main() {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, envCloudId || process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ slowMo: 60 });
  const { page } = await newMaximizedPage(browser);

  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await page.waitForTimeout(1200);

    await openEcsList(page, cloudId);
    const toolbar = page.locator('.toolbar-actions').first();
    await toolbar.waitFor({ timeout: 15000 });
    await shot(page, 'vm-list-toolbar.png', { subdir: SUBDIR, locator: toolbar });

    await page.getByRole('button', { name: '\u5feb\u901f\u521b\u5efa' }).click();
    const quickModal = wizardModal(page);
    await quickModal.waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await shot(page, 'vm-quick-create-modal.png', { subdir: SUBDIR, locator: quickModal });
    await page.keyboard.press('Escape');
    await quickModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    await page.getByRole('button', { name: '\u521b\u5efa\u5411\u5bfc' }).click();
    const wizard = wizardModal(page);
    await wizard.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);

    for (const { key, label } of WIZARD_STEPS) {
      await gotoWizardStep(page, wizard, label);
      await shot(page, `vm-wizard-step-${key}.png`, { subdir: SUBDIR, locator: wizard });
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});