const { waitForAntModalSettled } = require('../manual/manual-capture-helpers.cjs');

async function openHeaderEdgeWizard(page) {
  const btn = page.locator('button.admin-header-pool-icon-btn').first();
  await btn.waitFor({ timeout: 20000 });
  await btn.click();
  const modal = page.locator('.ant-modal').filter({ hasText: /接入边缘云|编辑边缘云/ });
  await waitForAntModalSettled(page, modal);
  return modal;
}

async function fillEdgePoolForm(modal, { name, endpoint, token }) {
  await modal.getByLabel('名称').fill(String(name));
  await modal.getByLabel('端点').fill(String(endpoint));
  await modal.getByLabel('Cloudmap API 令牌').fill(String(token));
}

module.exports = { openHeaderEdgeWizard, fillEdgePoolForm };
