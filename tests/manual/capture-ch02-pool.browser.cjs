/**
 * Manual ch02: two pool onboarding paths.
 * A) Header strip: edge pool (CloudWizardeasy) — single/default pool, no multi-cloud wizard.
 * B) /admin/clouds: full CloudWizard — requires platform.multi-cloud license.
 */
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
const { webBase, adminUser, adminPassword, cloudmapEndpoint, cloudmapToken } = require('../shared/load-env.cjs');
const { shot } = require('../shared/manual-screenshot.cjs');

const SUBDIR = 'ch02-pool';
const DOC_ENDPOINT = 'https://10.0.0.1/v3';
const DOC_TOKEN = 'token-doc-example-do-not-use';

async function openHeaderEdgeWizard(page) {
  const btn = page.locator('button.admin-header-pool-icon-btn').first();
  await btn.waitFor({ timeout: 20000 });
  await btn.click();
  const modal = page.locator('.ant-modal').filter({ hasText: /\u63a5\u5165\u8fb9\u7f18\u4e91|\u7f16\u8f91\u8fb9\u7f18\u4e91/ });
  await modal.waitFor({ timeout: 15000 });
  return modal;
}

async function fillEdgePoolForm(modal, { name, endpoint, token }) {
  await modal.getByLabel('\u540d\u79f0').fill(name);
  await modal.getByLabel('\u7aef\u70b9').fill(endpoint);
  await modal.getByLabel('Cloudmap API \u4ee4\u724c').fill(token);
}

async function tryOpenMultiCloudWizard(page) {
  await page.goto(`${webBase}/admin/clouds`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const addBtn = page.getByRole('button', { name: '\u65b0\u589e\u8d44\u6e90\u6c60' });
  if ((await addBtn.count()) === 0) {
    console.log('skip multi-cloud shots: \u65b0\u589e\u8d44\u6e90\u6c60 not visible (need platform.multi-cloud)');
    return null;
  }
  await addBtn.click();
  const modal = page.locator('.ant-modal').filter({ hasText: '\u65b0\u589e\u8d44\u6e90\u6c60' });
  await modal.waitFor({ timeout: 15000 });
  return modal;
}

async function ensureMultiCloudConfigStep(page, modal) {
  const onSelect = await modal.getByText('\u6b22\u8fce\u4f7f\u7528\u4e91\u8d44\u6e90\u63a5\u5165\u5411\u5bfc').isVisible().catch(() => false);
  if (onSelect) {
    await modal.getByText('\u79c1\u6709\u4e91', { exact: true }).click();
    await page.waitForTimeout(400);
    await modal.locator('.ant-card').filter({ hasText: 'Cloudmap' }).first().click();
    await page.waitForTimeout(600);
  }
  await modal.locator('.modal-group-title').filter({ hasText: '\u914d\u7f6e\u4e91\u8d26\u53f7' }).waitFor({ timeout: 15000 });
}

async function main() {
  const endpoint = String(cloudmapEndpoint || process.env.TOWER_CLOUDMAP_ENDPOINT || DOC_ENDPOINT).trim();
  const token = String(cloudmapToken || process.env.TOWER_CLOUDMAP_TOKEN || DOC_TOKEN).trim();
  const useLiveTest = Boolean(
    (cloudmapEndpoint || process.env.TOWER_CLOUDMAP_ENDPOINT) &&
      (cloudmapToken || process.env.TOWER_CLOUDMAP_TOKEN),
  );

  const browser = await launchTowerBrowser({ slowMo: 60 });
  const { page } = await newMaximizedPage(browser);

  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await page.waitForTimeout(1500);

    // --- A: Header single-pool (edge) ---
    await shot(page, 'header-pool-strip.png', { subdir: SUBDIR });

    const edgeModal = await openHeaderEdgeWizard(page);
    await fillEdgePoolForm(edgeModal, {
      name: 'manual-doc-edge',
      endpoint,
      token: useLiveTest ? token : DOC_TOKEN,
    });
    await shot(page, 'header-edge-pool-modal.png', { locator: edgeModal, subdir: SUBDIR });

    if (useLiveTest) {
      await edgeModal.getByRole('button', { name: '\u8fde\u63a5\u6d4b\u8bd5' }).click();
      await edgeModal.getByText('\u8fde\u63a5\u6210\u529f').waitFor({ timeout: 90000 }).catch(() => {});
      await shot(page, 'header-edge-connection-test.png', { locator: edgeModal, subdir: SUBDIR });
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // --- B: Multi-cloud resource pool list ---
    const multiModal = await tryOpenMultiCloudWizard(page);
    if (multiModal) {
      await shot(page, 'multi-pool-list.png', { subdir: SUBDIR });

      const onSelect = await multiModal.getByText('\u6b22\u8fce\u4f7f\u7528\u4e91\u8d44\u6e90\u63a5\u5165\u5411\u5bfc').isVisible().catch(() => false);
      if (onSelect) {
        await multiModal.getByText('\u79c1\u6709\u4e91', { exact: true }).click();
        await page.waitForTimeout(400);
        await multiModal.locator('.ant-card').filter({ hasText: 'Cloudmap' }).first().click();
        await page.waitForTimeout(500);
        await shot(page, 'multi-pool-wizard-select.png', { locator: multiModal, subdir: SUBDIR });
      }

      await ensureMultiCloudConfigStep(page, multiModal);
      await multiModal.getByLabel('\u540d\u79f0').fill('manual-doc-multi');
      await multiModal.getByLabel('\u7aef\u70b9').fill(endpoint);
      await multiModal.getByLabel('Cloudmap API \u4ee4\u724c').fill(useLiveTest ? token : DOC_TOKEN);
      await shot(page, 'multi-pool-wizard-config.png', { locator: multiModal, subdir: SUBDIR });

      await multiModal.getByRole('button', { name: '\u4e0b\u4e00\u6b65' }).click();
      await multiModal.getByText('\u8fde\u63a5\u6d4b\u8bd5').first().waitFor({ timeout: 10000 });
      if (useLiveTest) {
        await multiModal.getByRole('button', { name: '\u6d4b\u8bd5\u8fde\u63a5' }).click().catch(() => {});
        await multiModal.getByText('\u8fde\u63a5\u6210\u529f').waitFor({ timeout: 90000 }).catch(() => {});
      } else {
        await page.waitForTimeout(1200);
      }
      await shot(page, 'multi-pool-wizard-test.png', { locator: multiModal, subdir: SUBDIR });
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