/**
 * Manual: database, VNE, logging, settings, tenants, VM recycle bin.
 */
const {
  runManualCapture,
  openPoolPage,
  openAdminPage,
  shot,
  modal,
  clickTableRowMenu,
} = require('./manual-capture-helpers.cjs');

async function captureDatabase(page, cloudId) {
  const SUBDIR = 'ch03-database';
  await openPoolPage(page, cloudId, 'paas_databases/rds', { waitButton: '创建实例' });
  await shot(page, 'rds-list.png', { subdir: SUBDIR });
  await page.getByRole('button', { name: '创建实例' }).click().catch(() => {});
  const m = modal(page, '实例');
  if (await m.isVisible().catch(() => false)) {
    await shot(page, 'rds-create-modal.png', { subdir: SUBDIR, locator: m });
    await page.keyboard.press('Escape');
  }
}

async function captureVne(page, cloudId) {
  const SUBDIR = 'ch03-vne';
  await openPoolPage(page, cloudId, 'oniaas_network/virtual_routers', { waitButton: '创建实例' });
  await shot(page, 'vrouter-list.png', { subdir: SUBDIR });
  await page.getByRole('button', { name: '创建实例' }).click().catch(() => {});
  const m = modal(page, '实例');
  if (await m.isVisible().catch(() => false)) {
    await shot(page, 'vrouter-create-modal.png', { subdir: SUBDIR, locator: m });
    await page.keyboard.press('Escape');
  }

  await openPoolPage(page, cloudId, 'oniaas_network/slb', { waitButton: '创建负载均衡' });
  await shot(page, 'slb-list.png', { subdir: SUBDIR });
  await page.getByRole('button', { name: '创建负载均衡' }).click().catch(() => {});
  const slbModal = modal(page, '负载均衡');
  if (await slbModal.isVisible().catch(() => false)) {
    await shot(page, 'slb-create-modal.png', { subdir: SUBDIR, locator: slbModal });
    await page.keyboard.press('Escape');
  }
}

async function captureLogging(page, cloudId) {
  const SUBDIR = 'ch03-logging';
  const pages = [
    { path: 'logs_config/logs-target', file: 'logs-targets-list.png' },
    { path: 'logs_config/log-outputs', file: 'log-outputs-list.png' },
    { path: 'logs_config/logs-flow-config', file: 'logs-flow-list.png' },
  ];
  for (const p of pages) {
    await openPoolPage(page, cloudId, p.path);
    await shot(page, p.file, { subdir: SUBDIR });
  }
}

async function captureSettings(page) {
  const SUBDIR = 'ch04-settings';
  await openAdminPage(page, 'access/roles', { waitText: '角色' });
  await shot(page, 'roles.png', { subdir: SUBDIR });
  const permOpened = await clickTableRowMenu(page, '配置权限', { maxRows: 10 }).catch(() => false);
  if (!permOpened) {
    await clickTableRowMenu(page, '查看权限', { maxRows: 10 }).catch(() => {});
  }
  const permDrawer = page.locator('.ant-drawer').last();
  if (await permDrawer.isVisible().catch(() => false)) {
    await page.waitForTimeout(800);
    await shot(page, 'roles.png', { subdir: SUBDIR });
    await page.keyboard.press('Escape');
  }

  await openAdminPage(page, 'access/users', { waitButton: '新建系统用户' });
  await shot(page, 'users.png', { subdir: SUBDIR });
}

async function captureTenants(page) {
  const SUBDIR = 'ch05-tenants';
  await openAdminPage(page, 'tenants', { waitText: '租户' });
  await shot(page, 'tenants.png', { subdir: SUBDIR });

  await openAdminPage(page, 'tenants/users', { waitText: '组织' });
  await shot(page, 'org-users.png', { subdir: SUBDIR });
}

async function captureRecycleBin(page, cloudId) {
  await openPoolPage(page, cloudId, 'compute/recycle_bin');
  await shot(page, 'vm-recycle-bin.png', { subdir: 'ch03-vm' });
}

async function main() {
  await runManualCapture(async (page, cloudId) => {
    await captureDatabase(page, cloudId);
    await captureVne(page, cloudId);
    await captureLogging(page, cloudId);
    await captureRecycleBin(page, cloudId);
    await captureSettings(page);
    await captureTenants(page);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
