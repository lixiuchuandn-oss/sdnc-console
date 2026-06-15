const { attachment, step } = require('allure-js-commons');

async function attachScreenshot(page, name) {
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return;
  const buffer = await page.screenshot({ fullPage: true }).catch(() => null);
  if (buffer) {
    await attachment(name, buffer, 'image/png');
  }
}

async function allureStep(page, name, fn) {
  return step(name, async () => {
    try {
      const result = await fn();
      await attachScreenshot(page, `${name} — 截图`);
      return result;
    } catch (err) {
      await attachScreenshot(page, `${name} — 失败截图`);
      throw err;
    }
  });
}

module.exports = { allureStep, attachScreenshot };
