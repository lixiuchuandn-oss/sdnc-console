const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { imageNamespace } = require('../../shared/load-env.cjs');
const {
  createUploadTask,
  createUploadTaskWithRetry,
  deleteUploadTask,
  cleanupTowerE2eUploadTasks,
  diskCheckUpload,
  getUploadTask,
  listUploadTasks,
} = require('./lib/images-api.cjs');

const prefix = process.env.TOWER_IMAGE_TASK_PREFIX || 'tower-e2e-task';
const displayName = process.env.TOWER_IMAGE_DISPLAY_NAME || `${prefix}-${Date.now()}`;
const fileSize = Math.max(1024 * 1024, Number(process.env.TOWER_IMAGE_FILE_SIZE || 2 * 1024 * 1024));
const chunkSize = Number(process.env.TOWER_IMAGE_CHUNK_SIZE || 5 * 1024 * 1024);

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const namespace = imageNamespace;

  const cleaned = await cleanupTowerE2eUploadTasks(token, cloudId, prefix);

  const badCreate = await createUploadTask(token, cloudId, { namespace });
  if (badCreate.status === 200 || badCreate.status === 201) {
    await deleteUploadTask(token, cloudId, badCreate.data?.id, true).catch(() => {});
    throw new Error('expected create without fileSize to be rejected');
  }

  const badDisk = await diskCheckUpload(token, cloudId, 0);
  if (badDisk.status !== 400) {
    throw new Error(`expected disk-check fileSize=0 → 400, got ${badDisk.status}`);
  }

  const disk = await diskCheckUpload(token, cloudId, fileSize, chunkSize);
  if (disk.status !== 200) {
    throw new Error(disk.message || `disk-check HTTP ${disk.status}`);
  }

  const created = await createUploadTaskWithRetry(token, cloudId, {
    namespace,
    displayName,
    imageType: 'iso',
    filename: `${displayName}.iso`,
    fileSize,
    chunkSize,
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(created.message || `create task HTTP ${created.status}`);
  }
  const taskId = String(created.data?.id || '');
  if (!taskId) throw new Error('create task missing id');

  const got = await getUploadTask(token, cloudId, taskId);
  if (got.status !== 200) throw new Error(got.message || `get task HTTP ${got.status}`);
  if (String(got.data?.displayName || '') !== displayName) {
    throw new Error('get task displayName mismatch');
  }
  const taskStatus = String(got.data?.status || got.data?.taskStatus || '').toLowerCase();
  if (taskStatus !== 'pending') {
    throw new Error(`expected pending, got ${taskStatus || '(empty)'}`);
  }

  const listed = await listUploadTasks(token, cloudId);
  if (listed.status !== 200) throw new Error(`list tasks HTTP ${listed.status}`);
  const found = (Array.isArray(listed.items) ? listed.items : []).some((t) => String(t?.id) === taskId);
  if (!found) throw new Error('created task not in list');

  await cleanupTowerE2eUploadTasks(token, cloudId, prefix);
  const still = await getUploadTask(token, cloudId, taskId);
  if (still.status === 200) {
    throw new Error('task should be cleaned up after test');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        namespace,
        displayName,
        cleaned,
        badCreateStatus: badCreate.status,
        badDiskStatus: badDisk.status,
        diskSufficient: disk.data?.sufficient !== false,
        taskId,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
