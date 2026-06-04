const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { launchTowerBrowser, newMaximizedPage, adminLoginPage } = require('../../shared/playwright-browser.cjs');
const {
  fetchFailureDomainOverview,
  deleteDomainsByPrefix,
  deleteFailureDomain,
  findDomainByName,
} = require('./lib/failure-domains-api.cjs');
const {
  openFailureDomainsPage,
  clickCreateFailureDomain,
  fillFailureDomainForm,
  submitFailureDomainModal,
  searchFailureDomainRow,
  openAssignNodesModal,
  selectAssignNodes,
  submitAssignNodesModal,
  hasRuntimeErrorOverlay,
  closeAntModal,
} = require('./lib/failure-domains-page.cjs');

const prefix = process.env.TOWER_FD_NAME_PREFIX || 'tower-e2e-fd';
const domainName = process.env.TOWER_FD_DOMAIN_NAME || `${prefix}-${Date.now()}`;
const nodeName = String(process.env.TOWER_FD_NODE_NAME || '').trim();

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const cleaned = await deleteDomainsByPrefix(token, cloudId, prefix);

  const overview0 = await fetchFailureDomainOverview(token, cloudId, true);
  const unassigned = Array.isArray(overview0?.unassignedNodeNames)
    ? overview0.unassignedNodeNames
    : [];
  const assignNode = nodeName || unassigned[0] || '';

  const browser = await launchTowerBrowser({ headless: process.env.HEADLESS === '1' });
  const { page } = await newMaximizedPage(browser);
  await adminLoginPage(page, webBase, adminUser, adminPassword);
  await openFailureDomainsPage(page, cloudId);

  const emptyModal = await clickCreateFailureDomain(page);
  await submitFailureDomainModal(emptyModal);
  await page.getByText('请输入故障域名称').first().waitFor({ timeout: 10000 });
  if (await hasRuntimeErrorOverlay(page)) {
    throw new Error('empty submit should not trigger Uncaught runtime errors overlay');
  }
  await closeAntModal(emptyModal);

  const createModal = await clickCreateFailureDomain(page);
  await fillFailureDomainForm(createModal, {
    name: domainName,
    description: 'tower browser e2e',
  });
  await submitFailureDomainModal(createModal);
  await page.getByText('已创建').first().waitFor({ timeout: 60000 });

  const row = await searchFailureDomainRow(page, domainName);
  const rowText = await row.innerText();
  if (!/机架/.test(rowText)) throw new Error('expected rack type tag in table row');

  let assigned = false;
  if (assignNode) {
    const assignModal = await openAssignNodesModal(page, row);
    await selectAssignNodes(assignModal, [assignNode]);
    await submitAssignNodesModal(assignModal);
    await page.getByText('节点分配已保存').first().waitFor({ timeout: 120000 });
    assigned = true;
    await page.waitForTimeout(2000);
    const row2 = await searchFailureDomainRow(page, domainName);
    const text2 = await row2.innerText();
    if (!text2.includes(assignNode)) {
      throw new Error(`assigned node ${assignNode} not shown in table`);
    }
  }

  const overview1 = await fetchFailureDomainOverview(token, cloudId);
  const created = findDomainByName(overview1, domainName);
  if (!created?.id) throw new Error(`API overview missing domain ${domainName}`);

  await deleteFailureDomain(token, cloudId, created.id);

  console.log(
    JSON.stringify(
      { ok: true, cloudId, domainName, cleaned, assigned, assignNode: assignNode || null },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
