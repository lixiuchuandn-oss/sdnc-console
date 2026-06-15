const fs = require('fs');
const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  imageUploadFilePath,
  defaultImageDisplayName,
  openImagesPage,
  browserUploadImage,
  searchImageRow,
  syncImageRow,
  pollImageRowStatus,
} = require('./lib/images-page.cjs');

test('Harvester 镜像上传并同步', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '镜像', story: '上传+同步全流程' });
  const filePath = imageUploadFilePath();
    if (!fs.existsSync(filePath)) {
      throw new Error(`upload file not found: ${filePath}`);
    }
    const displayName = defaultImageDisplayName(filePath);
    const bytes = fs.statSync(filePath).size;
    if (bytes < 1024 * 1024) console.warn('file < 1MiB: sync may fail on Ceph/CDI');
    console.log(JSON.stringify({ filePath, displayName, bytes }, null, 2));

    const cloudId = await resolveCloudId(await towerLogin(), process.env.TOWER_CLOUD_ID);

    await runWithBrowser(async (page) => {
      await step(page, '管理员登录', async () => {
        await adminLoginPage(page, webBase, adminUser, adminPassword);
      });
      await step(page, '打开镜像列表', async () => {
        await openImagesPage(page, cloudId);
      });
      await step(page, '本地上传镜像', async () => {
        await browserUploadImage(page, filePath, displayName);
      });
      await step(page, '关闭上传抽屉', async () => {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);
      });
      const row = await step(page, '搜索已上传镜像', async () => searchImageRow(page, displayName));
      await step(page, '触发同步', async () => {
        await syncImageRow(page, row, displayName);
      });
      const result = await step(page, '轮询同步状态', async () => pollImageRowStatus(page, displayName));
      console.log(JSON.stringify({ cloudId, displayName, ...result }, null, 2));
      if (!result.ok) {
        throw new Error(result.failed ? `sync failed: ${result.uiStatus}` : `sync timeout: ${result.lastText}`);
      }
    });
});
