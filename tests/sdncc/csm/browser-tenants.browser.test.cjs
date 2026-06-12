/**
 * CSM 资源池 · 租户 Tab 浏览器 E2E（只读）
 */
const { test, expect } = require('@playwright/test');
const {
  webBase,
  adminUser,
  adminPassword,
  csmCloudId,
  csmEndpointHint,
} = require('../../shared/load-env.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const { towerLogin } = require('../../shared/tower-api.cjs');
const {
  resolveCsmCloudId,
  fetchCsmCloud,
  getCsmBff,
  hasCsmRepairAuthInConfig,
} = require('./lib/csm-api.cjs');

const AUTH_GAP_RE = /登录状态已过期|未登录|用户名或密码|重新登录/;

function tenantsAuthGapFromBff(tenantsRes) {
  const msg = String(tenantsRes?.data?.message || tenantsRes?.data?.error || '').trim();
  return tenantsRes.status === 502 && AUTH_GAP_RE.test(msg)
    ? { ok: true, status: tenantsRes.status, message: msg }
    : null;
}

test('CSM 资源池租户 Tab 可打开', async () => {
  await applyAllureMeta({
    epic: 'SDNCC',
    feature: 'CSM 安全资源池',
    story: '租户 Tab',
    description: '打开 CSM 池详情 ?tab=tenants；校验区块标题与表格/空态，不写库。',
  });

  const token = await towerLogin();
  const cloudId = await resolveCsmCloudId(token, {
    cloudId: csmCloudId,
    endpointHint: csmEndpointHint,
  });
  const cloud = await fetchCsmCloud(token, cloudId);
  const tenantsBff = await getCsmBff(token, cloudId, 'tenants');
  const requireTenantsOk = hasCsmRepairAuthInConfig(cloud);
  const authGap = !requireTenantsOk ? tenantsAuthGapFromBff(tenantsBff) : null;
  const tenantItems =
    tenantsBff.status === 200 && Array.isArray(tenantsBff.data?.data?.items)
      ? tenantsBff.data.data.items
      : [];

  const url = `${webBase}/admin/security/traffic/csm-pools/${encodeURIComponent(cloudId)}?tab=tenants`;

  await runWithBrowser(async (page) => {
    await step(page, '管理员登录', async () => {
      await adminLoginPage(page, webBase, adminUser, adminPassword);
      await page.waitForTimeout(800);
    });

    await step(page, '打开租户 Tab', async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);
    });

    await step(page, '校验租户 BFF 与页面表现一致', async () => {
      await expect(page.getByText('租户', { exact: true }).first()).toBeVisible({ timeout: 20000 });

      if (requireTenantsOk) {
        if (tenantsBff.status !== 200) {
          throw new Error(
            `已配置 repair 凭据但 tenants BFF 非 200: HTTP ${tenantsBff.status} ${JSON.stringify(tenantsBff.data)}`,
          );
        }
        if (tenantItems.length > 0) {
          await expect(page.locator('tr.ant-table-row').first()).toBeVisible({ timeout: 20000 });
        } else {
          await expect(page.getByText('CSM 未返回租户数据')).toBeVisible({ timeout: 20000 });
        }
        console.log(
          JSON.stringify(
            { cloudId, url, bffStatus: tenantsBff.status, itemCount: tenantItems.length, view: 'table-or-empty', ok: true },
            null,
            2,
          ),
        );
        return;
      }

      if (!authGap) {
        throw new Error(
          `tenants BFF 未预期: HTTP ${tenantsBff.status} ${JSON.stringify(tenantsBff.data)}`,
        );
      }

      const expectedMsg = authGap.message;
      const refreshBtn = page.locator('.shared-toolbar button, .page-detail-section-toolbar button').filter({
        has: page.locator('.anticon-reload'),
      }).first();
      await refreshBtn.click({ timeout: 10000 }).catch(() => {});

      const errorOnPage = page.getByText(expectedMsg).or(page.getByText(/登录状态已过期/)).first();
      await expect(errorOnPage).toBeVisible({ timeout: 15000 });

      const rowCount = await page.locator('tr.ant-table-row').count();
      if (rowCount > 0) {
        throw new Error(
          `auth-gap 场景下不应展示租户数据行，但表格有 ${rowCount} 行；BFF: ${expectedMsg}`,
        );
      }

      console.warn(`[CSM E2E] 浏览器已看到 auth-gap 提示: ${expectedMsg}`);
      console.log(
        JSON.stringify(
          {
            cloudId,
            url,
            bffStatus: authGap.status,
            message: expectedMsg,
            view: 'auth-gap-error',
            ok: true,
          },
          null,
          2,
        ),
      );
    });
  });
});
