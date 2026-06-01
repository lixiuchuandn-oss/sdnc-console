/**
 * 阿里云路由 — 块存储与镜像（Disks / Snapshots / Images）。
 */
import { Router, Response } from 'express';
import { callAliyunEcs } from '../../../services/clouds/aliyun/client';
import { fetchCloudOr404, isAliyun, aggregatePaged } from './aliyun.shared';

export const registerAliyunStorageRoutes = (router: Router, checkAdminPermission: any): void => {
  // Disks
  router.get(
    '/:id/resources/disks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const { instanceId } = (req.query || {}) as { instanceId?: string };
        const pageSize = 50;
        let page = 1;
        let all: any[] = [];
        while (true) {
          const resp: any = await callAliyunEcs({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeDisks',
            extraParams: {
              PageNumber: page,
              PageSize: pageSize,
              ...(instanceId ? { InstanceId: String(instanceId) } : {}),
            },
          } as any);
          const chunk =
            resp?.Disks?.Disk ||
            resp?.DiskSets?.DiskSet ||
            resp?.data?.Disks?.Disk ||
            resp?.data?.DiskSets?.DiskSet ||
            [];
          const arr = Array.isArray(chunk) ? chunk : chunk ? [chunk] : [];
          all = all.concat(arr);
          if (!Array.isArray(chunk) || arr.length < pageSize) break;
          page += 1;
          if (page > 50) break;
        }
        const data = { Disks: { Disk: all } };
        const capabilities = { isHarvester: false, supportsSnapshots: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询云盘失败', error: error.message });
      }
    },
  );

  // 创建云盘 CreateDisk
  router.post(
    '/:id/resources/disks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { zoneId, diskCategory, size, diskName, description, snapshotId, performanceLevel } =
          req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!zoneId) return res.status(400).json({ message: '缺少可用区 ZoneId' });
        if (!size && !snapshotId)
          return res.status(400).json({ message: '请提供云盘容量 Size 或源快照 SnapshotId' });
        const extraParams: Record<string, any> = { ZoneId: zoneId };
        if (diskCategory) extraParams.DiskCategory = diskCategory;
        if (size != null) extraParams.Size = Number(size);
        if (diskName) extraParams.DiskName = diskName;
        if (description) extraParams.Description = description;
        if (snapshotId) extraParams.SnapshotId = snapshotId;
        if (performanceLevel) extraParams.PerformanceLevel = performanceLevel;
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateDisk',
          extraParams,
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建云盘失败', error: error.message });
      }
    },
  );

  // 删除云盘 DeleteDisk
  router.delete(
    '/:id/resources/disks/:diskId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteDisk',
          extraParams: { DiskId: diskId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除云盘失败', error: error.message });
      }
    },
  );

  // 扩容云盘 ResizeDisk
  router.post(
    '/:id/resources/disks/:diskId/resize',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { newSize, type } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!newSize) return res.status(400).json({ message: '缺少目标容量 NewSize' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ResizeDisk',
          extraParams: { DiskId: diskId, NewSize: Number(newSize), Type: type || 'offline' },
        } as any);
        res.json({ message: '扩容指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '扩容云盘失败', error: error.message });
      }
    },
  );

  // 挂载云盘 AttachDisk
  router.post(
    '/:id/resources/disks/:diskId/attach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { instanceId, deleteWithInstance } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!instanceId) return res.status(400).json({ message: '缺少目标实例 InstanceId' });
        const extraParams: Record<string, any> = { DiskId: diskId, InstanceId: instanceId };
        if (deleteWithInstance != null) extraParams.DeleteWithInstance = !!deleteWithInstance;
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'AttachDisk',
          extraParams,
        } as any);
        res.json({ message: '挂载指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '挂载云盘失败', error: error.message });
      }
    },
  );

  // 卸载云盘 DetachDisk
  router.post(
    '/:id/resources/disks/:diskId/detach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { instanceId } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!instanceId) return res.status(400).json({ message: '缺少所属实例 InstanceId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DetachDisk',
          extraParams: { DiskId: diskId, InstanceId: instanceId },
        } as any);
        res.json({ message: '卸载指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '卸载云盘失败', error: error.message });
      }
    },
  );

  // 回滚云盘（从快照） ResetDisk
  router.post(
    '/:id/resources/disks/:diskId/reset',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { snapshotId } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!snapshotId) return res.status(400).json({ message: '缺少源快照标识 SnapshotId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ResetDisk',
          extraParams: { DiskId: diskId, SnapshotId: snapshotId },
        } as any);
        res.json({ message: '回滚指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '回滚云盘失败', error: error.message });
      }
    },
  );

  // Snapshots
  router.get(
    '/:id/resources/snapshots',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '缺少阿里云访问密钥' });
        const all = await aggregatePaged(
          (extra) =>
            callAliyunEcs({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeSnapshots',
              extraParams: extra,
            } as any),
          (resp) => resp?.Snapshots?.Snapshot || resp?.data?.Snapshots?.Snapshot,
        );
        res.json({ message: '查询成功', data: { Snapshots: { Snapshot: all } } });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询快照失败', error: error.message });
      }
    },
  );

  // 创建快照 CreateSnapshot
  router.post(
    '/:id/resources/snapshots',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { diskId, snapshotName, description, retentionDays } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少源云盘标识 DiskId' });
        const extraParams: Record<string, any> = { DiskId: diskId };
        if (snapshotName) extraParams.SnapshotName = snapshotName;
        if (description) extraParams.Description = description;
        if (retentionDays != null) extraParams.RetentionDays = Number(retentionDays);
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateSnapshot',
          extraParams,
        } as any);
        res.json({ message: '创建快照指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建快照失败', error: error.message });
      }
    },
  );

  // 删除快照 DeleteSnapshot
  router.delete(
    '/:id/resources/snapshots/:snapshotId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, snapshotId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!snapshotId) return res.status(400).json({ message: '缺少快照标识 SnapshotId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteSnapshot',
          extraParams: { SnapshotId: snapshotId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除快照失败', error: error.message });
      }
    },
  );

  // 镜像列表 DescribeImages（owner: system/self/others/marketplace）
  router.get(
    '/:id/resources/images',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { owner, osType, pageSize } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const baseParams: Record<string, any> = { Status: 'Available' };
        if (owner) baseParams.ImageOwnerAlias = owner;
        if (osType) baseParams.OSType = osType;
        const all = await aggregatePaged(
          (extra) =>
            callAliyunEcs({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeImages',
              extraParams: { ...baseParams, ...extra },
            } as any),
          (resp) => resp?.Images?.Image || resp?.data?.Images?.Image,
          Number(pageSize) || 100,
        );
        const data = { Images: { Image: all } };
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询镜像失败', error: error.message });
      }
    },
  );

  // 删除镜像 DeleteImage
  router.delete(
    '/:id/resources/images/:imageId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, imageId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!imageId) return res.status(400).json({ message: '缺少镜像标识 ImageId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteImage',
          extraParams: { ImageId: imageId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );

  // 创建自定义镜像 CreateImage（从实例或快照）
  router.post(
    '/:id/resources/images',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { instanceId, snapshotId, imageName, description } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!instanceId && !snapshotId)
          return res.status(400).json({ message: '请提供 instanceId 或 snapshotId' });
        const extraParams: Record<string, any> = {};
        if (instanceId) extraParams.InstanceId = instanceId;
        if (snapshotId) extraParams.SnapshotId = snapshotId;
        if (imageName) extraParams.ImageName = imageName;
        if (description) extraParams.Description = description;
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateImage',
          extraParams,
        } as any);
        res.json({ message: '创建镜像指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建镜像失败', error: error.message });
      }
    },
  );
};
