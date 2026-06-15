/**
 * Smoke: ch03 §6 cluster tabs — read-only navigation, no screenshots or writes.
 * Route list aligned with manual/capture-ch03-cluster.browser.cjs.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

/** @type {{ id: string; pathSuffix: string; openOpts?: Record<string, unknown>; fallbackOpen?: boolean }[]} */
const CLUSTER_TAB_ROUTES = [
  { id: 'compute/nodes', pathSuffix: 'cluster/compute_cluster?operateTab=nodes' },
  { id: 'compute/failure_domains', pathSuffix: 'cluster/compute_cluster?operateTab=failure_domains' },
  { id: 'compute/deployment_sets', pathSuffix: 'cluster/compute_cluster?operateTab=deployment_sets' },
  { id: 'compute/drs_rules', pathSuffix: 'cluster/compute_cluster?operateTab=drs_rules' },
  { id: 'compute/migrations', pathSuffix: 'cluster/compute_cluster?operateTab=migrations' },
  { id: 'compute/projects', pathSuffix: 'cluster/compute_projects', openOpts: { waitButton: '创建项目' } },
  { id: 'compute/gpu', pathSuffix: 'cluster/compute_gpu' },
  { id: 'physical_network/switches', pathSuffix: 'cluster/cluster_physical_network?operateTab=switches' },
  { id: 'physical_network/provider_networks', pathSuffix: 'cluster/cluster_physical_network?operateTab=provider_networks' },
  { id: 'physical_network/public_subnets', pathSuffix: 'cluster/cluster_physical_network?operateTab=public_subnets' },
  { id: 'physical_network/vlans', pathSuffix: 'cluster/cluster_physical_network?operateTab=vlans' },
  { id: 'platform_network/cluster_networks', pathSuffix: 'cluster/cluster_platform_network?operateTab=cluster_networks' },
  { id: 'platform_network/nads', pathSuffix: 'cluster/cluster_platform_network?operateTab=nads' },
  { id: 'platform_network/load_balancers', pathSuffix: 'cluster/cluster_platform_network?operateTab=load_balancers' },
  { id: 'platform_network/ippools', pathSuffix: 'cluster/cluster_platform_network?operateTab=ippools' },
  { id: 'storage/overview', pathSuffix: 'cluster/harvester_addon?operateTab=overview', openOpts: { delay: 2500 } },
  { id: 'storage/harvester_addon', pathSuffix: 'cluster/harvester_addon', openOpts: { delay: 2500 } },
  {
    id: 'storage/storage_classes',
    pathSuffix: 'cluster/storage_classes',
    openOpts: { waitButton: '刷新' },
    fallbackOpen: true,
  },
  { id: 'object_storage/object_gateways', pathSuffix: 'cluster/object_gateways' },
  { id: 'object_storage/rgw_users', pathSuffix: 'cluster/rgw_users' },
  { id: 'object_storage/rgw_s3_buckets', pathSuffix: 'cluster/rgw_s3_buckets' },
  { id: 'object_storage/cosi', pathSuffix: 'cluster/cosi' },
  { id: 'passthrough/usb', pathSuffix: 'cluster/cluster_usb' },
  { id: 'passthrough/pci', pathSuffix: 'cluster/cluster_pci' },
  { id: 'passthrough/sriov', pathSuffix: 'cluster/cluster_sriov' },
];

test('Cloudmap 集群 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '集群',
    story: '侧栏 Tab 遍历',
    description: '对齐用户手册 ch03 §6；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of CLUSTER_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: CLUSTER_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
