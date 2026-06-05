/**
 * 镜像上传代传管线：Tower → Harvester upload URL，并轮询集群导入进度。
 */
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { Request } from 'express';

import { AppDataSource } from '../../../../../config/database';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import {
  syncHarvesterImages,
  upsertHarvesterImageInventoryItems,
} from '../../../../../services/clouds/harvester/inventory';
import {
  fetchHarvesterVmImageDetailFromCluster,
  isHarvesterVmImageImportComplete,
  buildHarvesterVmImageDetailUrls,
  resolveHarvesterClusterApiRoots,
} from '../../../../../services/clouds/harvester/vmImageClusterApi';
import {
  resolveVmImageStorageProfile,
  buildHarvesterVmImageSpecFields,
  type VmImageStorageProfile,
} from '../../../../../services/clouds/harvester/client';
import {
  probeQcow2VirtualSizeFromPaths,
  resolveImageProxyUploadSizes,
} from '../../../../../services/clouds/harvester/qcow2VirtualSize';
import { getJsonOnce, requestJson } from '../../../../../services/clouds/harvester/utils';
import { harvesterNativeStreamUpload } from '../harvesterImageStreamUpload';
import { deleteVmImageCdiStorageOrphans } from '../imageUploadCdiCleanup';
import {
  attachImageUploadProxyRun,
  destroyImageUploadBodyReadable,
  getImageUploadInFlightTaskIds,
  hasImageUploadProxyRun,
  isUploadTaskTransferInFlight,
  registerImageUploadProxyEnd,
  registerImageUploadProxyStart,
  setImageUploadAbortController,
  trackImageUploadBodyReadable,
} from '../imageUploadRuntime';
import {
  bindClientDisconnectAbort,
  bindReadableAbortOnError,
  buildUploadTaskProgressPatchFromCluster,
  clampProgress,
  formatImageUploadTaskError,
  harvesterConn,
  harvesterVmImageImportSucceeded,
  harvesterVmImageUploadTerminalFailure,
  imageUploadTaskLog,
  isCancelError,
  isInternalTowerDbError,
  safeUpdateTaskProgress,
  throwIfUploadCancelled,
  updateTaskProgress,
  upsertVmImageDetailToInventory,
  vmImageHarvesterMetadataLikeUi,
} from './imageUploadTask.helpers';
import {
  markUploadTaskProxyingFromCluster,
  prepareClusterImageForUploadRetry,
  resolveUploadTaskAfterTowerProxyError,
} from './imageUploadTask.reconcile';
import {
  finalizeImageUploadTaskFilesCleanup,
  flushDeferredImageUploadCleanup,
  imageTaskMergedAbsPath,
  purgeImageUploadTaskStagingFiles,
  scheduleImageUploadTaskFilesCleanup,
} from './imageUploadTask.staging';

/** 磁盘文件或 HTTP 请求体 → Harvester 的统一字节源描述 */
export type ImageUploadBodySource = {
  byteTotal: number;
  preferredBasename?: string;
  createBodyReadable: () => Readable;
  unlinkPath?: string;
  onProxyComplete?: () => void | Promise<void>;
  bindRequestStream?: Readable;
};

export async function withImageUploadBodyReadable(
  taskId: string,
  abortController: AbortController,
  createReadable: () => Readable,
  run: (readable: Readable) => Promise<void>,
): Promise<void> {
  const readable = createReadable();
  trackImageUploadBodyReadable(taskId, readable);
  const onAbort = () => {
    try {
      if (!readable.destroyed) readable.destroy();
    } catch {
      /* ignore */
    }
  };
  abortController.signal.addEventListener('abort', onAbort);
  bindReadableAbortOnError(readable, abortController);
  try {
    await run(readable);
  } finally {
    abortController.signal.removeEventListener('abort', onAbort);
    try {
      if (!readable.destroyed) readable.destroy();
    } catch {
      /* ignore */
    }
    trackImageUploadBodyReadable(taskId, null);
  }
}

function isRetryableHarvesterStreamUploadError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === 'EPROTO' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    /write EPROTO|socket hang up|SSL routines/i.test(msg)
  );
}

async function withHarvesterStreamUploadRetry(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (first) {
    if (!isRetryableHarvesterStreamUploadError(first)) throw first;
    await new Promise((r) => setTimeout(r, 1500));
    await run();
  }
}

/** CDI DataVolume 准入：存储容量至少 1MiB（与 datavolume-validate.cdi.kubevirt.io 一致） */
const CDI_MIN_UPLOAD_BYTES = 1024 * 1024;

function resolveImageUploadByteTotal(task: ImageUploadTask, body: ImageUploadBodySource): number {
  const fromBody = Math.max(0, Math.floor(Number(body.byteTotal) || 0));
  if (fromBody > 0) return fromBody;
  const fromTask = Math.max(0, Math.floor(Number(task.fileSize) || 0));
  if (fromTask > 0) return fromTask;
  if (body.unlinkPath) {
    try {
      if (fs.existsSync(body.unlinkPath)) {
        return Math.max(0, fs.statSync(body.unlinkPath).size || 0);
      }
    } catch {
      /* ignore stat errors */
    }
  }
  return 0;
}

function assertCdiCompatibleUploadSize(total: number, profile: VmImageStorageProfile): void {
  if (profile.kind !== 'ceph') return;
  if (total >= CDI_MIN_UPLOAD_BYTES) return;
  throw new Error(
    total > 0
      ? `镜像文件过小（${total} 字节）；Ceph/CDI 要求 DataVolume 容量至少 1MiB，请选择有效镜像文件`
      : '无法确定镜像文件大小（0 字节）。请确认文件已完整上传，或检查 Content-Length / X-File-Size 请求头',
  );
}

/** 覆盖 upload URL 中已有 size=0 等无效值，避免 CDI 创建 0 容量 DataVolume */
function withUploadSizeQuery(uploadTarget: string, byteSize: number): string {
  if (byteSize < 1) return uploadTarget;
  try {
    const absolute = /^https?:\/\//i.test(uploadTarget);
    const u = new URL(uploadTarget, absolute ? undefined : 'http://upload.local');
    u.searchParams.set('size', String(byteSize));
    if (absolute) return u.href;
    return `${u.pathname}${u.search}`;
  } catch {
    if (/[?&]size=\d+/i.test(uploadTarget)) {
      return uploadTarget.replace(/([?&])size=\d+/i, `$1size=${byteSize}`);
    }
    const sep = uploadTarget.includes('?') ? '&' : '?';
    return `${uploadTarget}${sep}size=${byteSize}`;
  }
}

function resolveUploadTaskVirtualSizeBytes(
  task: ImageUploadTask,
  _uploadDiskFormat: string | undefined,
  body: ImageUploadBodySource,
): number | undefined {
  const stored = Math.max(0, Math.floor(Number(task.virtualSizeBytes) || 0));
  if (stored > 0) return stored;
  let merged: string | undefined;
  try {
    merged = imageTaskMergedAbsPath(task);
  } catch {
    merged = undefined;
  }
  return probeQcow2VirtualSizeFromPaths([body.unlinkPath, merged]);
}

async function persistUploadTaskVirtualSizeBytes(
  task: ImageUploadTask,
  virtualSizeBytes: number | undefined,
  repo: ReturnType<typeof AppDataSource.getRepository<ImageUploadTask>>,
): Promise<void> {
  const vs = Math.max(0, Math.floor(Number(virtualSizeBytes) || 0));
  if (vs < 1 || task.virtualSizeBytes === vs) return;
  task.virtualSizeBytes = vs;
  await repo.save(task);
}

function resolveUploadUrl(payload: any): string | null {
  const candidates = [
    payload?.links?.upload,
    payload?.actions?.upload,
    payload?.status?.uploadUrl,
    payload?.status?.uploadURL,
    payload?.uploadUrl,
    payload?.uploadURL,
    payload?.data?.links?.upload,
    payload?.data?.actions?.upload,
    payload?.data?.status?.uploadUrl,
    payload?.data?.status?.uploadURL,
    payload?.data?.uploadUrl,
    payload?.data?.uploadURL,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

async function pollHarvesterVmImageUploadUrl(
  origin: string,
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  namespace: string,
  name: string,
  insecure: boolean,
  opts: {
    created?: any;
    pollMax: number;
    taskId: string;
    abortController: AbortController;
  },
): Promise<string | null> {
  let uploadUrl = resolveUploadUrl(opts.created);
  if (uploadUrl) return uploadUrl;

  const directDetailCandidates = (() => {
    const roots = resolveHarvesterClusterApiRoots(cloud.endpoint || '', cloud.config);
    return [...buildHarvesterVmImageDetailUrls(roots, namespace, name)];
  })();
  const selfLink = String(opts.created?.links?.self || '').trim();
  if (selfLink) {
    if (/^https?:\/\//i.test(selfLink)) {
      directDetailCandidates.unshift(selfLink);
    } else if (selfLink.startsWith('/')) {
      directDetailCandidates.unshift(`${origin}${selfLink}`);
    }
  }

  for (let i = 0; i < opts.pollMax && !uploadUrl; i++) {
    await throwIfUploadCancelled(opts.taskId, opts.abortController);
    for (const detailUrl of directDetailCandidates) {
      try {
        const detail = await getJsonOnce(detailUrl, cloud.secretKey || '', insecure, true);
        uploadUrl = resolveUploadUrl(detail);
        if (uploadUrl) break;
      } catch {
        /* ignore */
      }
    }
    if (!uploadUrl) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!uploadUrl && name) {
    uploadUrl = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
      namespace,
    )}/${encodeURIComponent(name)}?action=upload`;
  }
  return uploadUrl;
}

/** 将 application/octet-stream 请求体落盘（与 multer 路径一致，避免创建镜像轮询期间不读 body） */
export async function ingestOctetStreamToTempFile(
  req: Request,
  destPath: string,
  expectedSize: number,
  taskId: string,
  abortController: AbortController,
): Promise<void> {
  bindClientDisconnectAbort(req, abortController);
  let received = 0;
  let lastUpdateAt = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      if (abortController.signal.aborted) {
        callback(new Error('CANCELLED'));
        return;
      }
      const n = chunk.length || Buffer.byteLength(chunk);
      received += n;
      const now = Date.now();
      if (now - lastUpdateAt > 400) {
        lastUpdateAt = now;
        const ingestProgress =
          expectedSize > 0 ? clampProgress((received / expectedSize) * 100) : 0;
        void updateTaskProgress(taskId, {
          ingestProgress,
          bytesUploaded: received,
          progress: clampProgress(ingestProgress),
        }).catch(() => {
          /* ignore progress DB noise */
        });
      }
      callback(null, chunk);
    },
  });
  await pipeline(req, counter, fs.createWriteStream(destPath));
  await updateTaskProgress(taskId, {
    ingestProgress: 100,
    bytesUploaded: expectedSize > 0 ? Math.min(received, expectedSize) : received,
    progress: 100,
  });
}

export async function runImageUploadTaskWithBody(
  taskId: string,
  cloud: any,
  body: ImageUploadBodySource,
) {
  if (getImageUploadInFlightTaskIds().has(taskId) || hasImageUploadProxyRun(taskId)) {
    const err = new Error('镜像同步已在进行中，请勿重复提交');
    (err as any).status = 409;
    throw err;
  }
  const repo = AppDataSource.getRepository(ImageUploadTask);
  const taskForCloud = await repo.findOne({ where: { id: taskId } });
  const cloudId = String(taskForCloud?.cloudId || cloud?.id || '').trim();
  const executeProxy = async () => {
    registerImageUploadProxyStart(cloudId, taskId);
    const abortController = new AbortController();
    setImageUploadAbortController(taskId, abortController);
    let proxyCompleted = false;
    try {
      const task = taskForCloud;
      if (!task) return;
      if (task.taskStatus === 'cancelled') return;

      if (body.bindRequestStream) {
        bindClientDisconnectAbort(body.bindRequestStream, abortController);
      }

      task.startedAt = task.startedAt || new Date();
      task.errorCode = undefined;
      task.errorMessage = undefined;
      await repo.save(task);

      const insecure = !!(cloud.config as any)?.ignoreTls;
      const base = (cloud.endpoint || '').replace(/\/+$/, '');
      let origin = base;
      try {
        const u = new URL(base);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        origin = base.replace(/\/v[0-9].*$/, '');
      }

      const uploadDiskFormat =
        String(task.imageType || '').toLowerCase() === 'iso'
          ? 'iso'
          : String(task.imageType || '').toLowerCase() === 'disk'
            ? 'qcow2'
            : undefined;
      const displayLabel = task.displayName || task.filename || 'image-upload-task';
      const imageTypeLabel: 'iso' | 'disk' | undefined =
        uploadDiskFormat === 'iso' ? 'iso' : uploadDiskFormat === 'qcow2' ? 'disk' : undefined;
      const uploadStorageProfile = await resolveVmImageStorageProfile(harvesterConn(cloud));
      const uploadByteTotal = resolveImageUploadByteTotal(task, body);
      assertCdiCompatibleUploadSize(uploadByteTotal, uploadStorageProfile);
      if (uploadByteTotal > 0 && task.fileSize !== uploadByteTotal) {
        task.fileSize = uploadByteTotal;
        await repo.save(task);
      }
      const uploadScName = uploadStorageProfile.storageClassName;
      const { labels: uploadLabels, annotations: uploadAnnotations } = vmImageHarvesterMetadataLikeUi(
        {
          displayName: displayLabel,
          imageTypeLabel,
          imageNameForAnnotation: task.filename || displayLabel,
          storageClassName: uploadScName,
          storageProfile: uploadStorageProfile,
        },
      );
      const payload = {
        apiVersion: 'harvesterhci.io/v1beta1',
        kind: 'VirtualMachineImage',
        metadata: {
          generateName: 'image-',
          namespace: task.namespace,
          labels: uploadLabels,
          annotations: uploadAnnotations,
        },
        spec: buildHarvesterVmImageSpecFields({
          profile: uploadStorageProfile,
          displayName: displayLabel,
          sourceType: 'upload',
          diskFormat: uploadDiskFormat,
        }),
      };
      const createCandidates = [
        `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`,
        `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
          task.namespace,
        )}/virtualmachineimages`,
        `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
          task.namespace,
        )}/virtualmachineimages`,
      ];
      let created: any = null;
      let createLastErr: any = null;
      const existingName = String(task.createdImageName || '').trim();
      const existingNs = String(task.createdImageNamespace || task.namespace || '').trim();

      if (existingName && existingNs) {
        const prep = await prepareClusterImageForUploadRetry(
          cloud,
          cloudId,
          task,
          existingNs,
          existingName,
        );
        if (prep === 'already_imported') {
          const existingDetail = await fetchHarvesterVmImageDetailFromCluster(
            cloud,
            existingNs,
            existingName,
            insecure,
          );
          if (existingDetail) {
            try {
              await upsertVmImageDetailToInventory(
                cloud,
                origin,
                existingNs,
                existingName,
                insecure,
                existingDetail,
              );
            } catch {
              /* ignore */
            }
          }
          await updateTaskProgress(taskId, {
            taskStatus: 'success',
            phase: 'finished',
            proxyProgress: 100,
            progress: 100,
            finishedAt: new Date(),
          });
          void syncHarvesterImages(cloud, insecure, { allowDuringUploadProxy: true }).catch(
            () => undefined,
          );
          return;
        }
        await repo.save(task);
      }

      if (!created) {
        for (const createUrl of createCandidates) {
          try {
            created = await requestJson('POST', createUrl, cloud.secretKey || '', insecure, payload);
            if (created) break;
          } catch (e: any) {
            createLastErr = e;
          }
        }
        if (!created && createLastErr) {
          throw new Error(formatImageUploadTaskError(createLastErr));
        }
      }

      const createdImageName = String(created?.metadata?.name || '').trim();
      const createdImageNamespace = String(
        created?.metadata?.namespace || task.createdImageNamespace || task.namespace || '',
      ).trim();
      if (!createdImageName) {
        throw new Error('Harvester 创建镜像资源失败，未返回镜像名称');
      }
      task.createdImageName = createdImageName;
      task.createdImageNamespace = createdImageNamespace;
      await repo.save(task);
      try {
        await upsertHarvesterImageInventoryItems(String(cloud.id || task.cloudId), [created]);
      } catch {
        /* 单条增量入库失败不阻断代传 */
      }

      if (uploadStorageProfile.kind === 'ceph' && !harvesterVmImageImportSucceeded(created)) {
        try {
          await deleteVmImageCdiStorageOrphans(
            harvesterConn(cloud),
            origin,
            createdImageNamespace,
            createdImageName,
            created,
          );
        } catch (e: any) {
          console.warn(
            '[image-upload-task] delete CDI storage before upload failed',
            createdImageNamespace,
            createdImageName,
            e?.message || e,
          );
        }
      }

      const pollMax = uploadStorageProfile.kind === 'ceph' ? 90 : 20;
      const uploadUrl = await pollHarvesterVmImageUploadUrl(
        origin,
        cloud,
        createdImageNamespace,
        createdImageName,
        insecure,
        { created, pollMax, taskId, abortController },
      );

      if (!uploadUrl) throw new Error('Harvester 未返回 upload URL');

      await throwIfUploadCancelled(taskId, abortController);

      const total = uploadByteTotal;
      assertCdiCompatibleUploadSize(total, uploadStorageProfile);
      const virtualSizeBytes = resolveUploadTaskVirtualSizeBytes(task, uploadDiskFormat, body);
      await persistUploadTaskVirtualSizeBytes(task, virtualSizeBytes, repo);
      const proxySizes = resolveImageProxyUploadSizes({
        fileByteTotal: total,
        storageKind: uploadStorageProfile.kind,
        diskFormat: uploadDiskFormat,
        virtualSizeBytes,
      });
      if (
        uploadStorageProfile.kind === 'ceph' &&
        uploadDiskFormat === 'qcow2' &&
        proxySizes.uploadUrlSize > proxySizes.fileByteTotal
      ) {
        imageUploadTaskLog.info('ceph qcow2 upload: CDI DataVolume size from virtual size', {
          taskId,
          fileByteTotal: proxySizes.fileByteTotal,
          uploadUrlSize: proxySizes.uploadUrlSize,
          virtualSizeBytes,
        });
      }
      const uploadBasename =
        task.filename ||
        body.preferredBasename ||
        (body.unlinkPath ? path.basename(body.unlinkPath) : 'image');

      const uploadTarget = /^https?:\/\//i.test(String(uploadUrl || ''))
        ? String(uploadUrl)
        : `${origin}${String(uploadUrl).startsWith('/') ? '' : '/'}${String(uploadUrl)}`;

      await updateTaskProgress(taskId, {
        taskStatus: 'proxying',
        phase: 'proxying',
        progress: 0,
        proxyProgress: 0,
      });

      const followHarvesterProgress = async () => {
        try {
          const detail = await fetchHarvesterVmImageDetailFromCluster(
            cloud,
            createdImageNamespace,
            createdImageName,
            insecure,
          );
          if (!detail) return;
          const failMsg = harvesterVmImageUploadTerminalFailure(detail);
          if (failMsg) {
            if (isUploadTaskTransferInFlight(taskId) || hasImageUploadProxyRun(taskId)) {
              return;
            }
            if (!abortController.signal.aborted) abortController.abort();
            await safeUpdateTaskProgress(taskId, {
              taskStatus: 'failed',
              phase: 'finished',
              errorCode: 'IMPORT_FAILED',
              errorMessage: failMsg,
              finishedAt: new Date(),
            });
            return;
          }
          const current = await repo.findOne({ where: { id: taskId } });
          const patch = buildUploadTaskProgressPatchFromCluster(
            current || { proxyProgress: 0, progress: 0 },
            detail,
          );
          if (patch) {
            await safeUpdateTaskProgress(taskId, patch);
          }
        } catch (e) {
          if (!isInternalTowerDbError(e)) {
            console.warn('[image-upload-task] followHarvesterProgress error', taskId, e);
          }
        }
      };

      const runProxyUploadWithProgressTimer = async (uploadFn: () => Promise<void>) => {
        const harvesterProgressTimer = setInterval(() => {
          void followHarvesterProgress();
        }, 10000);
        try {
          await withHarvesterStreamUploadRetry(uploadFn);
        } finally {
          clearInterval(harvesterProgressTimer);
        }
      };

      if (uploadTarget.includes('action=upload')) {
        const streamByteSize = proxySizes.streamByteSize;
        const finalTarget = withUploadSizeQuery(uploadTarget, proxySizes.uploadUrlSize);
        const padding = Math.max(0, streamByteSize - total);
        const filename = uploadBasename;

        const runMultipartUploadOnce = async () => {
          await withImageUploadBodyReadable(
            taskId,
            abortController,
            body.createBodyReadable,
            async (inboundBody) => {
              const boundary = `HarvesterBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
              const header = Buffer.from(
                `--${boundary}\r\n` +
                  `Content-Disposition: form-data; name="chunk"; filename="${filename}"\r\n` +
                  `Content-Type: application/octet-stream\r\n` +
                  `Content-Length: ${streamByteSize}\r\n` +
                  `\r\n`,
              );
              const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
              const contentLength = header.length + streamByteSize + footer.length;
              let sent = 0;
              let lastUpdateAt = 0;
              let chunkCount = 0;

              await harvesterNativeStreamUpload({
                method: 'POST',
                url: finalTarget,
                insecure,
                signal: abortController.signal,
                headers: {
                  Authorization: `Bearer ${cloud.secretKey || ''}`,
                  'Content-Type': `multipart/form-data; boundary=${boundary}`,
                  'Content-Length': contentLength,
                },
                async pump(write) {
                  await write(header);
                  for await (const chunk of inboundBody as AsyncIterable<Buffer | string>) {
                    if (++chunkCount % 32 === 0) {
                      await throwIfUploadCancelled(taskId, abortController);
                    }
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    sent += buf.length;
                    const now = Date.now();
                    if (now - lastUpdateAt > 2000) {
                      lastUpdateAt = now;
                      await updateTaskProgress(taskId, {
                        bytesUploaded: Math.min(sent, total),
                      });
                    }
                    await write(buf);
                  }
                  await throwIfUploadCancelled(taskId, abortController);
                  if (padding > 0) await write(Buffer.alloc(padding));
                  await write(footer);
                },
              });
            },
          );
        };

        try {
          await runProxyUploadWithProgressTimer(runMultipartUploadOnce);
        } catch (uploadErr: any) {
          throw new Error(formatImageUploadTaskError(uploadErr));
        }
        await updateTaskProgress(taskId, {
          bytesUploaded: total,
        });
      } else {
        if (total < 1) {
          throw new Error(
            '无法确定镜像文件大小，CDI 直传需要有效的 Content-Length（请确认文件已完整落盘）',
          );
        }
        const putTarget = withUploadSizeQuery(uploadTarget, proxySizes.uploadUrlSize);
        const runPutUploadOnce = async () => {
          await withImageUploadBodyReadable(
            taskId,
            abortController,
            body.createBodyReadable,
            async (rawIn) => {
              let sent = 0;
              let lastUpdateAt = 0;
              await harvesterNativeStreamUpload({
                method: 'PUT',
                url: putTarget,
                insecure,
                signal: abortController.signal,
                headers: {
                  Authorization: `Bearer ${cloud.secretKey || ''}`,
                  'Content-Type': 'application/octet-stream',
                  'Content-Length': String(total),
                },
                async pump(write) {
                  for await (const chunk of rawIn as AsyncIterable<Buffer | string>) {
                    await throwIfUploadCancelled(taskId, abortController);
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    sent += buf.length;
                    const now = Date.now();
                    if (now - lastUpdateAt > 2000) {
                      lastUpdateAt = now;
                      void updateTaskProgress(taskId, {
                        bytesUploaded: Math.min(sent, total),
                      }).catch(() => undefined);
                    }
                    await write(buf);
                  }
                },
              });
            },
          );
        };
        try {
          await runProxyUploadWithProgressTimer(runPutUploadOnce);
        } catch (uploadErr: any) {
          throw new Error(formatImageUploadTaskError(uploadErr));
        }
      }

      if (body.onProxyComplete) {
        await body.onProxyComplete();
        proxyCompleted = true;
      }

      const importDeadline =
        Date.now() +
        Math.max(30 * 60 * 1000, Math.ceil(total / (50 * 1024 * 1024)) * 10 * 60 * 1000);
      let imported = false;
      while (Date.now() < importDeadline && !imported) {
        await throwIfUploadCancelled(taskId, abortController);
        const detail = await fetchHarvesterVmImageDetailFromCluster(
          cloud,
          createdImageNamespace,
          createdImageName,
          insecure,
        );
        if (detail) {
          if (isHarvesterVmImageImportComplete(detail)) {
            imported = true;
            break;
          }
          const terminalFail = harvesterVmImageUploadTerminalFailure(detail);
          if (terminalFail) {
            throw new Error(terminalFail);
          }
          const current = await repo.findOne({ where: { id: taskId } });
          const patch = buildUploadTaskProgressPatchFromCluster(
            current || { proxyProgress: 0, progress: 0 },
            detail,
          );
          if (patch) {
            await safeUpdateTaskProgress(taskId, patch);
          }
        }
        await new Promise((r) => setTimeout(r, 10000));
      }
      if (!imported) {
        const lateDetail = await fetchHarvesterVmImageDetailFromCluster(
          cloud,
          createdImageNamespace,
          createdImageName,
          insecure,
        );
        if (lateDetail && harvesterVmImageImportSucceeded(lateDetail)) {
          imported = true;
        } else if (lateDetail && !harvesterVmImageUploadTerminalFailure(lateDetail)) {
          await markUploadTaskProxyingFromCluster(taskId, cloud, lateDetail, cloudId);
          return;
        }
        if (!imported) {
          throw new Error('Harvester 导入进度等待超时');
        }
      }

      const imgNs = createdImageNamespace;
      const imgName = createdImageName;
      if (imgNs && imgName) {
        try {
          await upsertVmImageDetailToInventory(cloud, origin, imgNs, imgName, insecure);
        } catch {
          /* 单条 detail 入库失败不阻断 */
        }
      }
      await updateTaskProgress(taskId, {
        taskStatus: 'success',
        phase: 'finished',
        proxyProgress: 100,
        progress: 100,
        bytesUploaded: total,
        finishedAt: new Date(),
      });
      void syncHarvesterImages(cloud, !!(cloud.config as any)?.ignoreTls, {
        allowDuringUploadProxy: true,
      }).catch(() => undefined);
    } catch (e: any) {
      if (isCancelError(e)) {
        const current = await repo.findOne({ where: { id: taskId } });
        const currentStatus = String(current?.taskStatus || '').toLowerCase();
        if (currentStatus === 'cancelled') {
          await updateTaskProgress(taskId, {
            phase: 'finished',
            finishedAt: current?.finishedAt || new Date(),
          });
        } else if (currentStatus !== 'failed') {
          await updateTaskProgress(taskId, {
            taskStatus: 'failed',
            phase: 'finished',
            errorCode: 'SYNC_INTERRUPTED',
            errorMessage: '镜像同步已中断，请在镜像列表点击「同步」重试',
            finishedAt: new Date(),
          });
        }
        if (body.onProxyComplete && !proxyCompleted) throw e;
        return;
      }
      const insecure = !!(cloud.config as any)?.ignoreTls;
      const taskRepo = AppDataSource.getRepository(ImageUploadTask);
      const currentTask = await taskRepo.findOne({ where: { id: taskId } });
      if (currentTask) {
        const resolved = await resolveUploadTaskAfterTowerProxyError(
          taskId,
          cloud,
          currentTask,
          e,
          insecure,
        );
        if (resolved === 'handled') {
          if (body.onProxyComplete && !proxyCompleted) return;
          return;
        }
      }
      await updateTaskProgress(taskId, {
        taskStatus: 'failed',
        phase: 'finished',
        errorCode: 'UPLOAD_FAILED',
        errorMessage: formatImageUploadTaskError(e),
        finishedAt: new Date(),
      });
      if (body.onProxyComplete && !proxyCompleted) {
        throw new Error(formatImageUploadTaskError(e));
      }
    } finally {
      destroyImageUploadBodyReadable(taskId);
      flushDeferredImageUploadCleanup(taskId);
      registerImageUploadProxyEnd(cloudId, taskId);
      try {
        const current = await repo.findOne({ where: { id: taskId } });
        const status = String(current?.taskStatus || '').toLowerCase();
        if (current && status === 'success') {
          await purgeImageUploadTaskStagingFiles(current);
        } else if (current && status === 'cancelled') {
          await scheduleImageUploadTaskFilesCleanup(current);
          await finalizeImageUploadTaskFilesCleanup(taskId);
        }
        // failed：保留 Tower .merged 暂存，供镜像列表再次点击「同步」
      } catch (e: any) {
        imageUploadTaskLog.warn('purge staging files after proxy run failed', {
          taskId,
          err: e?.message || e,
        });
      }
    }
  };
  const run = executeProxy();
  attachImageUploadProxyRun(taskId, run);
  await run;
}

export async function runImageUploadTask(taskId: string, cloud: any, filePath: string) {
  const stat = fs.statSync(filePath);
  await runImageUploadTaskWithBody(taskId, cloud, {
    byteTotal: stat.size || 0,
    preferredBasename: path.basename(filePath),
    createBodyReadable: () => fs.createReadStream(filePath),
    unlinkPath: filePath,
  });
}
