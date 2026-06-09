async function confirmHighRiskDelete(page, resourceName) {
  const modal = page.locator('.ant-modal').filter({ hasText: /确认删除/ });
  await modal.waitFor();
  const ack = modal.getByRole('checkbox');
  if (await ack.count()) await ack.check();
  const typeInput = modal.locator('input:not([type="checkbox"])').filter({ visible: true }).last();
  if (await typeInput.count()) await typeInput.fill(String(resourceName));
  await modal.getByRole('button', { name: /删\s*除/ }).click();
}

module.exports = { confirmHighRiskDelete };
