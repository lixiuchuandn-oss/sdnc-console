/**
 * Capture screenshots for user-manual section 3.2.7 (browser image upload).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { webBase, cloudId: envCloudId, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { demoIsoPath, openImagesPage } = require('./lib/images-page.cjs');

const OUT_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'cloudmap-whitepaper',
  'user-manual',
  'source',
  'assets',
);

const DEMO_NAME = `manual-screenshot-${Date.now().toString(36)}`;

async function ensureDemoIso() {
  const iso = demoIsoPath();
  if (fs.existsSync(iso) && fs.statSync(iso).size >= 1024 * 1024) return iso;
  execSync('node fixtures/generate-demo-iso.cjs --size=2m', {
    cwd: path.join(__dirname),
    stdio: 'inherit',
  });
  return demoIsoPath();
}

async function shot(page, name, locator) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  if (locator) {
    await locator.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  console.log('wrote', file);
}

async function main() {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, envCloudId || process.env.TOWER_CLOUD_ID);
  const isoPath = await ensureDemoIso();
  const browser = await launchTowerBrowser({ slowMo: 80 });
  const { page } = await newMaximizedPage(browser);

  try {
    await adminLoginPage(page, webBase, adminUser, adminPassword);
    await openImagesPage(page, cloudId);

    await page.getByRole('button', { name: '\u65b0\u589e\u955c\u50cf' }).waitFor({ timeout: 15000 });
    await shot(page, 'image-list-toolbar.png');

    await page.getByRole('button', { name: '\u65b0\u589e\u955c\u50cf' }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '\u65b0\u589e\u955c\u50cf' });
    await modal.waitFor();
    await modal.getByRole('tab', { name: '\u6d4f\u89c8\u5668\u4e0a\u4f20' }).click();
    await modal.locator('input[type=file]').setInputFiles(isoPath);
    await page.waitForTimeout(600);
    await modal.locator('#toolDisplayName').fill(DEMO_NAME);
    await shot(page, 'image-create-browser-upload.png', modal);

    await modal.getByRole('button', { name: '\u63d0\u4ea4\u4efb\u52a1' }).click();
    const drawer = page.locator('.ant-drawer').filter({ hasText: '\u955c\u50cf\u4e0a\u4f20\u4efb\u52a1' });
    await drawer.waitFor({ timeout: 30000 });
    await drawer
      .getByText(/文件已上传至 Tower|待同步|分片上传|上传中/)
      .first()
      .waitFor({ timeout: 180000 });
    await page.waitForTimeout(800);
    await shot(page, 'image-upload-tasks-drawer.png', drawer);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.getByPlaceholder('\u540d\u79f0/\u9879\u76ee').fill(DEMO_NAME);
    await page.waitForTimeout(2500);
    const row = page.locator('tr.ant-table-row').filter({ hasText: DEMO_NAME }).first();
    await row.waitFor({ timeout: 60000 });
    await page.locator('.ant-table-wrapper').first().screenshot({ path: path.join(OUT_DIR, 'image-list-pending-sync.png') });
    console.log('wrote', path.join(OUT_DIR, 'image-list-pending-sync.png'));
    await shot(page, 'image-list-pending-sync.png');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
