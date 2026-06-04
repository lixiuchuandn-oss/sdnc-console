const path = require('path');
const { webBase } = require('../../../shared/load-env.cjs');
function demoIsoPath() {
  if (process.env.TOWER_DEMO_ISO_PATH) return process.env.TOWER_DEMO_ISO_PATH;
  const size = (process.env.TOWER_DEMO_ISO_SIZE || '2m').replace(/\./g, '_');
  return path.join(__dirname, '..', 'fixtures', '.tmp', `tower-demo-${size}.iso`);
}
async function openImagesPage(page, cloudId) {
  await page.goto(`${webBase}/admin/clouds/${cloudId}/compute/images`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}
async function browserUploadImage(page, filePath, displayName) {
  await page.getByRole('button', { name: '新增镜像' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '新增镜像' });
  await modal.waitFor();
  await modal.getByRole('tab', { name: '浏览器上传' }).click();
  await modal.locator('input[type=file]').setInputFiles(filePath);
  await page.waitForTimeout(800);
  if (displayName && (await modal.locator('#toolDisplayName').count())) {
    await modal.locator('#toolDisplayName').fill(displayName);
  }
  await modal.getByRole('button', { name: '提交任务' }).click();
  const drawer = page.locator('.ant-drawer').filter({ hasText: '镜像上传任务' });
  await drawer.waitFor();
  await drawer.getByText(/文件已上传至 Tower|待同步/).first().waitFor({ timeout: 180000 });
}
async function searchImageRow(page, displayName) {
  await page.getByPlaceholder('名称/项目').fill(displayName);
  await page.waitForTimeout(2000);
  const row = page.locator('tr.ant-table-row').filter({ hasText: displayName }).first();
  await row.waitFor({ timeout: 60000 });
  return row;
}
async function syncImageRow(page, row) {
  await row.locator('.row-actions-trigger').first().click();
  await page.getByRole('menuitem', { name: '同步' }).click();
}
async function pollImageRowStatus(page, displayName, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  while (Date.now() < deadline) {
    await page.locator('.anticon-reload').locator('xpath=ancestor::button[1]').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(5000);
    lastText = await page.locator('tr.ant-table-row').filter({ hasText: displayName }).first().innerText().catch(() => '');
    if (/已就绪/.test(lastText)) return { ok: true, lastText };
    if (/失败/.test(lastText) && !/待同步|同步中/.test(lastText)) return { ok: false, lastText };
  }
  return { ok: false, lastText, timeout: true };
}
module.exports = { demoIsoPath, openImagesPage, browserUploadImage, searchImageRow, syncImageRow, pollImageRowStatus };