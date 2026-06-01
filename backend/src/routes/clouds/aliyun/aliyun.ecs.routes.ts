/**
 * 阿里云路由 — ECS（实例列表/流式、生命周期、VNC 等）。
 */
import { Router, Response } from 'express';
import { callAliyunEcs, callAliyunCms } from '../../../services/clouds/aliyun/client';
import { fetchCloudOr404, isAliyun } from './aliyun.shared';

export const registerAliyunEcsRoutes = (router: Router, checkAdminPermission: any): void => {
  router.get(
    '/:id/resources/ecs/:instanceId/metrics',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const q = req.query || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const metric = String(q.metric || 'CPUUtilization');
        const period = Number(q.period || 60);
        const end = q.end != null ? Number(q.end) : Date.now();
        const start = q.start != null ? Number(q.start) : end - 24 * 60 * 60 * 1000;
        const namespace = 'acs_ecs';
        const dims = JSON.stringify([{ instanceId }]);
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeMetricData',
          extraParams: {
            Namespace: namespace,
            MetricName: metric,
            Period: period,
            StartTime: new Date(start).toISOString(),
            EndTime: new Date(end).toISOString(),
            Dimensions: dims,
          },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询监控指标失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/ecs/:instanceId/history-events',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeInstanceHistoryEvents',
          extraParams: { InstanceId: instanceId, PageNumber: 1, PageSize: 50 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询实例事件失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { PageNumber, PageSize } = req.query || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });

        // Native Mode (If pagination params are provided)
        if (PageNumber || PageSize) {
          const data = await callAliyunEcs({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeInstances',
            extraParams: { PageNumber: PageNumber || 1, PageSize: PageSize || 50 },
          } as any);
          const capabilities = {
            isHarvester: false,
            supportsInstanceType: true,
            supportsZone: true,
            supportsVpc: true,
          };
          return res.json({ message: '查询成功', data, capabilities });
        }

        // Encapsulated Mode (Aggregation)
        const pageSize = 50;
        let page = 1;
        let allInstances: any[] = [];

        while (true) {
          const resp = await callAliyunEcs({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeInstances',
            extraParams: { PageNumber: page, PageSize: pageSize },
          } as any);

          const chunk = resp?.Instances?.Instance || [];
          allInstances = allInstances.concat(chunk);

          if (!Array.isArray(chunk) || chunk.length < pageSize) break;
          page += 1;
          if (page > 100) break; // Safety break
        }

        const data = {
          TotalCount: allInstances.length,
          Instances: {
            Instance: allInstances,
          },
        };

        const capabilities = {
          isHarvester: false,
          supportsInstanceType: true,
          supportsZone: true,
          supportsVpc: true,
          supportsNetworkFusion: false,
          supportsMultus: false,
        };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询ECS失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        let closed = false;
        let prev = new Map<string, any>();
        req.on('close', () => {
          closed = true;
        });
        const send = (event: string, payload: any) => {
          try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch {}
        };
        const tick = async () => {
          if (closed) return;
          try {
            let page = 1;
            const pageSize = 50;
            let allItems: any[] = [];

            while (true) {
              const data: any = await callAliyunEcs({
                accessKeyId: cloud.accessKey!,
                accessKeySecret: cloud.secretKey!,
                regionId: cloud.region!,
                action: 'DescribeInstances',
                extraParams: { PageNumber: page, PageSize: pageSize },
              } as any);

              const chunk: any[] = Array.isArray(data?.Instances?.Instance)
                ? data.Instances.Instance
                : Array.isArray(data?.data?.Instances?.Instance)
                  ? data.data.Instances.Instance
                  : Array.isArray(data)
                    ? data
                    : [];

              allItems = allItems.concat(chunk);
              if (chunk.length < pageSize) break;
              page++;
              if (page > 50) break; // Safety break
            }

            const items = allItems;
            const cur = new Map<string, any>();
            for (const r of items) {
              const iid = String(r?.InstanceId || r?.id || '');
              if (!iid) continue;
              cur.set(iid, r);
              const prevItem = prev.get(iid);
              const prevStatus = String(prevItem?.Status || prevItem?.status || '');
              const curStatus = String(r?.Status || r?.status || '');
              if (!prevItem) send('vm_created', { item: r });
              else if (prevStatus !== curStatus) send('vm_status', { iid, status: curStatus });
            }
            for (const [iid] of prev.entries()) {
              if (!cur.has(iid)) send('vm_deleted', { iid });
            }
            prev = cur;
            send('vms', { items });
          } catch (e: any) {
            send('error', { message: e?.message || '拉取失败' });
          } finally {
            if (!closed) setTimeout(tick, 3000);
          }
        };
        send('hello', { ok: true });
        tick();
      } catch (error: any) {
        try {
          res.status(500).end();
        } catch {}
      }
    },
  );

  // 创建实例 RunInstances
  router.post(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const b = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!b.imageId || !b.instanceType || !b.securityGroupId || !b.vSwitchId)
          return res.status(400).json({
            message: '缺少必要参数：imageId / instanceType / securityGroupId / vSwitchId',
          });
        const extraParams: Record<string, any> = {
          ImageId: b.imageId,
          InstanceType: b.instanceType,
          SecurityGroupId: b.securityGroupId,
          VSwitchId: b.vSwitchId,
          Amount: Number(b.amount) || 1,
          InstanceChargeType: b.instanceChargeType || 'PostPaid',
        };
        if (b.zoneId) extraParams.ZoneId = b.zoneId;
        if (b.instanceName) extraParams.InstanceName = b.instanceName;
        if (b.hostName) extraParams.HostName = b.hostName;
        if (b.password) extraParams.Password = b.password;
        if (b.keyPairName) extraParams.KeyPairName = b.keyPairName;
        if (b.systemDiskCategory) extraParams['SystemDisk.Category'] = b.systemDiskCategory;
        if (b.systemDiskSize) extraParams['SystemDisk.Size'] = Number(b.systemDiskSize);
        if (b.internetMaxBandwidthOut != null)
          extraParams.InternetMaxBandwidthOut = Number(b.internetMaxBandwidthOut);
        if (b.internetChargeType) extraParams.InternetChargeType = b.internetChargeType;
        if (String(extraParams.InstanceChargeType) === 'PrePaid' && b.period) {
          extraParams.Period = Number(b.period);
          extraParams.PeriodUnit = b.periodUnit || 'Month';
        }
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'RunInstances',
          extraParams,
        } as any);
        res.json({ message: '创建实例指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建实例失败', error: error.message });
      }
    },
  );

  // 实例变配 ModifyInstanceSpec（按量）
  router.post(
    '/:id/resources/ecs/:instanceId/modify-spec',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { instanceType } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!instanceType) return res.status(400).json({ message: '缺少目标规格 instanceType' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ModifyInstanceSpec',
          extraParams: { InstanceId: instanceId, InstanceType: instanceType },
        } as any);
        res.json({ message: '变配指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '变配失败', error: error.message });
      }
    },
  );

  // 重置实例密码 ModifyInstanceAttribute（需重启生效）
  router.post(
    '/:id/resources/ecs/:instanceId/reset-password',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { password } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!password) return res.status(400).json({ message: '缺少新密码 password' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ModifyInstanceAttribute',
          extraParams: { InstanceId: instanceId, Password: password },
        } as any);
        res.json({ message: '密码重置成功，重启后生效', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '重置密码失败', error: error.message });
      }
    },
  );

  // 更换系统盘镜像 ReplaceSystemDisk
  router.post(
    '/:id/resources/ecs/:instanceId/replace-system-disk',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { imageId, password, keyPairName, systemDiskSize } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!imageId) return res.status(400).json({ message: '缺少目标镜像 imageId' });
        const extraParams: Record<string, any> = { InstanceId: instanceId, ImageId: imageId };
        if (password) extraParams.Password = password;
        if (keyPairName) extraParams.KeyPairName = keyPairName;
        if (systemDiskSize) extraParams['SystemDisk.Size'] = Number(systemDiskSize);
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ReplaceSystemDisk',
          extraParams,
        } as any);
        res.json({ message: '更换系统盘指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更换系统盘失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'StartInstance',
          extraParams: { InstanceId: instanceId },
        } as any);
        res.json({ message: '启动指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '启动实例失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = req.body as { force?: boolean };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'StopInstance',
          extraParams: { InstanceId: instanceId, ForceStop: !!force },
        } as any);
        res.json({ message: '停止指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '停止实例失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = req.body as { force?: boolean };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'RebootInstance',
          extraParams: { InstanceId: instanceId, ForceStop: !!force },
        } as any);
        res.json({ message: '重启指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '重启实例失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteInstance',
          extraParams: { InstanceId: instanceId },
        } as any);
        res.json({ message: '删除指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除实例失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/ecs/:instanceId/vnc-url',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeInstanceVncUrl',
          extraParams: { InstanceId: instanceId },
        } as any);
        const url = (result && (result.VncUrl || (result as any).vncUrl)) || null;
        res.json({ message: '查询成功', data: { VncUrl: url } });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询VNC地址失败', error: error.message });
      }
    },
  );
};
