const { openAdminPage } = require('./pool-nav.cjs');
const { hasRuntimeErrorOverlay } = require('../harvester/failure-domains/lib/failure-domains-page.cjs');
const { DEFAULT_SMOKE_DELAY_MS } = require('./smoke-pool-tab.cjs');

/**
 * @param {import('playwright').Page} page
 * @param {{ id: string; pathSuffix: string; openOpts?: Record<string, unknown> }} route
 */
async function smokeAdminTab(page, route) {
  const openOpts = {
    ...(route.openOpts || {}),
    delay: route.openOpts?.delay ?? DEFAULT_SMOKE_DELAY_MS,
  };
  await openAdminPage(page, route.pathSuffix, openOpts);
  if (await hasRuntimeErrorOverlay(page)) {
    throw new Error('Uncaught runtime errors overlay');
  }
}

module.exports = { smokeAdminTab };
