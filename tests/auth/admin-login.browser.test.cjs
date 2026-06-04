const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../shared/playwright-browser.cjs');
(async () => {
  const headless = process.env.HEADLESS === '1';
  const browser = await launchTowerBrowser({ headless });
  const { page } = await newMaximizedPage(browser);
  await adminLoginPage(page, webBase, adminUser, adminPassword);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  console.log(JSON.stringify({ ok: !!token, url: page.url() }, null, 2));
  if (!headless) await page.waitForTimeout(5000);
  await browser.close();
  process.exit(token ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(2); });