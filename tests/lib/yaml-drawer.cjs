async function waitYamlDrawerContains(page, snippets, timeoutMs = 60000) {
  const editor = page.locator('.resource-link-yaml-drawer__editor .cm-content').first();
  await editor.waitFor({ timeout: timeoutMs });
  const texts = Array.isArray(snippets) ? snippets : [snippets];
  await page.waitForFunction(
    (expected) => {
      const el = document.querySelector('.resource-link-yaml-drawer__editor .cm-content');
      const body = el?.innerText || document.body.innerText || '';
      return expected.every((t) => body.includes(t));
    },
    texts,
    { timeout: timeoutMs },
  );
}

async function closeYamlDrawer(page) {
  const drawer = page.locator('.ant-drawer').filter({ has: page.locator('.resource-link-yaml-drawer') });
  const closeBtn = drawer.locator('.ant-drawer-close, button').filter({ has: page.locator('.anticon-close') }).first();
  if (await closeBtn.count()) {
    await closeBtn.click();
    return;
  }
  await page.keyboard.press('Escape');
}

module.exports = { waitYamlDrawerContains, closeYamlDrawer };
