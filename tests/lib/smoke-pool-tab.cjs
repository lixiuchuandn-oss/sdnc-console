const { openPoolPage } = require('./pool-nav.cjs');
const { hasRuntimeErrorOverlay } = require('../harvester/failure-domains/lib/failure-domains-page.cjs');

const DEFAULT_SMOKE_DELAY_MS = Number(process.env.TOWER_SMOKE_PAGE_DELAY_MS || 500);

/**
 * @param {import('playwright').Page} page
 * @param {string} cloudId
 * @param {{ id: string; pathSuffix: string; openOpts?: Record<string, unknown>; fallbackOpen?: boolean }} route
 */
async function smokePoolTab(page, cloudId, route) {
  const openOpts = {
    ...(route.openOpts || {}),
    delay: route.openOpts?.delay ?? DEFAULT_SMOKE_DELAY_MS,
  };
  try {
    await openPoolPage(page, cloudId, route.pathSuffix, openOpts);
  } catch (firstErr) {
    if (route.fallbackOpen) {
      await openPoolPage(page, cloudId, route.pathSuffix, { delay: openOpts.delay });
    } else {
      throw firstErr;
    }
  }
  if (await hasRuntimeErrorOverlay(page)) {
    throw new Error('Uncaught runtime errors overlay');
  }
}

module.exports = { smokePoolTab, DEFAULT_SMOKE_DELAY_MS };
