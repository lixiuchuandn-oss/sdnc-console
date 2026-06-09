const { webBase } = require('../shared/load-env.cjs');

function poolUrl(cloudId, pathSuffix) {
  const suffix = String(pathSuffix || '').replace(/^\/+/, '');
  return `${webBase}/admin/clouds/${cloudId}/${suffix}`;
}

async function openPoolPage(page, cloudId, pathSuffix, opts = {}) {
  await page.goto(poolUrl(cloudId, pathSuffix), { waitUntil: 'domcontentloaded' });
  if (opts.waitButton) {
    await page.getByRole('button', { name: opts.waitButton }).waitFor({ timeout: opts.timeout ?? 60000 });
  } else if (opts.waitText) {
    await page.getByText(opts.waitText, { exact: false }).first().waitFor({ timeout: opts.timeout ?? 60000 });
  } else {
    await page
      .locator('tr.ant-table-row, .ant-empty, .cloudmap-monitoring-page-root, .page-detail-section')
      .first()
      .waitFor({ timeout: opts.timeout ?? 60000 })
      .catch(() => {});
  }
  await page.waitForTimeout(opts.delay ?? 1500);
}

async function openAdminPage(page, pathSuffix, opts = {}) {
  const suffix = String(pathSuffix || '').replace(/^\/+/, '');
  await page.goto(`${webBase}/admin/${suffix}`, { waitUntil: 'domcontentloaded' });
  if (opts.waitButton) {
    await page.getByRole('button', { name: opts.waitButton }).waitFor({ timeout: opts.timeout ?? 60000 });
  } else if (opts.waitText) {
    await page.getByText(opts.waitText, { exact: false }).first().waitFor({ timeout: opts.timeout ?? 60000 });
  } else {
    await page.locator('tr.ant-table-row, .ant-empty, .page-detail-section').first().waitFor({ timeout: opts.timeout ?? 60000 }).catch(() => {});
  }
  await page.waitForTimeout(opts.delay ?? 1500);
}

module.exports = { poolUrl, openPoolPage, openAdminPage };
