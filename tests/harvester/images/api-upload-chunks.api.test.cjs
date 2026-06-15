const fs = require('fs');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { imageNamespace } = require('../../shared/load-env.cjs');
const { imageUploadFilePath } = require('./lib/images-page.cjs');
const { uploadAllChunksFromFile } = require('./lib/chunk-upload.cjs');
const {
  completeChunks,
  cleanupTowerE2eUploadTasks,
  createUploadTaskWithRetry,
  deleteUploadTask,
  getUploadTask,
  putChunk,
} = require('./lib/images-api.cjs');

const prefix = process.env.TOWER_IMAGE_TASK_PREFIX || 'tower-e2e-chunk';
const displayName = `${prefix}-${Date.now()}`;

(async () => {
  const filePath = imageUploadFilePath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`upload file not found: ${filePath}`);
  }
  const fileSize = fs.statSync(filePath).size;
  if (fileSize < 1024 * 1024) {
    throw new Error('upload file must be >= 1MiB for chunk upload tests');
  }

  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const namespace = imageNamespace;

  await cleanupTowerE2eUploadTasks(token, cloudId, prefix);

  const chunkSize = Math.min(5 * 1024 * 1024, fileSize);
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
  const task = created.data;

  const badChunk = await putChunk(token, cloudId, taskId, 0, Buffer.alloc(16));
  if (badChunk.status !== 400) {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(`expected wrong chunk size → 400, got ${badChunk.status}`);
  }

  const uploadResult = await uploadAllChunksFromFile(token, cloudId, task, filePath);
  if (uploadResult.completed.status !== 200) {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(uploadResult.completed.message || `complete HTTP ${uploadResult.completed.status}`);
  }

  const got = await getUploadTask(token, cloudId, taskId);
  const taskStatus = String(got.data?.status || got.data?.taskStatus || '').toLowerCase();
  if (taskStatus !== 'uploaded') {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(`expected uploaded, got ${taskStatus || '(empty)'}`);
  }

  const delBlocked = await deleteUploadTask(token, cloudId, taskId, false);
  if (delBlocked.status !== 409) {
    await deleteUploadTask(token, cloudId, taskId, true).catch(() => {});
    throw new Error(`expected delete uploaded without force → 409, got ${delBlocked.status}`);
  }

  const deleted = await deleteUploadTask(token, cloudId, taskId, true);
  if (deleted.status !== 200) throw new Error(deleted.message || `force delete HTTP ${deleted.status}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        displayName,
        fileSize,
        chunkSize,
        chunksUploaded: uploadResult.uploaded.length,
        taskStatus,
        delBlockedStatus: delBlocked.status,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
