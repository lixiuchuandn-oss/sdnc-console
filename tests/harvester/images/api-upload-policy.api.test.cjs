const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { imageNamespace } = require('../../shared/load-env.cjs');
const {
  cancelUploadTask,
  cleanupTowerE2eUploadTasks,
  createUploadTaskWithRetry,
  deleteUploadTask,
  putChunk,
} = require('./lib/images-api.cjs');

const prefix = process.env.TOWER_IMAGE_TASK_PREFIX || 'tower-e2e-policy';
const displayName = `${prefix}-${Date.now()}`;

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const namespace = imageNamespace;
  const fileSize = 2 * 1024 * 1024;
  const chunkSize = 1024 * 1024;

  await cleanupTowerE2eUploadTasks(token, cloudId, prefix);

  const created = await createUploadTaskWithRetry(token, cloudId, {
    namespace,
    displayName,
    imageType: 'iso',
    filename: `${displayName}.iso`,
    fileSize,
    chunkSize,
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(created.message || `create HTTP ${created.status}`);
  }
  const taskId = String(created.data?.id || '');

  const delPending = await deleteUploadTask(token, cloudId, taskId, false);
  if (delPending.status !== 409) {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(`expected delete pending → 409, got ${delPending.status}`);
  }

  const chunk = Buffer.alloc(chunkSize);
  const put = await putChunk(token, cloudId, taskId, 0, chunk);
  if (put.status !== 200) {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(put.data?.message || `put chunk HTTP ${put.status}`);
  }

  const cancelled = await cancelUploadTask(token, cloudId, taskId);
  if (cancelled.status !== 200) {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(cancelled.message || `cancel HTTP ${cancelled.status}`);
  }

  const putAfterCancel = await putChunk(token, cloudId, taskId, 1, chunk);
  if (putAfterCancel.status !== 409) {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(`expected put after cancel → 409, got ${putAfterCancel.status}`);
  }

  const deleted = await deleteUploadTask(token, cloudId, taskId, true);
  if (deleted.status !== 200) throw new Error(deleted.message || `force delete HTTP ${deleted.status}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        displayName,
        delPendingStatus: delPending.status,
        cancelStatus: cancelled.status,
        putAfterCancelStatus: putAfterCancel.status,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
