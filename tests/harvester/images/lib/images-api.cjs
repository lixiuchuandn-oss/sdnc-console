const { apiBase } = require('../../../shared/load-env.cjs');
const { towerApi } = require('../../../shared/tower-api.cjs');

const ALLOWED_LIST_STATE_KEYS = new Set([
  'ready',
  'syncing',
  'uploading',
  'pending_sync',
  'failed',
  'cancelled',
  'importing',
  'downloading',
  'exporting',
  'unknown',
]);

function imagesPath(cloudId, suffix = '') {
  return `/api/clouds/${cloudId}/resources/harvester/images${suffix}`;
}

async function towerApiBinary(method, path, bodyBuffer, token) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: bodyBuffer,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function fetchImages(token, cloudId, query = '') {
  const qs = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  const { status, data } = await towerApi('GET', imagesPath(cloudId, qs), null, token);
  return { status, items: data?.data?.items || data?.items || [], raw: data };
}

async function fetchImageDetail(token, cloudId, namespace, name) {
  const { status, data } = await towerApi(
    'GET',
    imagesPath(cloudId, `/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function createImage(token, cloudId, body) {
  const { status, data } = await towerApi('POST', imagesPath(cloudId), body, token);
  return { status, data: data?.data || data, message: data?.message };
}

async function deleteImage(token, cloudId, namespace, name) {
  const { status, data } = await towerApi(
    'DELETE',
    imagesPath(cloudId, `/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function diskCheckUpload(token, cloudId, fileSize, chunkSize) {
  const qs = new URLSearchParams({
    fileSize: String(fileSize),
    ...(chunkSize ? { chunkSize: String(chunkSize) } : {}),
  });
  const { status, data } = await towerApi(
    'GET',
    imagesPath(cloudId, `/upload-tasks/disk-check?${qs}`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function createUploadTask(token, cloudId, body) {
  const { status, data } = await towerApi('POST', imagesPath(cloudId, '/upload-tasks'), body, token);
  return { status, data: data?.data || data, message: data?.message, code: data?.code };
}

async function listUploadTasks(token, cloudId, limit) {
  const qs = limit ? `?limit=${limit}` : '';
  const { status, data } = await towerApi('GET', imagesPath(cloudId, `/upload-tasks${qs}`), null, token);
  return { status, items: data?.data?.items || data?.items || [], raw: data };
}

async function getUploadTask(token, cloudId, taskId) {
  const { status, data } = await towerApi(
    'GET',
    imagesPath(cloudId, `/upload-tasks/${encodeURIComponent(taskId)}`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function deleteUploadTask(token, cloudId, taskId, force = false) {
  const qs = force ? '?force=true' : '';
  const { status, data } = await towerApi(
    'DELETE',
    imagesPath(cloudId, `/upload-tasks/${encodeURIComponent(taskId)}${qs}`),
    null,
    token,
  );
  return { status, message: data?.message, code: data?.code };
}

async function cancelUploadTask(token, cloudId, taskId) {
  const { status, data } = await towerApi(
    'POST',
    imagesPath(cloudId, `/upload-tasks/${encodeURIComponent(taskId)}/cancel`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function listChunks(token, cloudId, taskId) {
  const { status, data } = await towerApi(
    'GET',
    imagesPath(cloudId, `/upload-tasks/${encodeURIComponent(taskId)}/chunks`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function putChunk(token, cloudId, taskId, index, chunkBuffer) {
  return towerApiBinary(
    'PUT',
    imagesPath(cloudId, `/upload-tasks/${encodeURIComponent(taskId)}/chunks/${index}`),
    chunkBuffer,
    token,
  );
}

async function completeChunks(token, cloudId, taskId) {
  const { status, data } = await towerApi(
    'POST',
    imagesPath(cloudId, `/upload-tasks/${encodeURIComponent(taskId)}/complete-chunks`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message, code: data?.code };
}

async function syncUploadTask(token, cloudId, taskId) {
  const { status, data } = await towerApi(
    'POST',
    imagesPath(cloudId, `/upload-tasks/${encodeURIComponent(taskId)}/sync`),
    null,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function uploadToken(token, cloudId, body) {
  const { status, data } = await towerApi('POST', imagesPath(cloudId, '/upload-token'), body, token);
  return { status, data: data?.data || data, message: data?.message };
}

async function fetchHarvesterNamespaces(token, cloudId, excludeSystem = true) {
  const qs = excludeSystem ? '?excludeSystem=true' : '';
  const { status, data } = await towerApi(
    'GET',
    `/api/clouds/${cloudId}/resources/harvester/namespaces${qs}`,
    null,
    token,
  );
  return { status, items: data?.data?.items || data?.items || [], raw: data };
}

function assertImageListItemShape(item) {
  const name = String(item?.metadata?.name || item?.name || '').trim();
  if (!name) throw new Error('image list item missing metadata.name');
  const listStateKey = String(item?.listStateKey || '').trim().toLowerCase();
  if (!listStateKey) throw new Error(`image ${name} missing listStateKey`);
  if (!ALLOWED_LIST_STATE_KEYS.has(listStateKey)) {
    throw new Error(`image ${name} has unexpected listStateKey: ${listStateKey}`);
  }
  return { name, listStateKey, namespace: item?.metadata?.namespace || item?.namespace };
}

function getImageListDisplayName(item) {
  const meta = item?.metadata || {};
  const labels = meta.labels || {};
  const spec = item?.spec || {};
  return String(
    item?.displayName || spec.displayName || labels['harvesterhci.io/imageDisplayName'] || '',
  ).trim();
}

function findImageListItemByDisplayName(items, displayName) {
  const kw = String(displayName || '').trim().toLowerCase();
  if (!kw) return null;
  return (Array.isArray(items) ? items : []).find((item) => {
    const dn = getImageListDisplayName(item).toLowerCase();
    const imageName = String(item?.metadata?.name || item?.name || '').toLowerCase();
    return dn === kw || dn.includes(kw) || imageName.includes(kw);
  });
}

/** URL/下载导入终态：listStateKey=ready；进行中须为 downloading/importing/syncing 等 */
function assertUrlImportImageStatus(item, expectReady = true) {
  const shape = assertImageListItemShape(item);
  const sourceType = String(item?.sourceType || item?.spec?.sourceType || '').toLowerCase();
  if (expectReady && shape.listStateKey !== 'ready') {
    throw new Error(
      `expected listStateKey ready, got ${shape.listStateKey} (sourceType=${sourceType || '-'})`,
    );
  }
  return { ...shape, sourceType: sourceType || undefined, displayName: getImageListDisplayName(item) };
}

const URL_IMPORT_IN_PROGRESS_STATE_KEYS = new Set([
  'downloading',
  'importing',
  'syncing',
  'uploading',
  'exporting',
  'unknown',
]);

async function deleteUploadTasksByDisplayPrefix(token, cloudId, prefix) {
  const { status, items } = await listUploadTasks(token, cloudId);
  if (status !== 200) return [];
  const list = Array.isArray(items) ? items : [];
  const removed = [];
  for (const t of list) {
    const label = String(t?.displayName || t?.filename || '');
    if (!label.startsWith(prefix) && !label.includes('tower-e2e')) continue;
    const id = String(t?.id || '');
    if (!id) continue;
    const del = await deleteUploadTask(token, cloudId, id, true);
    if (del.status === 200) removed.push(id);
  }
  return removed;
}

/** 释放全局上传槽：强制删除 tower-e2e 任务，以及占用互斥槽的 pending/ingesting/proxying 任务 */
async function cleanupTowerE2eUploadTasks(token, cloudId, prefix = 'tower-e2e') {
  const { status, items } = await listUploadTasks(token, cloudId);
  if (status !== 200) return [];
  const blocking = new Set(['pending', 'ingesting', 'proxying']);
  const removed = [];
  for (const t of Array.isArray(items) ? items : []) {
    const label = String(t?.displayName || t?.filename || '');
    const st = String(t?.status || t?.taskStatus || '').toLowerCase();
    const id = String(t?.id || '');
    if (!id) continue;
    const e2e = label.includes(prefix);
    if (!e2e && !blocking.has(st)) continue;
    if (st === 'pending' || st === 'ingesting') {
      await cancelUploadTask(token, cloudId, id).catch(() => {});
    }
    const del = await deleteUploadTask(token, cloudId, id, true);
    if (del.status === 200) removed.push(id);
  }
  return removed;
}

async function createUploadTaskWithRetry(token, cloudId, body, prefix = 'tower-e2e') {
  let r = await createUploadTask(token, cloudId, body);
  if (r.status === 409 && r.code === 'IMAGE_UPLOAD_GLOBAL_BUSY') {
    const busyId = String(r.data?.taskId || '');
    if (busyId) await deleteUploadTask(token, cloudId, busyId, true).catch(() => {});
    await cleanupTowerE2eUploadTasks(token, cloudId, prefix);
    r = await createUploadTask(token, cloudId, body);
  }
  return r;
}

module.exports = {
  ALLOWED_LIST_STATE_KEYS,
  URL_IMPORT_IN_PROGRESS_STATE_KEYS,
  assertImageListItemShape,
  assertUrlImportImageStatus,
  findImageListItemByDisplayName,
  getImageListDisplayName,
  cancelUploadTask,
  cleanupTowerE2eUploadTasks,
  completeChunks,
  createImage,
  createUploadTask,
  createUploadTaskWithRetry,
  deleteImage,
  deleteUploadTask,
  deleteUploadTasksByDisplayPrefix,
  diskCheckUpload,
  fetchHarvesterNamespaces,
  fetchImageDetail,
  fetchImages,
  getUploadTask,
  listChunks,
  listUploadTasks,
  putChunk,
  syncUploadTask,
  uploadToken,
};
