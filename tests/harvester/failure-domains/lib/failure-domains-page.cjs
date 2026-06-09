const { webBase } = require('../../../shared/load-env.cjs');

function computeClusterFailureDomainsUrl(cloudId) {
  const id = encodeURIComponent(cloudId);
  return `${webBase}/admin/clouds/${id}/cluster/compute_cluster?operateTab=failure_domains`;
}

async function openFailureDomainsPage(page, cloudId) {
  await page.goto(computeClusterFailureDomainsUrl(cloudId), { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: '故障域' }).click().catch(() => {});
  await page.waitForTimeout(2000);
}

async function clickCreateFailureDomain(page) {
  await page.getByRole('button', { name: '创建故障域' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '创建故障域' });
  await modal.waitFor();
  return modal;
}

async function submitFailureDomainModal(modal) {
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
}

async function fillFailureDomainForm(modal, { name, description, domainTypeLabel }) {
  if (name != null) {
    await modal.getByLabel('名称').fill(String(name));
  }
  if (description != null) {
    await modal.getByLabel('描述').fill(String(description));
  }
  if (domainTypeLabel) {
    await modal.getByLabel('类型').click();
    await pageSelectOption(modal.page(), domainTypeLabel);
  }
}

async function pageSelectOption(page, label) {
  await page.locator('.ant-select-item-option').filter({ hasText: label }).first().click();
}

async function searchFailureDomainRow(page, name) {
  await page.getByPlaceholder('名称 / 描述').fill(String(name));
  await page.waitForTimeout(1500);
  const row = page.locator('tr.ant-table-row').filter({ hasText: name }).first();
  await row.waitFor({ timeout: 30000 });
  return row;
}

async function openFailureDomainRowMenu(page, row) {
  await row.locator('.row-actions-trigger').first().click();
}

async function openAssignNodesModal(page, row) {
  await openFailureDomainRowMenu(page, row);
  await page.getByRole('menuitem', { name: '分配节点' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '分配节点' });
  await modal.waitFor();
  return modal;
}

async function selectAssignNodes(modal, nodeNames) {
  const select = modal.locator('.ant-select').first();
  await select.click();
  for (const nodeName of nodeNames) {
    await modal
      .page()
      .locator('.ant-select-item-option')
      .filter({ hasText: nodeName })
      .first()
      .click();
  }
}

async function submitAssignNodesModal(modal) {
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
}

async function closeAntModal(modal) {
  const cancel = modal.locator('.ant-modal-footer .ant-btn:not(.ant-btn-primary)').first();
  if (await cancel.count()) {
    await cancel.click();
    return;
  }
  await modal.locator('.ant-modal-close').click();
}

async function confirmHighRiskDelete(page, resourceName) {
  const modal = page.locator('.ant-modal').filter({ hasText: /确认删除/ });
  await modal.waitFor();
  const ack = modal.getByRole('checkbox');
  if (await ack.count()) await ack.check();
  const typeInput = modal.locator('input:not([type="checkbox"])').filter({ visible: true }).last();
  if (await typeInput.count()) await typeInput.fill(String(resourceName));
  await modal.getByRole('button', { name: /删\s*除/ }).click();
}

async function hasRuntimeErrorOverlay(page) {
  return page.getByText('Uncaught runtime errors').isVisible().catch(() => false);
}

module.exports = {
  computeClusterFailureDomainsUrl,
  openFailureDomainsPage,
  clickCreateFailureDomain,
  submitFailureDomainModal,
  fillFailureDomainForm,
  searchFailureDomainRow,
  openFailureDomainRowMenu,
  openAssignNodesModal,
  selectAssignNodes,
  submitAssignNodesModal,
  confirmHighRiskDelete,
  hasRuntimeErrorOverlay,
  closeAntModal,
};
