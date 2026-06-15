/**
 * Smoke: ch03 §3.4 flat network + VPC tabs — read-only navigation.
 * Route list aligned with manual/capture-ch03-network.browser.cjs.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

/** @type {{ id: string; pathSuffix: string }[]} */
const NETWORK_TAB_ROUTES = [
  { id: 'flat/public_subnets', pathSuffix: 'flat_network/flat_public_subnets' },
  { id: 'flat/eips', pathSuffix: 'flat_network/flat_kubeovn_eips' },
  { id: 'flat/security_groups', pathSuffix: 'flat_network/security_groups' },
  { id: 'flat/snat', pathSuffix: 'flat_network/flat_kubeovn_snat' },
  { id: 'flat/dnat', pathSuffix: 'flat_network/flat_kubeovn_dnat' },
  { id: 'vpc/vpcs', pathSuffix: 'kube_ovn/vpcs' },
  { id: 'vpc/subnets', pathSuffix: 'kube_ovn/subnets' },
  { id: 'vpc/eips', pathSuffix: 'kube_ovn/kubeovn_eips' },
  { id: 'vpc/snat', pathSuffix: 'kube_ovn/kubeovn_snat' },
  { id: 'vpc/dnat', pathSuffix: 'kube_ovn/kubeovn_dnat' },
];

test('Cloudmap 网络 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '网络',
    story: '扁平网与 VPC 侧栏 Tab 遍历',
    description: '对齐用户手册 ch03 §3.4；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of NETWORK_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: NETWORK_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
