const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { openImagesPage, searchImageRow, syncImageRow, pollImageRowStatus } = require('./lib/images-page.cjs');
const displayName = process.env.TOWER_IMAGE_DISPLAY_NAME || 'tower-e2e-image';
(async () => {
  const cloudId = await resolveCloudId(await towerLogin(), process.env.TOWER_CLOUD_ID);
  const browser = await launchTowerBrowser({ headless: process.env.HEADLESS === '1' });
  const { page } = await newMaximizedPage(browser);
  await adminLoginPage(page, webBase, adminUser, adminPassword);
  await openImagesPage(page, cloudId);
  const row = await searchImageRow(page, displayName);
  await syncImageRow(page, row);
  const result = await pollImageRowStatus(page, displayName);
  console.log(JSON.stringify({ cloudId, displayName, ...result }, null, 2));
  await browser.close();
  process.exit(result.ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(2); });