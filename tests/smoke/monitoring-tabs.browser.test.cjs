/**
 * Smoke: ch03 §3.14 monitoring — main pool paths (no in-page dashboard clicks).
 * Aligned with manual/capture-ch03-monitoring.browser.cjs entry URLs.
 */
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../shared/tower-api.cjs');
const { adminLoginPage } = require('../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../shared/browser-test.cjs');
const { smokePoolTab } = require('../lib/smoke-pool-tab.cjs');

const MONITORING_TAB_ROUTES = [
  { id: 'alerts_list', pathSuffix: 'monitoring_alerts/alerts-list', openOpts: { waitText: '集群概览' } },
  { id: 'ops_alert_dashboard', pathSuffix: 'monitoring_alerts/ops-alert-dashboard', openOpts: { waitText: '告警中心概览' } },
  { id: 'access_management', pathSuffix: 'monitoring_alerts/access-management', openOpts: { waitText: 'Prometheus' } },
];

test('Cloudmap 监控告警 Tab 只读冒烟', async () => {
  await applyAllureMeta({
    epic: 'Cloudmap',
    feature: '监控告警',
    story: '运维大盘与接入管理入口',
    description: '对齐用户手册 ch03 §3.14 主路径；不写库、不截图。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    for (const route of MONITORING_TAB_ROUTES) {
      await step(page, `打开 ${route.id}`, async () => {
        await smokePoolTab(page, cloudId, route);
      });
    }

    console.log(JSON.stringify({ cloudId, tabs: MONITORING_TAB_ROUTES.length, ok: true }, null, 2));
  });
});
