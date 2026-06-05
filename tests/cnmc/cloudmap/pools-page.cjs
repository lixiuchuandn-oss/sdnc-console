async function openPoolsListPage(page, webBase) {
  await page.goto(`${webBase}/admin/clouds`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '\u65b0\u589e\u8d44\u6e90\u6c60' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
}

module.exports = { openPoolsListPage };