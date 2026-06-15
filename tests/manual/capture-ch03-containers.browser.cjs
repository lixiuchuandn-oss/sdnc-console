/**
 * Manual ch03 section 10: container services main list pages + workload wizard.
 */
const {
  runManualCapture,
  openPoolPage,
  shot,
  modal,
} = require('./manual-capture-helpers.cjs');

const SUBDIR = 'ch03-containers';

const LIST_PAGES = [
  { path: 'containers/workloads', file: 'workloads-list.png', createBtn: '创建工作负载', modalTitle: '创建工作负载' },
  { path: 'containers/pods', file: 'pods-list.png' },
  { path: 'containers/jobs', file: 'jobs-list.png' },
  { path: 'containers/services', file: 'services-list.png' },
  { path: 'containers/ingresses', file: 'ingresses-list.png' },
  { path: 'containers/gateway_api', file: 'gateway-api-list.png' },
  { path: 'containers/service_topology', file: 'service-topology.png', delay: 2500 },
  { path: 'containers/pdbs', file: 'pdb-list.png' },
  { path: 'containers/networkpolicies', file: 'networkpolicies-list.png' },
  { path: 'containers/configs', file: 'configs-list.png' },
  { path: 'containers/registries', file: 'registries.png' },
];

const WIZARD_STEPS = ['基本信息', '容器配置', '网络配置', '存储配置', '高级配置'];

async function main() {
  await runManualCapture(async (page, cloudId) => {
    for (const p of LIST_PAGES) {
      await openPoolPage(page, cloudId, p.path, { delay: p.delay ?? 1500 });
      await shot(page, p.file, { subdir: SUBDIR });
    }

    await openPoolPage(page, cloudId, 'containers/workloads', { waitButton: '创建工作负载' });
    await page.getByRole('button', { name: '创建工作负载' }).click();
    const wizardModal = modal(page, '创建工作负载');
    await wizardModal.waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (await wizardModal.isVisible().catch(() => false)) {
      await shot(page, 'workload-create-wizard.png', { subdir: SUBDIR, locator: wizardModal });
      for (const label of WIZARD_STEPS.slice(1)) {
        const step = wizardModal.locator('.wizard-step').filter({ hasText: label });
        if ((await step.count()) > 0) {
          await step.click();
          await page.waitForTimeout(700);
        }
      }
      await shot(page, 'workload-create-wizard.png', { subdir: SUBDIR, locator: wizardModal });
      await page.keyboard.press('Escape');
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
