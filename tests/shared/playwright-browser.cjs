let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  if (e && e.code === 'MODULE_NOT_FOUND') {
    throw new Error(
      '未安装 playwright。请在 tests 目录执行: npm install（postinstall 会自动下载 Chromium）',
    );
  }
  throw e;
}

/** 默认有头；HEADLESS=1 无头；HEADED=1 强制有头（覆盖 HEADLESS） */
function resolvePlaywrightHeadless() {
  const headed = String(process.env.HEADED || '').trim().toLowerCase();
  if (headed === '1' || headed === 'true' || headed === 'yes') return false;
  const headless = String(process.env.HEADLESS || '').trim().toLowerCase();
  if (headless === '1' || headless === 'true' || headless === 'yes') return true;
  return false;
}

function resolvePlaywrightSlowMo(headless) {
  const raw = String(process.env.TOWER_PLAYWRIGHT_SLOW_MO || '').trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return headless ? 0 : 220;
}

async function launchTowerBrowser(options = {}) {
  const headless = options.headless !== undefined ? options.headless : resolvePlaywrightHeadless();
  const slowMo =
    options.slowMo !== undefined ? options.slowMo : resolvePlaywrightSlowMo(headless);
  try {
    return await chromium.launch({ channel: 'msedge', headless, slowMo, args: ['--start-maximized'] });
  } catch {
    return await chromium.launch({ headless, slowMo, args: ['--start-maximized'] });
  }
}

async function newMaximizedPage(browser) {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  } catch {
    await page.setViewportSize({ width: 1920, height: 1080 });
  }
  return { context, page };
}

async function adminLoginPage(page, webBase, user, password) {
  await page.goto(`${webBase}/admin/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#admin-login_username');
  await page.fill('#admin-login_username', user);
  await page.fill('#admin-login_password', password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/admin\/(?!login)/, { timeout: 60000 });
}

module.exports = { launchTowerBrowser, newMaximizedPage, adminLoginPage, resolvePlaywrightHeadless };