const path = require('path');

require('./shared/load-env.cjs');

const resultsDir = process.env.ALLURE_RESULTS_DIR || path.join(__dirname, 'allure-results');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: __dirname,
  testMatch: '**/*.browser.test.cjs',
  testIgnore: ['**/manual/**', '**/capture-manual-screenshots.browser.test.cjs'],
  timeout: Number(process.env.TOWER_BROWSER_TEST_TIMEOUT_MS || 3600000),
  expect: { timeout: 120000 },
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['list'],
    ['allure-playwright', { resultsDir }],
  ],
};
