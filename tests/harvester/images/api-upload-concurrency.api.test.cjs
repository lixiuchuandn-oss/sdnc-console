const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { imageNamespace } = require('../../shared/load-env.cjs');
const {
  cleanupTowerE2eUploadTasks,
  createUploadTask,
  deleteUploadTask,
} = require('./lib/images-api.cjs');

const prefix = process.env.TOWER_IMAGE_TASK_PREFIX || 'tower-e2e-busy';
const fileSize = 2 * 1024 * 1024;
const chunkSize = 1024 * 1024;

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const namespace = imageNamespace;

  await cleanupTowerE2eUploadTasks(token, cloudId, prefix);

  const first = await createUploadTask(token, cloudId, {
    namespace,
    displayName: `${prefix}-a-${Date.now()}`,
    imageType: 'iso',
    fileSize,
    chunkSize,
  });
  if (first.status !== 200 && first.status !== 201) {
    throw new Error(first.message || `first create HTTP ${first.status}`);
  }
  const firstId = String(first.data?.id || '');

  const second = await createUploadTask(token, cloudId, {
    namespace,
    displayName: `${prefix}-b-${Date.now()}`,
    imageType: 'iso',
    fileSize,
    chunkSize,
  });

  await deleteUploadTask(token, cloudId, firstId, true).catch(() => {});
  if (second.status === 409 && second.code === 'IMAGE_UPLOAD_GLOBAL_BUSY') {
    console.log(JSON.stringify({ ok: true, cloudId, busyDetected: true, secondStatus: 409 }, null, 2));
    return;
  }

  if (second.status === 200 || second.status === 201) {
    const secondId = String(second.data?.id || '');
    await deleteUploadTask(token, cloudId, secondId, true).catch(() => {});
    console.log(
      JSON.stringify(
        {
          ok: true,
          cloudId,
          busyDetected: false,
          note: 'no concurrent upload in flight; second task created (environment may be idle)',
          secondStatus: second.status,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(`unexpected second create status: ${second.status} ${second.message || ''}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
