import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { callAliyunEcs, callAliyunVpc, callAliyunCms, callAliyunSlb, callAliyunRds } from '../../../services/clouds/aliyun/client';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

const isAliyun = (cloud: any) => {
  const p = String(cloud?.config?.provider || '').toLowerCase();
  return p.includes('aliyun');
};

export const registerAliyunRoutes = (router: Router, checkAdminPermission: any) => {
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

  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { PageNumber, PageSize } = req.query || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '缺少阿里云访问密钥' });

        // Native Mode
        if (PageNumber || PageSize) {
          const data = await callAliyunEcs({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeVpcs',
            extraParams: { PageNumber: PageNumber || 1, PageSize: PageSize || 50 },
          } as any);
          return res.json({ message: '查询成功', data });
        }

        // Encapsulated Mode (Aggregation)
        const pageSize = 50;
        let page = 1;
        let all: any[] = [];
        while (true) {
          const resp = await callAliyunEcs({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeVpcs',
            extraParams: { PageNumber: page, PageSize: pageSize },
          } as any);
          const chunk = resp?.Vpcs?.Vpc || [];
          all = all.concat(Array.isArray(chunk) ? chunk : []);
          if (!Array.isArray(chunk) || chunk.length < pageSize) break;
          page += 1;
          if (page > 50) break;
        }
        res.json({ message: '查询成功', data: { TotalCount: all.length, Vpcs: { Vpc: all } } });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询VPC失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { VpcName, CidrBlock, Description, EnableIpv6, Ipv6CidrBlock } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!CidrBlock) return res.status(400).json({ message: '缺少必填参数：CidrBlock' });
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const extraParams: Record<string, any> = { CidrBlock };
        if (VpcName) extraParams.VpcName = VpcName;
        if (Description) extraParams.Description = Description;
        if (EnableIpv6 !== undefined) extraParams.EnableIpv6 = !!EnableIpv6;
        if (Ipv6CidrBlock) extraParams.Ipv6CidrBlock = Ipv6CidrBlock;
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateVpc',
          extraParams,
        });
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建VPC失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/vpcs/:vpcId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, vpcId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!vpcId) return res.status(400).json({ message: '缺少 VPC 标识 vpcId' });
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteVpc',
          extraParams: { VpcId: vpcId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除VPC失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/vpcs/:vpcId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, vpcId } = req.params;
        const { VpcName, Description } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!vpcId) return res.status(400).json({ message: '缺少 VPC 标识 vpcId' });
        if (VpcName === undefined && Description === undefined)
          return res
            .status(400)
            .json({ message: '至少提供一个可修改字段：VpcName 或 Description' });
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ModifyVpcAttribute',
          extraParams: {
            VpcId: vpcId,
            ...(VpcName ? { VpcName } : {}),
            ...(Description ? { Description } : {}),
          },
        } as any);
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新VPC失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/vswitches',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId, PageNumber, PageSize } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '缺少阿里云访问密钥' });

        // Native Mode
        if (PageNumber || PageSize) {
          const data = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeVSwitches',
            extraParams: {
              PageNumber: PageNumber || 1,
              PageSize: PageSize || 50,
              ...(vpcId ? { VpcId: vpcId } : {}),
            },
          } as any);
          const capabilities = {
            isHarvester: false,
            supportsVpc: true,
            supportsNetworkFusion: false,
            supportsMultus: false,
          };
          return res.json({ message: '查询成功', data, capabilities });
        }

        // Encapsulated Mode (Aggregation)
        const pageSize = 50;
        let page = 1;
        let all: any[] = [];
        while (true) {
          const resp = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeVSwitches',
            extraParams: {
              PageNumber: page,
              PageSize: pageSize,
              ...(vpcId ? { VpcId: vpcId } : {}),
            },
          } as any);
          const chunk = resp?.VSwitches?.VSwitch || [];
          all = all.concat(Array.isArray(chunk) ? chunk : []);
          if (!Array.isArray(chunk) || chunk.length < pageSize) break;
          page += 1;
          if (page > 50) break;
        }
        const p = String(cloud.config?.provider || '').toLowerCase();
        const capabilities = {
          isHarvester: p === 'harvester',
          supportsVpc: true,
          supportsNetworkFusion: false,
          supportsMultus: false,
        };
        res.json({ message: '查询成功', data: { VSwitches: { VSwitch: all } }, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询子网失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/vswitches',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { VpcId, ZoneId, CidrBlock, VSwitchName, Description } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!VpcId || !ZoneId || !CidrBlock)
          return res.status(400).json({ message: '缺少必填参数：VpcId、ZoneId、CidrBlock' });
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const extraParams: Record<string, any> = { VpcId, ZoneId, CidrBlock };
        if (VSwitchName) extraParams.VSwitchName = VSwitchName;
        if (Description) extraParams.Description = Description;
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateVSwitch',
          extraParams,
        });
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建VSwitch失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/vswitches/:vswitchId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, vswitchId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!vswitchId) return res.status(400).json({ message: '缺少 VSwitch 标识 vswitchId' });
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteVSwitch',
          extraParams: { VSwitchId: vswitchId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除VSwitch失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '缺少阿里云访问密钥' });
        const pageSize = 50;
        let page = 1;
        let all: any[] = [];
        while (true) {
          const resp = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeVSwitches',
            extraParams: {
              PageNumber: page,
              PageSize: pageSize,
              ...(vpcId ? { VpcId: vpcId } : {}),
            },
          } as any);
          const chunk = resp?.VSwitches?.VSwitch || [];
          all = all.concat(Array.isArray(chunk) ? chunk : []);
          if (!Array.isArray(chunk) || chunk.length < pageSize) break;
          page += 1;
          if (page > 50) break;
        }
        const capabilities = {
          isHarvester: false,
          supportsSubnets: true,
          supportsNetworkFusion: false,
          supportsMultus: false,
        };
        res.json({ message: '查询成功', data: { VSwitches: { VSwitch: all } }, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询子网失败', error: error.message });
      }
    },
  );

  // Security Groups
  router.get(
    '/:id/resources/security-groups',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { PageNumber, PageSize } = req.query || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });

        const extraParams: any = {};
        if (PageNumber) extraParams.PageNumber = PageNumber;
        if (PageSize) extraParams.PageSize = PageSize;
        if (!PageNumber && !PageSize) {
          extraParams.PageNumber = 1;
          extraParams.PageSize = 50;
        } // Default behavior

        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeSecurityGroups',
          extraParams,
        } as any);
        const capabilities = { isHarvester: false, supportsEip: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询SecurityGroups失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/security-groups',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId, name, description } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!vpcId || !name) return res.status(400).json({ message: '缺少必要参数 vpcId 或 name' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateSecurityGroup',
          extraParams: {
            VpcId: vpcId,
            SecurityGroupName: name,
            ...(description ? { Description: description } : {}),
          },
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建安全组失败', error: error.message });
      }
    },
  );
  router.patch(
    '/:id/resources/security-groups/:sgId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId } = req.params;
        const { name, description } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ModifySecurityGroupAttribute',
          extraParams: {
            SecurityGroupId: sgId,
            ...(name ? { SecurityGroupName: name } : {}),
            ...(description ? { Description: description } : {}),
          },
        } as any);
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新安全组失败', error: error.message });
      }
    },
  );
  router.delete(
    '/:id/resources/security-groups/:sgId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteSecurityGroup',
          extraParams: { SecurityGroupId: sgId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除安全组失败', error: error.message });
      }
    },
  );

  // Security Group Rules
  router.get(
    '/:id/resources/security-groups/:sgId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });

        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeSecurityGroupAttribute',
          extraParams: { SecurityGroupId: sgId, Direction: 'all' },
        } as any);

        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询安全组详情失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/security-groups/:sgId/rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId } = req.params;
        const {
          direction,
          ipProtocol,
          portRange,
          cidrIp,
          policy,
          priority,
          description,
          nicType,
          sourceGroupId,
        } = req.body || {};

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });

        const isEgress = direction === 'egress' || direction === 'outbound';
        const action = isEgress ? 'AuthorizeSecurityGroupEgress' : 'AuthorizeSecurityGroup';

        const extraParams: any = {
          SecurityGroupId: sgId,
          IpProtocol: ipProtocol || 'tcp',
          PortRange: portRange || '-1/-1',
          Policy: policy || 'accept',
          NicType: nicType || 'intranet', // default to intranet for VPC
        };

        if (priority) extraParams.Priority = priority;
        if (description) extraParams.Description = description;

        // Address mapping
        if (cidrIp) {
          if (isEgress) extraParams.DestCidrIp = cidrIp;
          else extraParams.SourceCidrIp = cidrIp;
        } else if (sourceGroupId) {
          // Security Group to Security Group authorization
          if (isEgress) extraParams.DestGroupId = sourceGroupId;
          else extraParams.SourceGroupId = sourceGroupId;
        } else {
          // default to all if nothing specified? Or throw error?
          // Let's require at least one target
          return res
            .status(400)
            .json({ message: '必须指定 CIDR (cidrIp) 或 安全组ID (sourceGroupId)' });
        }

        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action,
          extraParams,
        } as any);

        res.json({ message: '规则添加成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '添加安全组规则失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/security-groups/:sgId/rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId } = req.params;
        // Delete usually requires the same parameters as Create to identify the rule
        const {
          direction,
          ipProtocol,
          portRange,
          cidrIp,
          policy,
          priority,
          nicType,
          sourceGroupId,
        } = req.body || {};

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });

        const isEgress = direction === 'egress' || direction === 'outbound';
        const action = isEgress ? 'RevokeSecurityGroupEgress' : 'RevokeSecurityGroup';

        const extraParams: any = {
          SecurityGroupId: sgId,
          IpProtocol: ipProtocol || 'tcp',
          PortRange: portRange || '-1/-1',
          Policy: policy || 'accept', // Revoke usually doesn't need policy, but Aliyun docs say "The parameters that you specified must effectively identify a rule."
          NicType: nicType || 'intranet',
        };

        // Some params might be optional for revoke if unique, but best to provide all
        if (priority) extraParams.Priority = priority;

        if (cidrIp) {
          if (isEgress) extraParams.DestCidrIp = cidrIp;
          else extraParams.SourceCidrIp = cidrIp;
        } else if (sourceGroupId) {
          if (isEgress) extraParams.DestGroupId = sourceGroupId;
          else extraParams.SourceGroupId = sourceGroupId;
        } else {
          return res
            .status(400)
            .json({ message: '必须指定 CIDR (cidrIp) 或 安全组ID (sourceGroupId)' });
        }

        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action,
          extraParams,
        } as any);

        res.json({ message: '规则删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除安全组规则失败', error: error.message });
      }
    },
  );

  // ENIs
  router.get(
    '/:id/resources/enis',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vSwitchId, instanceId, vpcId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const pageSize = 50;
        let page = 1;
        let all: any[] = [];
        while (true) {
          const resp = await callAliyunEcs({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeNetworkInterfaces',
            extraParams: {
              PageNumber: page,
              PageSize: pageSize,
              ...(vSwitchId ? { VSwitchId: vSwitchId } : {}),
              ...(instanceId ? { InstanceId: instanceId } : {}),
              ...(vpcId ? { VpcId: vpcId } : {}),
            },
          } as any);
          const chunk =
            resp?.NetworkInterfaces?.NetworkInterface ||
            resp?.NetworkInterfaceSets?.NetworkInterfaceSet ||
            resp?.data?.NetworkInterfaces?.NetworkInterface ||
            resp?.data?.NetworkInterfaceSets?.NetworkInterfaceSet ||
            [];

          // Debug logging
          if (Array.isArray(chunk)) {
            chunk.forEach((eni: any) => {
              console.log(
                '[Aliyun Debug] Fetched ENI:',
                eni.NetworkInterfaceId,
                'IP:',
                eni.PrivateIpAddress,
                'PrimaryIP:',
                eni.PrimaryIpAddress,
              );
            });
          }

          all = all.concat(Array.isArray(chunk) ? chunk : []);
          if (!Array.isArray(chunk) || chunk.length < pageSize) break;
          page += 1;
          if (page > 50) break;
        }
        const capabilities = { isHarvester: false, supportsEni: true };
        res.json({
          message: '查询成功',
          data: { NetworkInterfaces: { NetworkInterface: all } },
          capabilities,
        });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询ENI失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/enis',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vSwitchId, securityGroupId, name, description, ipv4Address } = (req.body ||
          {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!vSwitchId || !securityGroupId)
          return res.status(400).json({ message: '缺少必要参数：vSwitchId 或 securityGroupId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateNetworkInterface',
          extraParams: {
            VSwitchId: vSwitchId,
            SecurityGroupId: securityGroupId,
            ...(name ? { NetworkInterfaceName: name } : {}),
            ...(description ? { Description: description } : {}),
            ...(ipv4Address ? { PrimaryIpAddress: ipv4Address } : {}),
          },
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建ENI失败', error: error.message });
      }
    },
  );
  router.patch(
    '/:id/resources/enis/:eniId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, eniId } = req.params;
        const { name, description, sourceDestCheck } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const extraParams: any = { NetworkInterfaceId: eniId };
        if (name) extraParams.NetworkInterfaceName = name;
        if (description) extraParams.Description = description;
        if (sourceDestCheck !== undefined) {
          // Ensure boolean type
          const val = sourceDestCheck === true || String(sourceDestCheck) === 'true';
          extraParams.SourceDestCheck = val;
          console.log(
            '[Aliyun Debug] Updating ENI:',
            eniId,
            'SourceDestCheck (Input):',
            sourceDestCheck,
            'SourceDestCheck (Payload):',
            val,
          );
        }
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ModifyNetworkInterfaceAttribute',
          extraParams,
        } as any);
        console.log('[Aliyun Debug] Update result:', JSON.stringify(result));
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新ENI失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/enis/:eniId/attach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, eniId } = req.params;
        const {
          instanceId,
          trunkNetworkInstanceId,
          networkCardIndex,
          waitForNetworkConfigurationReady,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!instanceId) return res.status(400).json({ message: '缺少必要参数：instanceId' });
        const extraParams: any = { NetworkInterfaceId: eniId, InstanceId: instanceId };
        if (trunkNetworkInstanceId) extraParams.TrunkNetworkInstanceId = trunkNetworkInstanceId;
        if (networkCardIndex !== undefined) extraParams.NetworkCardIndex = networkCardIndex;
        if (waitForNetworkConfigurationReady !== undefined)
          extraParams.WaitForNetworkConfigurationReady = waitForNetworkConfigurationReady;
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'AttachNetworkInterface',
          extraParams,
        } as any);
        res.json({ message: '挂载成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '挂载ENI失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/enis/:eniId/detach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, eniId } = req.params;
        const { instanceId } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!instanceId) return res.status(400).json({ message: '缺少必要参数：instanceId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DetachNetworkInterface',
          extraParams: { NetworkInterfaceId: eniId, InstanceId: instanceId },
        } as any);
        res.json({ message: '卸载成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '卸载ENI失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/enis/:eniId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, eniId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteNetworkInterface',
          extraParams: { NetworkInterfaceId: eniId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除ENI失败', error: error.message });
      }
    },
  );

  // Network ACLs
  router.get(
    '/:id/resources/network-acls',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const data = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeNetworkAcls',
          extraParams: { ...(vpcId ? { VpcId: vpcId } : {}) },
        } as any);
        const capabilities = { isHarvester: false, supportsRouteTables: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询网络ACL失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/network-acls',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId, name, description } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!vpcId || !name)
          return res.status(400).json({ message: '缺少必要参数：vpcId 或 name' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateNetworkAcl',
          extraParams: {
            VpcId: vpcId,
            NetworkAclName: name,
            ...(description ? { Description: description } : {}),
          },
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建网络ACL失败', error: error.message });
      }
    },
  );
  router.patch(
    '/:id/resources/network-acls/:aclId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, aclId } = req.params;
        const { name, description } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'UpdateNetworkAclAttributes',
          extraParams: {
            NetworkAclId: aclId,
            ...(name ? { NetworkAclName: name } : {}),
            ...(description ? { Description: description } : {}),
          },
        } as any);
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新网络ACL失败', error: error.message });
      }
    },
  );
  router.delete(
    '/:id/resources/network-acls/:aclId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, aclId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteNetworkAcl',
          extraParams: { NetworkAclId: aclId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除网络ACL失败', error: error.message });
      }
    },
  );

  // 更新网络ACL规则（整组覆盖 ingress/egress） UpdateNetworkAclEntries
  router.patch(
    '/:id/resources/network-acls/:aclId/entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, aclId } = req.params;
        const { ingress, egress } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!aclId) return res.status(400).json({ message: '缺少网络ACL标识 NetworkAclId' });
        const extraParams: Record<string, any> = { NetworkAclId: aclId };
        const inArr = Array.isArray(ingress) ? ingress : [];
        const egArr = Array.isArray(egress) ? egress : [];
        // 阿里云规定：传 IngressAclEntries 即覆盖入方向；传 EgressAclEntries 即覆盖出方向
        if (Array.isArray(ingress)) {
          extraParams.UpdateIngressAclEntries = true;
          inArr.forEach((e: any, i: number) => {
            const n = i + 1;
            extraParams[`IngressAclEntries.${n}.NetworkAclEntryName`] = e?.name || '';
            extraParams[`IngressAclEntries.${n}.Policy`] = e?.policy || 'accept';
            extraParams[`IngressAclEntries.${n}.Protocol`] = e?.protocol || 'all';
            extraParams[`IngressAclEntries.${n}.SourceCidrIp`] = e?.sourceCidrIp || '0.0.0.0/0';
            extraParams[`IngressAclEntries.${n}.Port`] = e?.port || '-1/-1';
            if (e?.description) extraParams[`IngressAclEntries.${n}.Description`] = e.description;
          });
        }
        if (Array.isArray(egress)) {
          extraParams.UpdateEgressAclEntries = true;
          egArr.forEach((e: any, i: number) => {
            const n = i + 1;
            extraParams[`EgressAclEntries.${n}.NetworkAclEntryName`] = e?.name || '';
            extraParams[`EgressAclEntries.${n}.Policy`] = e?.policy || 'accept';
            extraParams[`EgressAclEntries.${n}.Protocol`] = e?.protocol || 'all';
            extraParams[`EgressAclEntries.${n}.DestinationCidrIp`] = e?.destinationCidrIp || '0.0.0.0/0';
            extraParams[`EgressAclEntries.${n}.Port`] = e?.port || '-1/-1';
            if (e?.description) extraParams[`EgressAclEntries.${n}.Description`] = e.description;
          });
        }
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'UpdateNetworkAclEntries',
          extraParams,
        } as any);
        res.json({ message: '规则更新成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新网络ACL规则失败', error: error.message });
      }
    },
  );

  // 关联网络ACL到交换机 AssociateNetworkAcl
  router.post(
    '/:id/resources/network-acls/:aclId/associate',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, aclId } = req.params;
        const { vSwitchIds } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const ids: string[] = Array.isArray(vSwitchIds) ? vSwitchIds : [];
        if (!aclId || ids.length === 0)
          return res.status(400).json({ message: '缺少 NetworkAclId 或交换机列表' });
        const extraParams: Record<string, any> = { NetworkAclId: aclId };
        ids.forEach((vid: string, i: number) => {
          const n = i + 1;
          extraParams[`Resource.${n}.ResourceId`] = vid;
          extraParams[`Resource.${n}.ResourceType`] = 'VSwitch';
        });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'AssociateNetworkAcl',
          extraParams,
        } as any);
        res.json({ message: '关联成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '关联网络ACL失败', error: error.message });
      }
    },
  );

  // 解除网络ACL与交换机关联 UnassociateNetworkAcl
  router.post(
    '/:id/resources/network-acls/:aclId/unassociate',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, aclId } = req.params;
        const { vSwitchIds } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const ids: string[] = Array.isArray(vSwitchIds) ? vSwitchIds : [];
        if (!aclId || ids.length === 0)
          return res.status(400).json({ message: '缺少 NetworkAclId 或交换机列表' });
        const extraParams: Record<string, any> = { NetworkAclId: aclId };
        ids.forEach((vid: string, i: number) => {
          const n = i + 1;
          extraParams[`Resource.${n}.ResourceId`] = vid;
          extraParams[`Resource.${n}.ResourceType`] = 'VSwitch';
        });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'UnassociateNetworkAcl',
          extraParams,
        } as any);
        res.json({ message: '解除关联成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '解除网络ACL关联失败', error: error.message });
      }
    },
  );

  // EIPs
  router.get(
    '/:id/resources/eips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const data = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeEipAddresses',
          extraParams: { PageNumber: 1, PageSize: 50 },
        } as any);
        const capabilities = { isHarvester: false, supportsEip: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询EIP失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/eips/:allocationId/associate',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, allocationId } = req.params;
        const { InstanceId, NetworkInterfaceId, PrivateIpAddress } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!allocationId) return res.status(400).json({ message: '缺少 EIP 标识 AllocationId' });
        if (!InstanceId && !NetworkInterfaceId)
          return res
            .status(400)
            .json({ message: '请提供 InstanceId 或 NetworkInterfaceId 用于绑定' });
        const extraParams: Record<string, any> = { AllocationId: allocationId };
        if (NetworkInterfaceId) {
          extraParams.InstanceType = 'NetworkInterface';
          extraParams.InstanceId = NetworkInterfaceId;
          if (PrivateIpAddress) extraParams.PrivateIpAddress = PrivateIpAddress;
          extraParams.Mode = 'NAT';
        } else if (InstanceId) {
          extraParams.InstanceId = InstanceId;
        }
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'AssociateEipAddress',
          extraParams,
        } as any);
        res.json({ message: '绑定成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '绑定EIP失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/eips/:allocationId/unassociate',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, allocationId } = req.params;
        const { InstanceId, NetworkInterfaceId, PrivateIpAddress } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!allocationId) return res.status(400).json({ message: '缺少 EIP 标识 AllocationId' });
        const extraParams: Record<string, any> = { AllocationId: allocationId };
        if (NetworkInterfaceId) {
          extraParams.InstanceType = 'NetworkInterface';
          extraParams.InstanceId = NetworkInterfaceId;
          if (PrivateIpAddress) extraParams.PrivateIpAddress = PrivateIpAddress;
        } else if (InstanceId) {
          extraParams.InstanceId = InstanceId;
        }
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'UnassociateEipAddress',
          extraParams,
        } as any);
        res.json({ message: '解绑成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '解绑EIP失败', error: error.message });
      }
    },
  );

  // 申请 EIP AllocateEipAddress
  router.post(
    '/:id/resources/eips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { bandwidth, internetChargeType, name, isp } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const extraParams: Record<string, any> = {};
        if (bandwidth != null) extraParams.Bandwidth = String(bandwidth);
        if (internetChargeType) extraParams.InternetChargeType = internetChargeType;
        if (name) extraParams.Name = name;
        if (isp) extraParams.ISP = isp;
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'AllocateEipAddress',
          extraParams,
        } as any);
        res.json({ message: '申请成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '申请EIP失败', error: error.message });
      }
    },
  );

  // 释放 EIP ReleaseEipAddress
  router.delete(
    '/:id/resources/eips/:allocationId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, allocationId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!allocationId) return res.status(400).json({ message: '缺少 EIP 标识 AllocationId' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ReleaseEipAddress',
          extraParams: { AllocationId: allocationId },
        } as any);
        res.json({ message: '释放成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '释放EIP失败', error: error.message });
      }
    },
  );

  // Load Balancers
  router.get(
    '/:id/resources/loadbalancers',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const data = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeLoadBalancers',
          extraParams: { PageNumber: 1, PageSize: 50 },
        } as any);
        const capabilities = { isHarvester: false, supportsSnapshots: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询负载均衡失败', error: error.message });
      }
    },
  );

  // SLB 详情（含监听器与后端服务器） DescribeLoadBalancerAttribute
  router.get(
    '/:id/resources/loadbalancers/:lbId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeLoadBalancerAttribute',
          extraParams: { LoadBalancerId: lbId },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询负载均衡详情失败', error: error.message });
      }
    },
  );

  // SLB 后端服务器健康状态 DescribeHealthStatus
  router.get(
    '/:id/resources/loadbalancers/:lbId/health',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeHealthStatus',
          extraParams: { LoadBalancerId: lbId },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询健康状态失败', error: error.message });
      }
    },
  );

  // SLB 添加后端服务器 AddBackendServers
  router.post(
    '/:id/resources/loadbalancers/:lbId/backend-servers',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const { servers } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const arr = Array.isArray(servers) ? servers : [];
        if (arr.length === 0) return res.status(400).json({ message: '缺少后端服务器列表' });
        const backend = arr.map((s: any) => ({ ServerId: s?.serverId, Weight: String(s?.weight ?? 100) }));
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'AddBackendServers',
          extraParams: { LoadBalancerId: lbId, BackendServers: JSON.stringify(backend) },
        } as any);
        res.json({ message: '添加成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '添加后端服务器失败', error: error.message });
      }
    },
  );

  // SLB 移除后端服务器 RemoveBackendServers
  router.delete(
    '/:id/resources/loadbalancers/:lbId/backend-servers',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const { serverIds } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const ids = Array.isArray(serverIds) ? serverIds : [];
        if (ids.length === 0) return res.status(400).json({ message: '缺少后端服务器 ID 列表' });
        const backend = ids.map((sid: string) => ({ ServerId: sid }));
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'RemoveBackendServers',
          extraParams: { LoadBalancerId: lbId, BackendServers: JSON.stringify(backend) },
        } as any);
        res.json({ message: '移除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '移除后端服务器失败', error: error.message });
      }
    },
  );

  // SLB 监听器 启停/删除
  router.post(
    '/:id/resources/loadbalancers/:lbId/listeners/:port/:op',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId, port, op } = req.params;
        const { protocol } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const actionMap: Record<string, string> = {
          start: 'StartLoadBalancerListener',
          stop: 'StopLoadBalancerListener',
          delete: 'DeleteLoadBalancerListener',
        };
        const action = actionMap[String(op)];
        if (!action) return res.status(400).json({ message: '不支持的操作' });
        const extraParams: Record<string, any> = { LoadBalancerId: lbId, ListenerPort: Number(port) };
        if (protocol) extraParams.ListenerProtocol = protocol;
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action,
          extraParams,
        } as any);
        res.json({ message: '操作成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '监听器操作失败', error: error.message });
      }
    },
  );

  // 创建 SLB 实例 CreateLoadBalancer
  router.post(
    '/:id/resources/loadbalancers',
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
        const extraParams: Record<string, any> = {
          AddressType: b.addressType || 'intranet',
          PayType: b.payType || 'PayOnDemand',
          LoadBalancerSpec: b.loadBalancerSpec || 'slb.s1.small',
        };
        if (b.loadBalancerName) extraParams.LoadBalancerName = b.loadBalancerName;
        if (b.vpcId) extraParams.VpcId = b.vpcId;
        if (b.vSwitchId) extraParams.VSwitchId = b.vSwitchId;
        if (b.masterZoneId) extraParams.MasterZoneId = b.masterZoneId;
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateLoadBalancer',
          extraParams,
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建负载均衡失败', error: error.message });
      }
    },
  );

  // 删除 SLB 实例 DeleteLoadBalancer
  router.delete(
    '/:id/resources/loadbalancers/:lbId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteLoadBalancer',
          extraParams: { LoadBalancerId: lbId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除负载均衡失败', error: error.message });
      }
    },
  );

  // 创建 SLB 监听器（按协议分发，创建后自动启动）
  router.post(
    '/:id/resources/loadbalancers/:lbId/listeners',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const b = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const protocol = String(b.protocol || '').toLowerCase();
        const listenerPort = Number(b.listenerPort);
        const backendServerPort = Number(b.backendServerPort || b.listenerPort);
        if (!protocol || !listenerPort) return res.status(400).json({ message: '缺少 protocol 或 listenerPort' });
        const actionMap: Record<string, string> = {
          tcp: 'CreateLoadBalancerTCPListener',
          udp: 'CreateLoadBalancerUDPListener',
          http: 'CreateLoadBalancerHTTPListener',
          https: 'CreateLoadBalancerHTTPSListener',
        };
        const action = actionMap[protocol];
        if (!action) return res.status(400).json({ message: '不支持的协议' });
        const extraParams: Record<string, any> = {
          LoadBalancerId: lbId,
          ListenerPort: listenerPort,
          BackendServerPort: backendServerPort,
          Bandwidth: Number(b.bandwidth ?? -1),
        };
        if (protocol === 'http' || protocol === 'https') {
          extraParams.StickySession = b.stickySession || 'off';
          extraParams.HealthCheck = b.healthCheck || 'on';
        }
        if (protocol === 'https') {
          if (!b.serverCertificateId) return res.status(400).json({ message: 'HTTPS 监听器需 serverCertificateId' });
          extraParams.ServerCertificateId = b.serverCertificateId;
        }
        await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action,
          extraParams,
        } as any);
        // 创建后启动监听器使其生效
        await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'StartLoadBalancerListener',
          extraParams: { LoadBalancerId: lbId, ListenerPort: listenerPort, ListenerProtocol: protocol },
        } as any).catch(() => undefined);
        res.json({ message: '创建监听器成功' });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建监听器失败', error: error.message });
      }
    },
  );

  // SLB 转发规则列表 DescribeRules（HTTP/HTTPS）
  router.get(
    '/:id/resources/loadbalancers/:lbId/rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const { listenerPort } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!listenerPort) return res.status(400).json({ message: '缺少 listenerPort' });
        const data = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeRules',
          extraParams: { LoadBalancerId: lbId, ListenerPort: Number(listenerPort) },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询转发规则失败', error: error.message });
      }
    },
  );

  // 创建 SLB 转发规则 CreateRules
  router.post(
    '/:id/resources/loadbalancers/:lbId/rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const { listenerPort, rules } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const arr = Array.isArray(rules) ? rules : [];
        if (!listenerPort || arr.length === 0) return res.status(400).json({ message: '缺少 listenerPort 或规则列表' });
        const ruleList = arr.map((r: any) => ({
          RuleName: r?.ruleName,
          Domain: r?.domain,
          Url: r?.url,
          VServerGroupId: r?.vServerGroupId,
        }));
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateRules',
          extraParams: { LoadBalancerId: lbId, ListenerPort: Number(listenerPort), RuleList: JSON.stringify(ruleList) },
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建转发规则失败', error: error.message });
      }
    },
  );

  // 删除 SLB 转发规则 DeleteRules
  router.delete(
    '/:id/resources/loadbalancers/:lbId/rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, lbId } = req.params;
        const { ruleIds } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const ids = Array.isArray(ruleIds) ? ruleIds : [];
        if (ids.length === 0) return res.status(400).json({ message: '缺少规则 ID 列表' });
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteRules',
          extraParams: { LoadBalancerId: lbId, RuleIds: JSON.stringify(ids) },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除转发规则失败', error: error.message });
      }
    },
  );

  // SLB 服务器证书列表 DescribeServerCertificates
  router.get(
    '/:id/resources/server-certificates',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeServerCertificates',
          extraParams: {},
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询服务器证书失败', error: error.message });
      }
    },
  );

  // 上传 SLB 服务器证书 UploadServerCertificate
  router.post(
    '/:id/resources/server-certificates',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { name, serverCertificate, privateKey } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!serverCertificate || !privateKey) return res.status(400).json({ message: '缺少证书内容或私钥' });
        const extraParams: Record<string, any> = { ServerCertificate: serverCertificate, PrivateKey: privateKey };
        if (name) extraParams.ServerCertificateName = name;
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'UploadServerCertificate',
          extraParams,
        } as any);
        res.json({ message: '上传成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '上传证书失败', error: error.message });
      }
    },
  );

  // 删除 SLB 服务器证书 DeleteServerCertificate
  router.delete(
    '/:id/resources/server-certificates/:certId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, certId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunSlb({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteServerCertificate',
          extraParams: { ServerCertificateId: certId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除证书失败', error: error.message });
      }
    },
  );

  // NAT Gateways
  router.get(
    '/:id/resources/nat-gateways',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const data = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeNatGateways',
          extraParams: { PageNumber: 1, PageSize: 50 },
        } as any);
        const capabilities = { isHarvester: false, supportsRouteTables: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询NAT网关失败', error: error.message });
      }
    },
  );

  // SNAT 规则列表 DescribeSnatTableEntries
  router.get(
    '/:id/resources/nat-gateways/snat-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { snatTableId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!snatTableId) return res.status(400).json({ message: '缺少 snatTableId' });
        const data = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeSnatTableEntries',
          extraParams: { SnatTableId: snatTableId, PageSize: 50, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询SNAT规则失败', error: error.message });
      }
    },
  );

  // 创建 SNAT 规则 CreateSnatEntry
  router.post(
    '/:id/resources/nat-gateways/snat-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { snatTableId, snatIp, sourceVSwitchId, sourceCIDR, snatEntryName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!snatTableId || !snatIp || (!sourceVSwitchId && !sourceCIDR))
          return res.status(400).json({ message: '缺少 snatTableId / snatIp / 源(交换机或CIDR)' });
        const extraParams: Record<string, any> = { SnatTableId: snatTableId, SnatIp: snatIp };
        if (sourceVSwitchId) extraParams.SourceVSwitchId = sourceVSwitchId;
        if (sourceCIDR) extraParams.SourceCIDR = sourceCIDR;
        if (snatEntryName) extraParams.SnatEntryName = snatEntryName;
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateSnatEntry',
          extraParams,
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建SNAT规则失败', error: error.message });
      }
    },
  );

  // 删除 SNAT 规则 DeleteSnatEntry
  router.delete(
    '/:id/resources/nat-gateways/snat-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { snatTableId, snatEntryId } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!snatTableId || !snatEntryId) return res.status(400).json({ message: '缺少 snatTableId 或 snatEntryId' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteSnatEntry',
          extraParams: { SnatTableId: snatTableId, SnatEntryId: snatEntryId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除SNAT规则失败', error: error.message });
      }
    },
  );

  // DNAT 规则列表 DescribeForwardTableEntries
  router.get(
    '/:id/resources/nat-gateways/forward-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { forwardTableId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!forwardTableId) return res.status(400).json({ message: '缺少 forwardTableId' });
        const data = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeForwardTableEntries',
          extraParams: { ForwardTableId: forwardTableId, PageSize: 50, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询DNAT规则失败', error: error.message });
      }
    },
  );

  // 创建 DNAT 规则 CreateForwardEntry
  router.post(
    '/:id/resources/nat-gateways/forward-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { forwardTableId, externalIp, externalPort, internalIp, internalPort, ipProtocol, forwardEntryName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!forwardTableId || !externalIp || !internalIp || !ipProtocol)
          return res.status(400).json({ message: '缺少必要参数' });
        const extraParams: Record<string, any> = {
          ForwardTableId: forwardTableId,
          ExternalIp: externalIp,
          ExternalPort: String(externalPort || 'any'),
          InternalIp: internalIp,
          InternalPort: String(internalPort || 'any'),
          IpProtocol: ipProtocol,
        };
        if (forwardEntryName) extraParams.ForwardEntryName = forwardEntryName;
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateForwardEntry',
          extraParams,
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建DNAT规则失败', error: error.message });
      }
    },
  );

  // 删除 DNAT 规则 DeleteForwardEntry
  router.delete(
    '/:id/resources/nat-gateways/forward-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { forwardTableId, forwardEntryId } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!forwardTableId || !forwardEntryId) return res.status(400).json({ message: '缺少 forwardTableId 或 forwardEntryId' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteForwardEntry',
          extraParams: { ForwardTableId: forwardTableId, ForwardEntryId: forwardEntryId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除DNAT规则失败', error: error.message });
      }
    },
  );

  // VPN Gateways
  router.get(
    '/:id/resources/vpn-gateways',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const data = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeVpnGateways',
          extraParams: { PageNumber: 1, PageSize: 50 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询VPN网关失败', error: error.message });
      }
    },
  );

  // VPN 连接列表 DescribeVpnConnections
  router.get(
    '/:id/resources/vpn-connections',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpnGatewayId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeVpnConnections',
          extraParams: { PageNumber: 1, PageSize: 50, ...(vpnGatewayId ? { VpnGatewayId: vpnGatewayId } : {}) },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询VPN连接失败', error: error.message });
      }
    },
  );

  // 删除 VPN 网关 DeleteVpnGateway
  router.delete(
    '/:id/resources/vpn-gateways/:vpnGatewayId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, vpnGatewayId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!vpnGatewayId) return res.status(400).json({ message: '缺少 VpnGatewayId' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteVpnGateway',
          extraParams: { VpnGatewayId: vpnGatewayId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除VPN网关失败', error: error.message });
      }
    },
  );

  // Route Tables
  router.get(
    '/:id/resources/route-tables',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId } = req.query as { vpcId?: string };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '缺少阿里云访问密钥' });
        const fetchRtByVpc = async (VpcId: string) => {
          const resp: any = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeRouteTableList',
            extraParams: { VpcId, RouterType: 'VRouter', PageNumber: 1, PageSize: 50 },
          } as any);
          const arr: any[] = resp?.RouterTableList?.RouterTableListType || [];
          return Array.isArray(arr) ? arr : [];
        };
        let data: any;
        if (vpcId) {
          data = await fetchRtByVpc(vpcId);
        } else {
          const vpcResp: any = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeVpcs',
            extraParams: { PageNumber: 1, PageSize: 50 },
          } as any);
          const vpcs: any[] = vpcResp?.Vpcs?.Vpc || [];
          const ids: string[] = (Array.isArray(vpcs) ? vpcs : [])
            .map((v) => v?.VpcId)
            .filter(Boolean);
          const all: any[] = [];
          for (const vid of ids) {
            const items = await fetchRtByVpc(vid);
            all.push(...items);
          }
          data = all;
        }
        const capabilities = { isHarvester: false, supportsDisk: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询路由表失败', error: error.message });
      }
    },
  );
  router.get(
    '/:id/resources/route-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { routeTableId } = req.query as { routeTableId?: string };
        if (!routeTableId) return res.status(400).json({ message: '缺少 routeTableId 参数' });
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '缺少阿里云访问密钥' });
        const pageSize = 50;
        let page = 1;
        let all: any[] = [];
        while (true) {
          const resp: any = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeRouteEntryList',
            extraParams: { RouteTableId: routeTableId, PageNumber: page, PageSize: pageSize },
          } as any);
          const chunk =
            resp?.RouteEntries?.RouteEntry ||
            resp?.RouteEntryList?.RouteEntry ||
            resp?.RouteEntrys?.RouteEntry ||
            resp?.RouteEntry ||
            [];
          const arr = Array.isArray(chunk) ? chunk : chunk ? [chunk] : [];
          all = all.concat(arr);
          if (!Array.isArray(chunk) || arr.length < pageSize) break;
          page += 1;
          if (page > 50) break;
        }
        if (!Array.isArray(all) || all.length === 0) {
          const pageSizeRt = 50;
          let pageRt = 1;
          let found: any = null;
          while (true) {
            const resp2: any = await callAliyunVpc({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeRouteTableList',
              extraParams: { RouterType: 'VRouter', PageNumber: pageRt, PageSize: pageSizeRt },
            } as any);
            const arrRt: any[] = resp2?.RouterTableList?.RouterTableListType || [];
            if (Array.isArray(arrRt) && arrRt.length) {
              found =
                arrRt.find(
                  (it: any) =>
                    String(it?.RouteTableId || it?.route_table_id || '') ===
                    String(routeTableId || ''),
                ) || found;
            }
            if (!Array.isArray(arrRt) || arrRt.length < pageSizeRt || found || pageRt >= 50) break;
            pageRt += 1;
          }
          const entries = found?.RouteEntrys?.RouteEntry || found?.RouteEntries?.RouteEntry || [];
          if (Array.isArray(entries) && entries.length) all = entries;
          if ((!Array.isArray(all) || all.length === 0) && found?.VpcId) {
            try {
              const vpcId = String(found.VpcId || '');
              const vpcResp: any = await callAliyunVpc({
                accessKeyId: cloud.accessKey,
                accessKeySecret: cloud.secretKey,
                regionId: cloud.region,
                action: 'DescribeVpcs',
                extraParams: { VpcId: vpcId, PageNumber: 1, PageSize: 1 },
              } as any);
              const vpcs: any[] = vpcResp?.Vpcs?.Vpc || [];
              const vpc = Array.isArray(vpcs)
                ? vpcs.find((v) => String(v?.VpcId || '') === vpcId)
                : null;
              const cidr = String(vpc?.CidrBlock || '');
              if (cidr) {
                all = [
                  {
                    DestinationCidrBlock: cidr,
                    NextHopId: '',
                    NextHopType: '',
                    RouteEntryType: 'System',
                  },
                ];
              }
            } catch {}
          }
        }
        const normalized = (Array.isArray(all) ? all : []).map((entry: any) => {
          const nextHops = entry.NextHops?.NextHop;
          const firstHop = Array.isArray(nextHops) ? nextHops[0] : nextHops ? nextHops : null;
          const NextHopId = entry.NextHopId || firstHop?.NextHopId || '';
          const NextHopType = entry.NextHopType || firstHop?.NextHopType || '';

          return {
            ...entry,
            NextHopId,
            NextHopType,
            RouteEntryType:
              entry?.Type ||
              entry?.RouteEntryType ||
              (String(NextHopId).trim() === '' || String(NextHopId).trim() === '-'
                ? 'System'
                : 'Custom'),
          };
        });
        res.json({ message: '查询成功', data: normalized });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询路由条目失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/route-tables',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId, name, description } = (req.body || {}) as {
          vpcId?: string;
          name?: string;
          description?: string;
        };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!vpcId) return res.status(400).json({ message: '缺少必要参数：vpcId' });
        const extraParams: Record<string, any> = { VpcId: vpcId, RouterType: 'VRouter' };
        if (name) extraParams.RouteTableName = name;
        if (description) extraParams.Description = description;
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateRouteTable',
          extraParams,
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建路由表失败', error: error.message });
      }
    },
  );
  router.patch(
    '/:id/resources/route-tables/:routeTableId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, routeTableId } = req.params;
        const { name, description } = (req.body || {}) as { name?: string; description?: string };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const extraParams: Record<string, any> = { RouteTableId: routeTableId };
        if (name !== undefined) extraParams.RouteTableName = name;
        if (description !== undefined) extraParams.Description = description;
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ModifyRouteTableAttributes',
          extraParams,
        } as any);
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新路由表失败', error: error.message });
      }
    },
  );
  router.delete(
    '/:id/resources/route-tables/:routeTableId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, routeTableId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteRouteTable',
          extraParams: { RouteTableId: routeTableId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除路由表失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/route-tables/:routeTableId/associate',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, routeTableId } = req.params;
        const { subnetIds } = (req.body || {}) as { subnetIds?: string[] };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const ids: string[] = Array.isArray(subnetIds) ? subnetIds : [];
        if (!ids.length) return res.status(400).json({ message: '缺少必要参数：subnetIds' });
        const results: any[] = [];
        for (const vswId of ids) {
          const r = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'AssociateRouteTable',
            extraParams: { RouteTableId: routeTableId, VSwitchId: vswId },
          } as any);
          results.push(r);
        }
        res.json({ message: '挂载成功', data: results });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '挂载子网失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/route-tables/:routeTableId/disassociate',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, routeTableId } = req.params;
        const { subnetIds } = (req.body || {}) as { subnetIds?: string[] };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const ids: string[] = Array.isArray(subnetIds) ? subnetIds : [];
        if (!ids.length) return res.status(400).json({ message: '缺少必要参数：subnetIds' });
        const results: any[] = [];
        for (const vswId of ids) {
          const r = await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'UnassociateRouteTable',
            extraParams: { RouteTableId: routeTableId, VSwitchId: vswId },
          } as any);
          results.push(r);
        }
        res.json({ message: '卸载成功', data: results });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '卸载子网失败', error: error.message });
      }
    },
  );
  router.post(
    '/:id/resources/route-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { routeTableId, route } = (req.body || {}) as {
          routeTableId?: string;
          route?: { type: string; destination: string; nexthop: string; description?: string };
        };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!routeTableId || !route?.destination || route?.nexthop === undefined)
          return res
            .status(400)
            .json({ message: '缺少必要参数：routeTableId 或 route.destination 或 route.nexthop' });
        const nhType = (() => {
          const t = String(route?.type || '').toLowerCase();
          if (t === 'ecs') return 'Instance';
          if (t === 'eni') return 'NetworkInterface';
          if (t === 'nat') return 'NatGateway';
          if (t === 'vip') return 'HaVip';
          if (t === 'pcn') return 'RouterInterface';
          if (t === 'vpn') return 'VpnGateway';
          if (t === 'ipv6') return 'Ipv6Gateway';
          return 'Instance';
        })();
        const extraParams: Record<string, any> = {
          RouteTableId: routeTableId,
          DestinationCidrBlock: route.destination,
          NextHopType: nhType,
          NextHopId: route.nexthop,
        };
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateRouteEntry',
          extraParams,
        } as any);
        res.json({ message: '新增成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '新增路由条目失败', error: error.message });
      }
    },
  );
  router.patch(
    '/:id/resources/route-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { routeTableId, oldRoute, newRoute, route } = (req.body || {}) as {
          routeTableId?: string;
          oldRoute?: { destination: string; nexthop: string };
          newRoute?: { type: string; destination: string; nexthop: string; description?: string };
          route?: { type: string; destination: string; nexthop: string; description?: string };
        };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const target = newRoute || route;
        if (!routeTableId || !target?.destination || target?.nexthop === undefined)
          return res
            .status(400)
            .json({ message: '缺少必要参数：routeTableId 或 route.destination 或 route.nexthop' });
        const prev = oldRoute;
        if (prev?.destination && prev?.nexthop) {
          const nhTypePrev = (() => {
            const nhId = String(prev?.nexthop || '').trim();
            if (/^eni-/.test(nhId)) return 'NetworkInterface';
            if (/^ngw-/.test(nhId)) return 'NatGateway';
            if (/^havip-/.test(nhId)) return 'HaVip';
            if (/^ri-/.test(nhId)) return 'RouterInterface';
            return 'Instance';
          })();
          await callAliyunVpc({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DeleteRouteEntry',
            extraParams: {
              RouteTableId: routeTableId,
              DestinationCidrBlock: prev.destination,
              NextHopId: prev.nexthop,
              NextHopType: nhTypePrev,
            },
          } as any);
        }
        const nhType = (() => {
          const t = String(target?.type || '').toLowerCase();
          if (t === 'ecs') return 'Instance';
          if (t === 'eni') return 'NetworkInterface';
          if (t === 'nat') return 'NatGateway';
          if (t === 'vip') return 'HaVip';
          if (t === 'pcn') return 'RouterInterface';
          return 'Instance';
        })();
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateRouteEntry',
          extraParams: {
            RouteTableId: routeTableId,
            DestinationCidrBlock: target.destination,
            NextHopType: nhType,
            NextHopId: target.nexthop,
          },
        } as any);
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新路由条目失败', error: error.message });
      }
    },
  );
  router.delete(
    '/:id/resources/route-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { routeTableId, route } = (req.body || {}) as {
          routeTableId?: string;
          route?: { destination: string; nexthop: string };
        };
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!routeTableId || !route?.destination)
          return res
            .status(400)
            .json({ message: '缺少必要参数：routeTableId 或 route.destination' });
        const nhId = String(route?.nexthop || '').trim();
        const nhType = (() => {
          if (/^eni-/.test(nhId)) return 'NetworkInterface';
          if (/^ngw-/.test(nhId)) return 'NatGateway';
          if (/^havip-/.test(nhId)) return 'HaVip';
          if (/^ri-/.test(nhId)) return 'RouterInterface';
          if (/^vpn-/.test(nhId)) return 'VpnGateway';
          if (/^ipv6gw-/.test(nhId)) return 'Ipv6Gateway';
          return 'Instance';
        })();
        const result = await callAliyunVpc({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteRouteEntry',
          extraParams: {
            RouteTableId: routeTableId,
            DestinationCidrBlock: route.destination,
            NextHopId: nhId,
            NextHopType: nhType,
          },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除路由条目失败', error: error.message });
      }
    },
  );

  // ===== RDS 云数据库 =====
  router.get(
    '/:id/resources/rds',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeDBInstances',
          extraParams: { PageSize: 100, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询云数据库失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/rds/:dbInstanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeDBInstanceAttribute',
          extraParams: { DBInstanceId: dbInstanceId },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询数据库详情失败', error: error.message });
      }
    },
  );

  // 创建 RDS 实例 CreateDBInstance
  router.post(
    '/:id/resources/rds',
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
        if (!b.engine || !b.engineVersion || !b.dbInstanceClass || !b.dbInstanceStorage)
          return res.status(400).json({ message: '缺少必要参数：engine / engineVersion / dbInstanceClass / dbInstanceStorage' });
        const extraParams: Record<string, any> = {
          Engine: b.engine,
          EngineVersion: b.engineVersion,
          DBInstanceClass: b.dbInstanceClass,
          DBInstanceStorage: Number(b.dbInstanceStorage),
          PayType: b.payType || 'Postpaid',
          DBInstanceNetType: b.dbInstanceNetType || 'Intranet',
          SecurityIPList: b.securityIPList || '127.0.0.1',
        };
        if (b.dbInstanceDescription) extraParams.DBInstanceDescription = b.dbInstanceDescription;
        if (b.vpcId) extraParams.VPCId = b.vpcId;
        if (b.vSwitchId) extraParams.VSwitchId = b.vSwitchId;
        if (b.zoneId) extraParams.ZoneId = b.zoneId;
        if (b.instanceNetwork) extraParams.InstanceNetworkType = b.instanceNetwork;
        const result = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateDBInstance',
          extraParams,
        } as any);
        res.json({ message: '创建数据库指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建云数据库失败', error: error.message });
      }
    },
  );

  // 删除 RDS 实例 DeleteDBInstance
  router.delete(
    '/:id/resources/rds/:dbInstanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!dbInstanceId) return res.status(400).json({ message: '缺少 DBInstanceId' });
        const result = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteDBInstance',
          extraParams: { DBInstanceId: dbInstanceId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除云数据库失败', error: error.message });
      }
    },
  );

  // 重启 RDS 实例 RestartDBInstance
  router.post(
    '/:id/resources/rds/:dbInstanceId/restart',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'RestartDBInstance',
          extraParams: { DBInstanceId: dbInstanceId },
        } as any);
        res.json({ message: '重启指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '重启数据库失败', error: error.message });
      }
    },
  );

  // ===== 池级监控告警（CMS）=====
  // 告警历史 DescribeAlertLogList
  router.get(
    '/:id/resources/monitor/alarm-logs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const end = Date.now();
        const start = end - 7 * 24 * 60 * 60 * 1000;
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeAlertLogList',
          version: '2019-01-01',
          extraParams: { StartTime: start, EndTime: end, PageSize: 50, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询告警历史失败', error: error.message });
      }
    },
  );

  // 告警规则 DescribeMetricRuleList
  router.get(
    '/:id/resources/monitor/alarm-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeMetricRuleList',
          version: '2019-01-01',
          extraParams: { PageSize: 50, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询告警规则失败', error: error.message });
      }
    },
  );

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
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeSnapshots',
          extraParams: { PageNumber: 1, PageSize: 50 },
        } as any);
        res.json({ message: '查询成功', data });
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
        const extraParams: Record<string, any> = {
          PageSize: Number(pageSize) || 100,
          PageNumber: 1,
          Status: 'Available',
        };
        if (owner) extraParams.ImageOwnerAlias = owner;
        if (osType) extraParams.OSType = osType;
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeImages',
          extraParams,
        } as any);
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

  // 实例规格列表 DescribeInstanceTypes
  router.get(
    '/:id/resources/instance-types',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeInstanceTypes',
          extraParams: {},
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询实例规格失败', error: error.message });
      }
    },
  );

  // 可用区列表 DescribeZones
  router.get(
    '/:id/resources/zones',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeZones',
          extraParams: { AcceptLanguage: 'zh-CN' },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询可用区失败', error: error.message });
      }
    },
  );

  // SSH 密钥对列表 DescribeKeyPairs
  router.get(
    '/:id/resources/key-pairs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeKeyPairs',
          extraParams: { PageSize: 50, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询密钥对失败', error: error.message });
      }
    },
  );

  // 创建密钥对 CreateKeyPair（返回私钥，仅此一次）
  router.post(
    '/:id/resources/key-pairs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { keyPairName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!keyPairName) return res.status(400).json({ message: '缺少密钥对名称 keyPairName' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateKeyPair',
          extraParams: { KeyPairName: keyPairName },
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建密钥对失败', error: error.message });
      }
    },
  );

  // 导入密钥对 ImportKeyPair
  router.post(
    '/:id/resources/key-pairs/import',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { keyPairName, publicKeyBody } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!keyPairName || !publicKeyBody)
          return res.status(400).json({ message: '缺少 keyPairName 或 publicKeyBody' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ImportKeyPair',
          extraParams: { KeyPairName: keyPairName, PublicKeyBody: publicKeyBody },
        } as any);
        res.json({ message: '导入成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '导入密钥对失败', error: error.message });
      }
    },
  );

  // 删除密钥对 DeleteKeyPairs
  router.delete(
    '/:id/resources/key-pairs/:keyPairName',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, keyPairName } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!keyPairName) return res.status(400).json({ message: '缺少密钥对名称' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteKeyPairs',
          extraParams: { KeyPairNames: JSON.stringify([keyPairName]) },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除密钥对失败', error: error.message });
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
          return res.status(400).json({ message: '缺少必要参数：imageId / instanceType / securityGroupId / vSwitchId' });
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
        if (b.internetMaxBandwidthOut != null) extraParams.InternetMaxBandwidthOut = Number(b.internetMaxBandwidthOut);
        if (b.internetChargeType) extraParams.InternetChargeType = b.internetChargeType;
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
