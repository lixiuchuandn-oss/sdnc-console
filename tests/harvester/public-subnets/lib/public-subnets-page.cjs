const { webBase } = require('../../../shared/load-env.cjs');

function clusterPublicSubnetsUrl(cloudId) {
  const id = encodeURIComponent(cloudId);
  return `${webBase}/admin/clouds/${id}/cluster/cluster_physical_network?operateTab=public_subnets`;
}

async function openPublicSubnetsPage(page, cloudId) {
  await page.goto(clusterPublicSubnetsUrl(cloudId), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

async function clickCreatePublicSubnet(page) {
  await page.getByRole('button', { name: '创建公共子网' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '创建公共子网' });
  await modal.waitFor();
  return modal;
}

async function submitCreatePublicSubnetModal(modal) {
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
  await modal.waitFor({ state: 'hidden', timeout: 180000 });
}

async function fillPublicSubnetCreateForm(modal, { alias, cidrBlock, gateway, vlanSearchText }) {
  if (alias != null) {
    await modal.getByLabel('名称').fill(String(alias));
  }
  if (cidrBlock != null) {
    await modal.locator('#cidrBlock').fill(String(cidrBlock));
  }
  if (gateway != null) {
    await modal.getByRole('textbox', { name: '网关' }).fill(String(gateway));
  }
  if (vlanSearchText) {
    const vlanSelect = modal.locator('.ant-form-item').filter({ hasText: 'VLAN' }).locator('.ant-select').first();
    await vlanSelect.click();
    const page = modal.page();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: String(vlanSearchText) })
      .first()
      .click();
  }
}

async function searchPublicSubnetRow(page, text) {
  await page.getByPlaceholder('名称/网段/ID').fill(String(text));
  await page.waitForTimeout(1500);
  const row = page.locator('tr.ant-table-row').filter({ hasText: text }).first();
  await row.waitFor({ timeout: 30000 });
  return row;
}

async function openEditPublicSubnetName(page, row) {
  await row.getByRole('button', { name: /修改网络名称|设置网络名称/ }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '编辑名称' });
  await modal.waitFor();
  return modal;
}

async function submitEditNameModal(modal) {
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
  await modal.waitFor({ state: 'hidden', timeout: 120000 });
}

async function hasRuntimeErrorOverlay(page) {
  return page.getByText('Uncaught runtime errors').isVisible().catch(() => false);
}

module.exports = {
  clusterPublicSubnetsUrl,
  openPublicSubnetsPage,
  clickCreatePublicSubnet,
  submitCreatePublicSubnetModal,
  fillPublicSubnetCreateForm,
  searchPublicSubnetRow,
  openEditPublicSubnetName,
  submitEditNameModal,
  hasRuntimeErrorOverlay,
};
