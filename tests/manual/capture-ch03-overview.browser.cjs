/**
 * Manual ch03 section 4: resource hub overview, datacenter & network topology.
 */
const {
  runManualCapture,
  openPoolPage,
  shot,
} = require('./manual-capture-helpers.cjs');

const SUBDIR = 'ch03-monitoring';

async function main() {
  await runManualCapture(async (page, cloudId) => {
    await openPoolPage(page, cloudId, 'resource_hub/overview');
    await shot(page, 'overview-cards.png', { subdir: SUBDIR });

    await openPoolPage(page, cloudId, 'resource_hub/datacenter_topology', { delay: 3000 });
    await shot(page, 'datacenter-rack.png', { subdir: SUBDIR });

    await openPoolPage(page, cloudId, 'resource_hub/network_topology', { delay: 3000 });
    await shot(page, 'network-topology.png', { subdir: SUBDIR });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
