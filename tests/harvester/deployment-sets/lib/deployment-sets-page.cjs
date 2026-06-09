const { webBase } = require('../../../shared/load-env.cjs');

function computeClusterDeploymentSetsUrl(cloudId) {
  const id = encodeURIComponent(cloudId);
  return `${webBase}/admin/clouds/${id}/cluster/compute_cluster?operateTab=deployment_sets`;
}

async function openDeploymentSetsPage(page, cloudId) {
  await page.goto(computeClusterDeploymentSetsUrl(cloudId), { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: '部署集' }).click().catch(() => {});
  await page.waitForTimeout(2000);
}

async function clickCreateDeploymentSet(page) {
  await page.getByRole('button', { name: '创建部署集' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '创建部署集' });
  await modal.waitFor();
  return modal;
}

async function submitDeploymentSetModal(modal) {
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
}

async function fillDeploymentSetForm(modal, { name, description }) {
  if (name != null) {
    await modal.getByLabel('名称').fill(String(name));
  }
  if (description != null) {
    await modal.getByLabel('描述').fill(String(description));
  }
}

async function searchDeploymentSetRow(page, name) {
  await page.getByPlaceholder('名称 / 描述 / 项目').fill(String(name));
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

const { openRowMenu, clickRowMenuItem } = require('../../../lib/pool-row-menu.cjs');
const { confirmHighRiskDelete } = require('../../../lib/high-risk-delete.cjs');
const { waitYamlDrawerContains, closeYamlDrawer } = require('../../../lib/yaml-drawer.cjs');

async function openDeploymentSetEditModal(page, row) {
  await openRowMenu(page, row);
  await clickRowMenuItem(page, '编辑');
  const modal = page.locator('.ant-modal').filter({ hasText: '编辑部署集' });
  await modal.waitFor();
  return modal;
}

async function openDeploymentSetYamlDrawer(page, row) {
  await openRowMenu(page, row);
  await clickRowMenuItem(page, '查看YAML');
}

async function deleteDeploymentSetFromRow(page, row, resourceName) {
  await openRowMenu(page, row);
  await clickRowMenuItem(page, '删除');
  await confirmHighRiskDelete(page, resourceName);
}

module.exports = {
  computeClusterDeploymentSetsUrl,
  openDeploymentSetsPage,
  clickCreateDeploymentSet,
  submitDeploymentSetModal,
  fillDeploymentSetForm,
  searchDeploymentSetRow,
  closeAntModal,
  hasRuntimeErrorOverlay,
  openDeploymentSetEditModal,
  openDeploymentSetYamlDrawer,
  waitYamlDrawerContains,
  closeYamlDrawer,
  deleteDeploymentSetFromRow,
};
