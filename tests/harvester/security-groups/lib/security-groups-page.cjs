const { webBase } = require('../../../shared/load-env.cjs');

function flatSecurityGroupsUrl(cloudId) {
  const id = encodeURIComponent(cloudId);
  return `${webBase}/admin/clouds/${id}/flat_network/security_groups`;
}

async function openSecurityGroupsPage(page, cloudId) {
  await page.goto(flatSecurityGroupsUrl(cloudId), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

async function clickCreateSecurityGroup(page) {
  await page.getByRole('button', { name: '新建安全组' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '新建安全组' });
  await modal.waitFor();
  return modal;
}

async function submitSecurityGroupCreateModal(modal) {
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
}

async function fillSecurityGroupCreateForm(modal, { name, description, subnetName }) {
  if (name != null) {
    await modal.getByLabel('名称').fill(String(name));
  }
  if (description != null) {
    await modal.getByLabel('描述').fill(String(description));
  }
  if (subnetName) {
    await modal.getByLabel('扁平子网').click();
    const page = modal.page();
    const opt = page.locator('.ant-select-item-option').filter({ hasText: String(subnetName) }).first();
    if (await opt.count()) {
      await opt.click();
    } else {
      await page.locator('.ant-select-item-option').first().click();
    }
  }
}

async function searchSecurityGroupRow(page, name) {
  await page.getByPlaceholder('名称/子网').fill(String(name));
  await page.waitForTimeout(1500);
  const row = page.locator('tr.ant-table-row').filter({ hasText: name }).first();
  await row.waitFor({ timeout: 30000 });
  return row;
}

async function closeAntModal(modal) {
  const cancel = modal.locator('.ant-modal-footer .ant-btn:not(.ant-btn-primary)').first();
  if (await cancel.count()) {
    await cancel.click();
    return;
  }
  await modal.locator('.ant-modal-close').click();
}

async function hasRuntimeErrorOverlay(page) {
  return page.getByText('Uncaught runtime errors').isVisible().catch(() => false);
}

module.exports = {
  flatSecurityGroupsUrl,
  openSecurityGroupsPage,
  clickCreateSecurityGroup,
  submitSecurityGroupCreateModal,
  fillSecurityGroupCreateForm,
  searchSecurityGroupRow,
  closeAntModal,
  hasRuntimeErrorOverlay,
};
