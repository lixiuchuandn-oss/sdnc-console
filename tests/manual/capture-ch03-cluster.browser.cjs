/**
 * Manual ch03 section 6: cluster compute / network / storage / passthrough / object storage.
 */
const {
  runManualCapture,
  openPoolPage,
  shot,
  modal,
  clickAntTab,
  clickTableRowMenu,
} = require('./manual-capture-helpers.cjs');

const SUBDIR = 'ch03-cluster';

async function captureComputeCluster(page, cloudId) {
  const tabs = [
    { operateTab: 'nodes', file: 'compute-nodes-list.png' },
    { operateTab: 'failure_domains', file: 'failure-domains-list.png', createBtn: '创建故障域', modalTitle: '故障域' },
    { operateTab: 'deployment_sets', file: 'deployment-sets-list.png', createBtn: '创建部署集', modalTitle: '部署集' },
    { operateTab: 'drs_rules', file: 'drs-rules-list.png', createBtn: '创建调度规则', modalTitle: '调度' },
    { operateTab: 'migrations', file: 'drs-migrations-list.png' },
  ];

  for (const tab of tabs) {
    await openPoolPage(page, cloudId, `cluster/compute_cluster?operateTab=${tab.operateTab}`);
    await shot(page, tab.file, { subdir: SUBDIR });
    if (tab.createBtn) {
      await page.getByRole('button', { name: tab.createBtn }).click().catch(() => {});
      const m = modal(page, tab.modalTitle);
      const drawerEl = page.locator('.ant-drawer').last();
      await page.waitForTimeout(600);
      if (tab.operateTab === 'drs_rules' && (await drawerEl.isVisible().catch(() => false))) {
        await shot(page, 'drs-rule-create.png', { subdir: SUBDIR, locator: drawerEl });
        await page.keyboard.press('Escape');
      } else if (await m.isVisible().catch(() => false)) {
        const modalFiles = {
          failure_domains: 'failure-domain-create-modal.png',
          deployment_sets: 'deployment-set-create-modal.png',
        };
        await shot(page, modalFiles[tab.operateTab], { subdir: SUBDIR, locator: m });
        await page.keyboard.press('Escape');
      }
    }
  }
}

async function capturePhysicalNetwork(page, cloudId) {
  const tabs = [
    { operateTab: 'switches', file: 'switches-list.png' },
    { operateTab: 'provider_networks', file: 'provider-networks-list.png' },
    { operateTab: 'public_subnets', file: 'public-subnets-list.png' },
    { operateTab: 'vlans', file: 'vlans-list.png' },
  ];
  for (const tab of tabs) {
    await openPoolPage(page, cloudId, `cluster/cluster_physical_network?operateTab=${tab.operateTab}`);
    await shot(page, tab.file, { subdir: SUBDIR });
  }
}

async function capturePlatformNetwork(page, cloudId) {
  const tabs = [
    { operateTab: 'cluster_networks', file: 'cluster-networks-list.png' },
    { operateTab: 'nads', file: 'nad-list.png' },
    { operateTab: 'load_balancers', file: 'lb-list.png' },
    { operateTab: 'ippools', file: 'ip-pools-list.png' },
  ];
  for (const tab of tabs) {
    await openPoolPage(page, cloudId, `cluster/cluster_platform_network?operateTab=${tab.operateTab}`);
    await shot(page, tab.file, { subdir: SUBDIR });
  }
}

async function captureStorage(page, cloudId) {
  await openPoolPage(page, cloudId, 'cluster/harvester_addon?operateTab=overview', { delay: 2500 });
  await shot(page, 'storage-overview.png', { subdir: SUBDIR });

  await openPoolPage(page, cloudId, 'cluster/harvester_addon', { delay: 2500 });
  const wizard = page.locator('.harvester-addon-wizard-card, .ant-steps').first();
  if (await wizard.isVisible().catch(() => false)) {
    await shot(page, 'storage-deploy-wizard.png', { subdir: SUBDIR, locator: wizard });
  } else {
    await shot(page, 'storage-deploy-wizard.png', { subdir: SUBDIR });
  }

  await openPoolPage(page, cloudId, 'cluster/storage_classes', { waitButton: '刷新' }).catch(async () => {
    await openPoolPage(page, cloudId, 'cluster/storage_classes');
  });
  await shot(page, 'storageclass-list.png', { subdir: SUBDIR });
}

async function captureObjectStorage(page, cloudId) {
  const pages = [
    { path: 'cluster/object_gateways', file: 'object-gateway-list.png' },
    { path: 'cluster/rgw_users', file: 'object-users-list.png' },
    { path: 'cluster/rgw_s3_buckets', file: 's3-buckets-list.png' },
    { path: 'cluster/cosi', file: 'cosi-list.png' },
  ];
  for (const p of pages) {
    await openPoolPage(page, cloudId, p.path);
    await shot(page, p.file, { subdir: SUBDIR });
  }
}

async function capturePassthrough(page, cloudId) {
  const pages = [
    { path: 'cluster/cluster_usb', file: 'usb-devices-list.png' },
    { path: 'cluster/cluster_pci', file: 'pci-devices-list.png' },
    { path: 'cluster/cluster_sriov', file: 'sriov-nics-list.png' },
  ];
  for (const p of pages) {
    await openPoolPage(page, cloudId, p.path);
    await shot(page, p.file, { subdir: SUBDIR });
  }
}

async function captureProjects(page, cloudId) {
  await openPoolPage(page, cloudId, 'cluster/compute_projects', { waitButton: '创建项目' });
  await shot(page, 'projects-list.png', { subdir: SUBDIR });
  await page.getByRole('button', { name: '创建项目' }).click().catch(() => {});
  const d = page.locator('.ant-drawer').last();
  if (await d.isVisible().catch(() => false)) {
    await shot(page, 'project-create.png', { subdir: SUBDIR, locator: d });
    await page.keyboard.press('Escape');
  }
}

async function captureGpu(page, cloudId) {
  await openPoolPage(page, cloudId, 'cluster/compute_gpu');
  await shot(page, 'gpu-list.png', { subdir: SUBDIR });
}

async function main() {
  await runManualCapture(async (page, cloudId) => {
    await captureComputeCluster(page, cloudId);
    await captureProjects(page, cloudId);
    await captureGpu(page, cloudId);
    await capturePhysicalNetwork(page, cloudId);
    await capturePlatformNetwork(page, cloudId);
    await captureStorage(page, cloudId);
    await captureObjectStorage(page, cloudId);
    await capturePassthrough(page, cloudId);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
