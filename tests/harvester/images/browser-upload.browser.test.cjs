const fs = require('fs');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { demoIsoPath, openImagesPage, browserUploadImage } = require('./lib/images-page.cjs');
const displayName = process.env.TOWER_IMAGE_DISPLAY_NAME || 'tower-e2e-image';
(async () => {
  const filePath = demoIsoPath();
  if (!fs.existsSync(filePath)) throw new Error(`run fixtures/generate-demo-iso.cjs first: ${filePath}`);
  const cloudId = await resolveCloudId(await towerLogin(), process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ headless: process.env.HEADLESS === '1' });
  const { page } = await newMaximizedPage(browser);
  await adminLoginPage(page, webBase, adminUser, adminPassword);
  await openImagesPage(page, cloudId);
  await browserUploadImage(page, filePath, displayName);
  console.log(JSON.stringify({ ok: true, cloudId, displayName, bytes: fs.statSync(filePath).size }, null, 2));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });