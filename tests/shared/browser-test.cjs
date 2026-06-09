const { description, epic, feature, label, severity, story } = require('allure-js-commons');
const { launchTowerBrowser, newMaximizedPage } = require('./playwright-browser.cjs');
const { allureStep, attachScreenshot } = require('./allure-step.cjs');

/** 写入 Allure 元数据（在用例文件内 test() 回调开头调用）。 */
async function applyAllureMeta(meta = {}) {
  if (meta.epic) await epic(meta.epic);
  if (meta.feature) await feature(meta.feature);
  if (meta.story) await story(meta.story);
  if (meta.description) await description(meta.description);
  await severity(meta.severity || 'normal');
  await label('testType', 'browser');
  await label('framework', 'playwright');
}

/** 启动 Tower 浏览器并在结束时关闭；失败时附加全页截图。 */
async function runWithBrowser(fn) {
  const browser = await launchTowerBrowser();
  let page;
  try {
    ({ page } = await newMaximizedPage(browser));
    return await fn(page);
  } catch (err) {
    if (page) await attachScreenshot(page, '用例失败截图');
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { applyAllureMeta, runWithBrowser, allureStep };
