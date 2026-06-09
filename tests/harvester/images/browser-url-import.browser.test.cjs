const { test } = require('@playwright/test');
const { webBase, adminUser, adminPassword } = require('../../shared/load-env.cjs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { adminLoginPage } = require('../../shared/playwright-browser.cjs');
const { applyAllureMeta, runWithBrowser, allureStep: step } = require('../../shared/browser-test.cjs');
const {
  assertUrlImportImageStatus,
  fetchImages,
  findImageListItemByDisplayName,
  URL_IMPORT_IN_PROGRESS_STATE_KEYS,
} = require('./lib/images-api.cjs');
const {
  imageImportUrl,
  imageSyncPollTimeoutMs,
  openImagesPage,
  browserUrlImportImage,
  searchImageRow,
  pollImageUrlImportStatus,
  refreshImageRow,
  pickImageUiStatusLabel,
} = require('./lib/images-page.cjs');

async function assertApiStatusDuringImport(token, cloudId, displayName, uiHistory) {
  const list = await fetchImages(token, cloudId, 'skipSync=true');
  if (list.status !== 200) {
    throw new Error(list.raw?.message || `list images HTTP ${list.status}`);
  }
  const item = findImageListItemByDisplayName(list.items, displayName);
  if (!item) throw new Error(`API: image not found for displayName=${displayName}`);
  const listStateKey = String(item?.listStateKey || '').toLowerCase();
  const sourceType = String(item?.sourceType || item?.spec?.sourceType || '').toLowerCase();
  return {
    listStateKey,
    sourceType,
    uiHistory,
    inProgressKey: URL_IMPORT_IN_PROGRESS_STATE_KEYS.has(listStateKey),
  };
}

test('Harvester 镜像 URL 导入', async () => {
  await applyAllureMeta({ epic: 'Harvester', feature: '镜像', story: 'URL 导入' });
    const url = imageImportUrl();
    if (!url) {
      throw new Error('set TOWER_IMAGE_IMPORT_URL in tests/.env');
    }
    const token = await towerLogin();
    const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

    await runWithBrowser(async (page) => {
      await step(page, '管理员登录', async () => {
        await adminLoginPage(page, webBase, adminUser, adminPassword);
      });
      await step(page, '打开镜像列表', async () => {
        await openImagesPage(page, cloudId);
      });

      const created = await step(page, 'URL 导入创建镜像', async () => browserUrlImportImage(page, { url }));
      await step(page, '搜索导入中的镜像', async () => {
        await searchImageRow(page, created.displayName, { requirePendingSync: false });
      });

      const earlyApi = await assertApiStatusDuringImport(token, cloudId, created.displayName, []);
      const earlySnap = await refreshImageRow(page, created.displayName);
      const earlyUi = pickImageUiStatusLabel(earlySnap.text);
      const earlyUiInProgress = /下载中|导入中|同步中|上传中|等待|导出中/.test(earlySnap.text);
      const earlyApiInProgress = URL_IMPORT_IN_PROGRESS_STATE_KEYS.has(earlyApi.listStateKey);

      const poll = await step(page, '轮询 URL 导入状态（UI + API）', async () =>
        pollImageUrlImportStatus(page, created.displayName, imageSyncPollTimeoutMs(), {
          initialSawInProgress: earlyUiInProgress || earlyApiInProgress,
        }),
      );
      if (!poll.ok) {
        throw new Error(
          poll.reason || poll.failed
            ? `URL import failed: ui=${poll.uiStatus || '-'} text=${poll.lastText}`
            : `URL import status timeout: last=${poll.lastText}`,
        );
      }

      const list = await fetchImages(token, cloudId, 'skipSync=true');
      const item = findImageListItemByDisplayName(list.items, created.displayName);
      if (!item) throw new Error(`API: image missing after import: ${created.displayName}`);
      const apiFinal = assertUrlImportImageStatus(item, true);

      console.log(
        JSON.stringify(
          {
            ok: true,
            cloudId,
            url: created.url,
            displayName: created.displayName,
            statusCheck: {
              earlyUi,
              earlyApi,
              uiHistory: poll.history,
              finalUi: poll.uiStatus,
              finalApi: apiFinal,
            },
          },
          null,
          2,
        ),
      );
    });
});
