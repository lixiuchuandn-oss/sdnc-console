async function openRowMenu(page, row) {
  await row.locator('.row-actions-trigger').first().click();
}

async function clickRowMenuItem(page, label) {
  await page.getByRole('menuitem', { name: label }).click();
}

module.exports = { openRowMenu, clickRowMenuItem };
