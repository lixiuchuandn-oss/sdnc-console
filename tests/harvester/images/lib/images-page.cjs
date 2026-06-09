const fs = require('fs');
const path = require('path');
const { webBase } = require('../../../shared/load-env.cjs');

/** 浏览器/API 本地上传镜像路径（须在 tests/.env 配置 TOWER_IMAGE_FILE_PATH） */
function imageUploadFilePath() {
  const fromEnv = String(process.env.TOWER_IMAGE_FILE_PATH || '').trim();
  if (!fromEnv) {
    throw new Error(
      '未配置本地上传镜像：请在 tests/.env 设置 TOWER_IMAGE_FILE_PATH（例如 D:\\网元镜像\\ubuntu_4_0_20.04_x86_1000G.qcow2）',
    );
  }
  return fromEnv;
}

function inferImageStemFromFilePath(filePath) {
  const base = path.basename(String(filePath || ''));
  return base.replace(/\.[^.\\/]+$/, '') || base || 'image';
}

function inferImageStemFromUrl(url) {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const u = new URL(normalized);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last.replace(/\.[^.\\/]+$/, '') || last || 'image';
  } catch {
    const seg = String(url || '').split('/').filter(Boolean).pop() || '';
    return seg.replace(/\.[^.\\/]+$/, '') || seg || 'image';
  }
}

/** 每次运行生成唯一展示名，避免与历史镜像冲突 */
function generateUniqueImageDisplayName(baseStem) {
  const prefix = String(process.env.TOWER_IMAGE_NAME_PREFIX || 'tower-e2e').trim() || 'tower-e2e';
  const stem = String(baseStem || 'image')
    .replace(/\.[^.\\/]+$/, '')
    .replace(/[^\w.\-+]/g, '_')
    .trim()
    .slice(0, 48) || 'image';
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stem}-${ts}${rand}`;
}

function defaultImageDisplayName(filePath) {
  return generateUniqueImageDisplayName(inferImageStemFromFilePath(filePath));
}

function uploadDrawerTimeoutMs(filePath) {
  const fromEnv = Number(process.env.TOWER_IMAGE_UPLOAD_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    size = 0;
  }
  // 大文件（如本地 qcow2）默认 30 分钟；小文件保持 5 分钟
  if (size > 50 * 1024 * 1024) return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

function imageSyncPollTimeoutMs() {
  const fromEnv = Number(process.env.TOWER_IMAGE_SYNC_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 60 * 60 * 1000;
}

function imageImportUrl() {
  return String(process.env.TOWER_IMAGE_IMPORT_URL || '').trim();
}

function defaultUrlImportDisplayName(url) {
  return generateUniqueImageDisplayName(inferImageStemFromUrl(url));
}

/** 管理员 URL 导入（full 弹窗 → URL 导入 Tab → 创建） */
async function browserUrlImportImage(page, opts = {}) {
  const url = String(opts.url || imageImportUrl()).trim();
  if (!url) throw new Error('missing TOWER_IMAGE_IMPORT_URL');
  if (!/^https?:\/\//i.test(url)) throw new Error('TOWER_IMAGE_IMPORT_URL must start with http:// or https://');

  const displayName = String(opts.displayName || defaultUrlImportDisplayName(url)).trim();
  if (!displayName) throw new Error('missing display name for URL import');

  await page.getByRole('button', { name: '新增镜像' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '新增镜像' });
  await modal.waitFor();
  await modal.getByRole('tab', { name: 'URL 导入' }).click();

  const nameInput = modal.locator('input#displayName, input[placeholder*="qcow2"]').first();
  await nameInput.waitFor({ timeout: 10000 });

  const urlInput = modal.locator('input[placeholder*="http"]').first();
  await urlInput.fill(url);
  // 始终写入唯一展示名，避免 URL 失焦自动填充与历史镜像重名
  await nameInput.fill(displayName);
  await page.waitForTimeout(300);

  await modal.getByRole('button', { name: '创 建' }).click().catch(async () => {
    await modal.getByRole('button', { name: '创建' }).click();
  });

  await page.locator('.ant-message-success, .ant-message-notice-success').filter({ hasText: /创建成功/ }).first().waitFor({
    timeout: Number(opts.createTimeoutMs) || 120000,
  });
  await modal.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  return { url, displayName };
}
async function openImagesPage(page, cloudId) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/compute/images`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}
async function browserUploadImage(page, filePath, displayName, opts = {}) {
  const drawerTimeout = opts.drawerTimeoutMs ?? uploadDrawerTimeoutMs(filePath);
  await page.getByRole('button', { name: '新增镜像' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '新增镜像' });
  await modal.waitFor();
  await modal.getByRole('tab', { name: '浏览器上传' }).click();
  await modal.locator('input[type=file]').setInputFiles(filePath);
  await page.waitForTimeout(800);
  if (displayName && (await modal.locator('#toolDisplayName').count())) {
    await modal.locator('#toolDisplayName').clear().catch(() => {});
    await modal.locator('#toolDisplayName').fill(displayName);
  }
  await modal.getByRole('button', { name: '提交任务' }).click();
  const drawer = page.locator('.ant-drawer').filter({ hasText: '镜像上传任务' });
  try {
    await drawer.waitFor({ timeout: 15000 });
  } catch {
    await page.getByRole('button', { name: '上传任务' }).click();
    await drawer.waitFor({ timeout: 15000 });
  }
  await drawer.locator('.ant-progress, .ant-tag, .ant-typography').first().waitFor({ timeout: 60000 });
  await drawer
    .getByText(/文件已上传至|待同步|上传中|分片|已上传|平台/)
    .first()
    .waitFor({ timeout: drawerTimeout });
}
async function searchImageRow(page, displayName, opts = {}) {
  const requirePendingSync = opts.requirePendingSync !== false;
  const reload = page.locator('.anticon-reload').locator('xpath=ancestor::button[1]').first();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await reload.click({ timeout: 3000 }).catch(() => {});
    await page.getByPlaceholder('名称/项目').fill(displayName);
    await page.waitForTimeout(2000);
    const row = page.locator('tr.ant-table-row').filter({ hasText: displayName }).first();
    if (await row.count()) {
      await row.waitFor({ timeout: 5000 });
      if (requirePendingSync) {
        const text = await row.innerText();
        if (!/待同步/.test(text)) continue;
      }
      return row;
    }
  }
  throw new Error(`image row not found: ${displayName}`);
}
async function syncImageRow(page, row, displayName) {
  const reload = page.locator('.anticon-reload').locator('xpath=ancestor::button[1]').first();
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('.ant-drawer-mask').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await row.scrollIntoViewIfNeeded();
    await row.locator('.row-actions-trigger').first().click({ force: true });
    await page.waitForTimeout(500);
    const syncItem = page.locator('.ant-dropdown-menu-item').filter({ hasText: /^同步$/ });
    if (await syncItem.count()) {
      await syncItem.first().click({ force: true });
      return;
    }
    await page.keyboard.press('Escape');
    await reload.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(3000);
    row = page.locator('tr.ant-table-row').filter({ hasText: displayName }).first();
  }
  throw new Error(`sync action not available for: ${displayName}`);
}
const IMAGE_UI_STATUS_LABELS = [
  '已就绪',
  '失败',
  '下载中',
  '导入中',
  '同步中',
  '上传中',
  '待同步',
  '导出中',
  '已取消',
  '未知',
  '等待',
  '已导入',
];

function pickImageUiStatusLabel(rowText) {
  const text = String(rowText || '');
  for (const label of IMAGE_UI_STATUS_LABELS) {
    if (text.includes(label)) return label;
  }
  return null;
}

async function refreshImageRow(page, displayName) {
  const reload = page.locator('.anticon-reload').locator('xpath=ancestor::button[1]').first();
  await reload.click({ timeout: 3000 }).catch(() => {});
  await page.getByPlaceholder('名称/项目').fill(displayName);
  await page.waitForTimeout(2000);
  const row = page.locator('tr.ant-table-row').filter({ hasText: displayName }).first();
  if (!(await row.count())) return { row: null, text: '' };
  return { row, text: await row.innerText().catch(() => '') };
}

async function pollImageRowStatus(page, displayName, timeoutMs = imageSyncPollTimeoutMs()) {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  const history = [];
  while (Date.now() < deadline) {
    const snap = await refreshImageRow(page, displayName);
    lastText = snap.text;
    const uiStatus = pickImageUiStatusLabel(lastText);
    if (uiStatus && (history.length === 0 || history[history.length - 1].uiStatus !== uiStatus)) {
      history.push({ at: new Date().toISOString(), uiStatus });
    }
    if (/已就绪/.test(lastText)) return { ok: true, lastText, history, uiStatus: '已就绪' };
    if (/失败/.test(lastText) && !/待同步|同步中/.test(lastText)) {
      return { ok: false, lastText, history, uiStatus: uiStatus || '失败', failed: true };
    }
    await page.waitForTimeout(5000);
  }
  return { ok: false, lastText, history, timeout: true };
}

/**
 * URL 导入状态校验：须经历进行中状态（下载中/导入中等），最终已就绪。
 */
async function pollImageUrlImportStatus(page, displayName, timeoutMs = imageSyncPollTimeoutMs(), opts = {}) {
  const inProgressRe = /下载中|导入中|同步中|上传中|等待|导出中/;
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  const history = [];
  let sawInProgress = Boolean(opts.initialSawInProgress);

  while (Date.now() < deadline) {
    const snap = await refreshImageRow(page, displayName);
    lastText = snap.text;
    if (!lastText) {
      await page.waitForTimeout(5000);
      continue;
    }

    const uiStatus = pickImageUiStatusLabel(lastText);
    if (inProgressRe.test(lastText)) sawInProgress = true;
    if (uiStatus && (history.length === 0 || history[history.length - 1].uiStatus !== uiStatus)) {
      history.push({ at: new Date().toISOString(), uiStatus });
    }

    if (/已就绪/.test(lastText)) {
      if (!sawInProgress) {
        return {
          ok: false,
          lastText,
          history,
          uiStatus: '已就绪',
          sawInProgress: false,
          reason: 'never saw in-progress status (download/import); image may already exist',
        };
      }
      return { ok: true, lastText, history, uiStatus: '已就绪', sawInProgress: true };
    }
    if (/失败/.test(lastText) && !/待同步|同步中/.test(lastText)) {
      return { ok: false, lastText, history, uiStatus: uiStatus || '失败', sawInProgress, failed: true };
    }
    await page.waitForTimeout(5000);
  }
  return { ok: false, lastText, history, sawInProgress, timeout: true };
}
module.exports = {
  imageUploadFilePath,
  generateUniqueImageDisplayName,
  inferImageStemFromFilePath,
  inferImageStemFromUrl,
  defaultImageDisplayName,
  uploadDrawerTimeoutMs,
  imageSyncPollTimeoutMs,
  openImagesPage,
  browserUploadImage,
  searchImageRow,
  syncImageRow,
  pollImageRowStatus,
  imageImportUrl,
  defaultUrlImportDisplayName,
  browserUrlImportImage,
  pollImageUrlImportStatus,
  pickImageUiStatusLabel,
  refreshImageRow,
};