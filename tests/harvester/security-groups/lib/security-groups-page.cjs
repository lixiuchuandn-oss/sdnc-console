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

const { openRowMenu, clickRowMenuItem } = require('../../../lib/pool-row-menu.cjs');
const { confirmHighRiskDelete } = require('../../../lib/high-risk-delete.cjs');
const { waitYamlDrawerContains, closeYamlDrawer } = require('../../../lib/yaml-drawer.cjs');

function accessControlDrawer(page) {
  return page.locator('.ant-drawer').filter({ hasText: '访问控制' });
}

async function openSecurityGroupEditModal(page, row) {
  await openRowMenu(page, row);
  await clickRowMenuItem(page, '编辑安全组');
  const modal = page.locator('.ant-modal').filter({ hasText: '编辑安全组' });
  await modal.waitFor();
  return modal;
}

async function submitSecurityGroupEditModal(modal) {
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
}

async function openSecurityGroupRulesDrawer(page, row) {
  await openRowMenu(page, row);
  await clickRowMenuItem(page, '访问控制');
  const drawer = accessControlDrawer(page);
  await drawer.waitFor();
  await waitAccessControlDrawerReady(page);
  return drawer;
}

async function waitAccessControlDrawerReady(page) {
  const drawer = accessControlDrawer(page);
  await drawer.locator('.ant-spin-spinning').waitFor({ state: 'hidden', timeout: 120000 });
}

async function openSecurityGroupYamlDrawer(page, row) {
  await openRowMenu(page, row);
  await clickRowMenuItem(page, '查看YAML');
}

async function addInboundRuleInAccessDrawer(page) {
  const drawer = accessControlDrawer(page);
  await drawer.getByRole('button', { name: '添加规则' }).click();
}

async function saveAccessControlDrawer(page) {
  const drawer = accessControlDrawer(page);
  const saveBtn = drawer.getByRole('button', { name: /保\s*存/ }).first();
  await saveBtn.click();
  await page.waitForFunction(
    () => {
      const root = [...document.querySelectorAll('.ant-drawer')].find((el) => el.innerText.includes('访问控制'));
      return !root || !root.querySelector('.ant-btn-loading');
    },
    null,
    { timeout: 120000 },
  );
}

async function closeAccessControlDrawer(page) {
  const drawer = accessControlDrawer(page);
  if (!(await drawer.isVisible().catch(() => false))) return;
  const closeBtn = drawer.locator('button').filter({ has: page.locator('.anticon-close') }).first();
  if (await closeBtn.count()) {
    await closeBtn.click();
    return;
  }
  await page.keyboard.press('Escape');
}

async function switchAccessControlTab(page, tabLabel) {
  await page.locator('.ant-segmented-item').filter({ hasText: tabLabel }).click();
}

async function tryJoinFirstAvailableMember(page) {
  await switchAccessControlTab(page, '关联云主机');
  await page.waitForTimeout(500);
  const joinBtn = accessControlDrawer(page).getByRole('button', { name: '加入' }).first();
  if (!(await joinBtn.isVisible().catch(() => false))) return false;
  await joinBtn.click();
  return true;
}

async function deleteSecurityGroupFromRow(page, row, resourceName) {
  await openRowMenu(page, row);
  await clickRowMenuItem(page, '删除');
  await confirmHighRiskDelete(page, resourceName);
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
  openSecurityGroupEditModal,
  submitSecurityGroupEditModal,
  openSecurityGroupRulesDrawer,
  openSecurityGroupYamlDrawer,
  addInboundRuleInAccessDrawer,
  saveAccessControlDrawer,
  switchAccessControlTab,
  tryJoinFirstAvailableMember,
  deleteSecurityGroupFromRow,
  waitAccessControlDrawerReady,
  closeAccessControlDrawer,
  waitYamlDrawerContains,
  closeYamlDrawer,
};
