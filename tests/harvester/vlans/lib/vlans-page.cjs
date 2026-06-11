const { webBase } = require('../../../shared/load-env.cjs');

function clusterPhysicalNetworkVlansUrl(cloudId) {
  const id = encodeURIComponent(cloudId);
  return `${webBase}/admin/clouds/${id}/cluster/cluster_physical_network?operateTab=vlans`;
}

async function openVlansPage(page, cloudId) {
  await page.goto(clusterPhysicalNetworkVlansUrl(cloudId), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

function vlanPlanDrawer(page) {
  return page.getByRole('dialog', { name: '网络规划' });
}

async function openVlanPlanDrawer(page) {
  await page.getByRole('button', { name: '网络规划' }).click();
  const drawer = vlanPlanDrawer(page);
  await drawer.waitFor();
  return drawer;
}

async function selectProviderInVlanPlanDrawer(page, providerLabel) {
  const drawer = vlanPlanDrawer(page);
  const select = drawer.locator('.ant-select').first();
  if (!(await select.isVisible().catch(() => false))) return;
  await select.click();
  const label = String(providerLabel || '').trim();
  if (label) {
    await page.locator('.ant-select-item-option').filter({ hasText: label }).first().click();
  } else {
    await page.locator('.ant-select-item-option').first().click();
  }
  await page.waitForTimeout(500);
}

async function openAddVlanModal(page) {
  const drawer = vlanPlanDrawer(page);
  await drawer.getByRole('button', { name: '添加 VLAN' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '添加 VLAN' });
  await modal.waitFor();
  return modal;
}

async function fillAddVlanModal(modal, { alias, vlanId }) {
  if (alias != null) {
    const nameInput = modal.getByRole('textbox', { name: '* 名称' });
    await nameInput.fill(String(alias));
    await nameInput.blur();
  }
  if (vlanId != null) {
    const idInput = modal.getByRole('spinbutton', { name: '* VLAN ID' });
    await idInput.fill(String(vlanId));
    await idInput.blur();
  }
}

async function submitAddVlanModal(modal) {
  const form = modal.locator('form.std-form');
  if (await form.count()) {
    await form.evaluate((el) => {
      if (el instanceof HTMLFormElement) el.requestSubmit();
    });
  } else {
    await modal.getByRole('button', { name: /确\s*定/ }).click();
  }
  await modal.waitFor({ state: 'hidden', timeout: 120000 });
}

async function searchVlanRow(page, text) {
  await page.getByPlaceholder('名称 / ID / VLAN tag').fill(String(text));
  await page.waitForTimeout(1500);
  const row = page.locator('tr.ant-table-row').filter({ hasText: text }).first();
  await row.waitFor({ timeout: 30000 });
  return row;
}

async function hasRuntimeErrorOverlay(page) {
  return page.getByText('Uncaught runtime errors').isVisible().catch(() => false);
}

module.exports = {
  clusterPhysicalNetworkVlansUrl,
  openVlansPage,
  openVlanPlanDrawer,
  selectProviderInVlanPlanDrawer,
  openAddVlanModal,
  fillAddVlanModal,
  submitAddVlanModal,
  searchVlanRow,
  hasRuntimeErrorOverlay,
};
