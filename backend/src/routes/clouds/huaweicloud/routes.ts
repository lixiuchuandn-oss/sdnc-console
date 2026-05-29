import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import {
  huaweiListVpcs,
  huaweiShowVpc,
  huaweiCreateVpc,
  huaweiUpdateVpc,
  huaweiDeleteVpc,
  huaweiListServers,
  huaweiListSubnets,
  huaweiListRouteTables,
  huaweiListSnapshots,
  huaweiGetServerRemoteConsoleUrl,
  huaweiCreateRouteTable,
  huaweiUpdateRouteTable,
  huaweiAssociateRouteTable,
  huaweiDisassociateRouteTable,
  huaweiDeleteRouteTable,
  huaweiShowRouteTable,
  huaweiCreateSubnet,
  huaweiUpdateSubnet,
  huaweiDeleteSubnet,
  huaweiListSecurityGroups,
  huaweiShowSecurityGroup,
  huaweiListPublicips,
  huaweiListVolumes,
  huaweiListLoadBalancers,
  huaweiListNatGateways,
  huaweiCreateSecurityGroupRule,
  huaweiDeleteSecurityGroupRule,
  huaweiCreateSecurityGroup,
  huaweiDeleteSecurityGroup,
  huaweiListPorts,
  huaweiShowPort,
  huaweiUpdatePort,
  huaweiUpdateFloatingip,
  huaweiBatchQueryCesMetricData,
  huaweiQueryCesMetricDataSingle,
  huaweiListCesMetrics,
  huaweiListCtsTraces,
  huaweiStartServer,
  huaweiStopServer,
  huaweiRebootServer,
  huaweiListFlavors,
  huaweiListAvailabilityZones,
  huaweiListKeypairs,
  huaweiCreateKeypair,
  huaweiDeleteKeypair,
  huaweiListImages,
  huaweiCreateServers,
  huaweiDeleteServers,
  huaweiCreateVolume,
  huaweiDeleteVolume,
  huaweiResizeVolume,
  huaweiAttachVolume,
  huaweiDetachVolume,
  huaweiCreateSnapshot,
  huaweiDeleteSnapshot,
  huaweiCreatePublicip,
  huaweiDeletePublicip,
  huaweiListSnatRules,
  huaweiCreateSnatRule,
  huaweiDeleteSnatRule,
  huaweiListDnatRules,
  huaweiCreateDnatRule,
  huaweiDeleteDnatRule,
  huaweiListDbInstances,
  huaweiListDatastores,
  huaweiListRdsFlavors,
  huaweiCreateDbInstance,
  huaweiDeleteDbInstance,
  huaweiRestartDbInstance,
} from '../../../services/clouds/huaweicloud/client';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

const isHuawei = (cloud: any) => {
  const p = String(cloud?.config?.provider || '').toLowerCase();
  return p.includes('huawei');
};

const __cesRate = new Map<string, { count: number; start: number }>();
function __allowCes(id: string): boolean {
  const now = Date.now();
  const v = __cesRate.get(id) || { count: 0, start: now };
  if (now - v.start >= 60000) {
    v.count = 0;
    v.start = now;
  }
  v.count += 1;
  __cesRate.set(id, v);
  return v.count <= 240;
}

export const registerHuaweiRoutes = (router: Router, checkAdminPermission: any) => {
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListServers({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
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
            const data: any = await huaweiListServers({
              ak: cloud.accessKey!,
              sk: cloud.secretKey!,
              region: String(cloud.region || ''),
              projectId,
            });
            const items: any[] = Array.isArray(data?.servers)
              ? data.servers
              : Array.isArray(data?.data?.servers)
                ? data.data.servers
                : Array.isArray(data)
                  ? data
                  : [];
            const cur = new Map<string, any>();
            for (const r of items) {
              const iid = String(r?.id || r?.InstanceId || '');
              if (!iid) continue;
              cur.set(iid, r);
              const prevItem = prev.get(iid);
              const prevStatus = String(prevItem?.status || prevItem?.Status || '');
              const curStatus = String(r?.status || r?.Status || '');
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
    '/:id/resources/ecs/:instanceId/metrics',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListServers({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        const servers: any[] = (data as any)?.servers || (data as any)?.data?.servers || [];
        const srv = servers.find(
          (s: any) => String(s?.id || s?.InstanceId || '') === String(instanceId || ''),
        );
        if (!srv) return res.status(404).json({ message: '实例不存在' });
        const metrics = {
          power_state: srv?.['OS-EXT-STS:power_state'],
          vm_state: srv?.['OS-EXT-STS:vm_state'],
          host_status: srv?.host_status,
          launched_at: srv?.['OS-SRV-USG:launched_at'],
          terminated_at: srv?.['OS-SRV-USG:terminated_at'],
          progress: srv?.progress,
          status: srv?.status,
          availability_zone: srv?.['OS-EXT-AZ:availability_zone'] || srv?.availability_zone,
        };
        res.json({ message: '查询成功', data: metrics });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询实例监控失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/ecs/:instanceId/ces-available-metrics',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        if (!__allowCes(id))
          return res
            .status(429)
            .json({ message: '华为云CES调用过于频繁，请稍后再试', retryAfter: 30 });
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const [sysRes, agtRes] = await Promise.all([
          huaweiListCesMetrics(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            { namespace: 'SYS.ECS', instance_id: String(instanceId), limit: 200, order: 'desc' },
          ),
          huaweiListCesMetrics(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            { namespace: 'AGT.ECS', instance_id: String(instanceId), limit: 200, order: 'desc' },
          ),
        ]);
        const toNames = (r: any): string[] => {
          const arr: any[] = r?.metrics || r?.data?.metrics || [];
          const names = arr
            .map((m: any) => m?.metric_name || m?.metric?.metricName)
            .filter((x: any) => !!x);
          return Array.isArray(names) ? names.map(String) : [];
        };
        const set = new Set<string>();
        for (const n of toNames(sysRes)) set.add(n);
        for (const n of toNames(agtRes)) set.add(n);
        res.json({ message: '查询成功', data: { metrics: Array.from(set) } });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询可用CES指标失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/ces-metrics',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        if (!__allowCes(id))
          return res
            .status(429)
            .json({ message: '华为云CES调用过于频繁，请稍后再试', retryAfter: 30 });
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const nowMs = Date.now();
        const from = Number(req.body?.from ?? nowMs - 60 * 60 * 1000);
        const to = Number(req.body?.to ?? nowMs);
        const period = Number(req.body?.period ?? 300);
        const filter = String(req.body?.filter ?? 'average');
        const metricsReq = (
          Array.isArray(req.body?.metrics) && req.body.metrics.length
            ? req.body.metrics
            : [
                {
                  namespace: 'SYS.ECS',
                  metric_name: 'cpu_util',
                  dimensions: [{ name: 'instance_id', value: String(instanceId) }],
                },
              ]
        ) as Array<{
          namespace: string;
          metric_name: string;
          dimensions: Array<{ name: string; value: string }>;
        }>;
        const useSingle = !!req.body?.useSingle;
        let data: any = null;
        if (useSingle) {
          data = await huaweiQueryCesMetricDataSingle(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            {
              namespace: metricsReq[0].namespace,
              metric_name: metricsReq[0].metric_name,
              instance_id: String(instanceId),
              period,
              filter,
              from,
              to,
            },
          );
        } else {
          try {
            data = await huaweiBatchQueryCesMetricData(
              { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
              { metrics: metricsReq, period, filter, from, to },
            );
          } catch (e: any) {
            const msg = String(e?.message || '');
            const code = e?.code ?? e?.status;
            const needFallback =
              /ces\.0014|period/i.test(msg) ||
              code === 400 ||
              /status code 400|bad request/i.test(msg);
            if (!needFallback) throw e;
            const results: any[] = [];
            const periodSingle = period === 1 ? 60 : period;
            for (const m of metricsReq) {
              try {
                const r = await huaweiQueryCesMetricDataSingle(
                  { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
                  {
                    namespace: m.namespace,
                    metric_name: m.metric_name,
                    instance_id: String(instanceId),
                    period: periodSingle,
                    filter,
                    from,
                    to,
                  },
                );
                results.push(r);
              } catch {}
            }
            data = { metrics: results };
          }
        }
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询CES监控失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/ces-metrics-single',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        if (!__allowCes(id))
          return res
            .status(429)
            .json({ message: '华为云CES调用过于频繁，请稍后再试', retryAfter: 30 });
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const nowMs = Date.now();
        const from = Number(req.body?.from ?? nowMs - 60 * 60 * 1000);
        const to = Number(req.body?.to ?? nowMs);
        const period = Number(req.body?.period ?? 300);
        const filter = String(req.body?.filter ?? 'average');
        const data = await huaweiQueryCesMetricDataSingle(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          {
            namespace: 'SYS.ECS',
            metric_name: 'cpu_util',
            instance_id: String(instanceId),
            period,
            filter,
            from,
            to,
          },
        );
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询CES监控失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/ecs/:instanceId/audit-logs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListServers({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        const servers: any[] = (data as any)?.servers || (data as any)?.data?.servers || [];
        const srv = servers.find(
          (s: any) => String(s?.id || s?.InstanceId || '') === String(instanceId || ''),
        );
        if (!srv) return res.status(404).json({ message: '实例不存在' });
        const audit = {
          tenant_id: srv?.tenant_id,
          user_id: srv?.user_id,
          launched_at: srv?.['OS-SRV-USG:launched_at'],
          terminated_at: srv?.['OS-SRV-USG:terminated_at'],
          host: srv?.['OS-EXT-SRV-ATTR:host'],
          instance_name: srv?.['OS-EXT-SRV-ATTR:instance_name'],
          hypervisor_hostname: srv?.['OS-EXT-SRV-ATTR:hypervisor_hostname'],
        };
        res.json({ message: '查询成功', data: audit });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询实例审计日志失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/ecs/:instanceId/audit-traces',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const now = Date.now();
        const q = req.query || {};
        const end = q.end != null ? Number(q.end) : now;
        const start = q.start != null ? Number(q.start) : end - 24 * 60 * 60 * 1000;
        const limit = q.limit != null ? Number(q.limit) : 200;
        const trace_name = q.trace_name != null ? String(q.trace_name) : undefined;
        const traces = await huaweiListCtsTraces(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          {
            resource_id: String(instanceId),
            service_type: 'ECS',
            limit,
            order: 'desc',
            start_time: start,
            end_time: end,
            trace_name,
          },
        );
        const list: any[] = traces?.traces || traces?.data?.traces || traces?.trace_list || [];
        res.json({ message: '查询成功', data: { traces: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询审计日志失败', error: error.message });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const url = await huaweiGetServerRemoteConsoleUrl(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          instanceId,
        );
        res.json({ message: '查询成功', data: { VncUrl: url } });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询VNC地址失败', error: error.message });
      }
    },
  );

  // ECS 规格列表 ListFlavors
  router.get(
    '/:id/resources/flavors',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { availabilityZone } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListFlavors({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, availabilityZone);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询规格失败', error: error.message });
      }
    },
  );

  // 可用区列表 ListAvailabilityZones
  router.get(
    '/:id/resources/availability-zones',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListAvailabilityZones({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询可用区失败', error: error.message });
      }
    },
  );

  // 镜像列表 IMS（imagetype: gold/private/shared/market）
  router.get(
    '/:id/resources/images',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { imagetype, osType } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListImages({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, { imagetype, osType });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询镜像失败', error: error.message });
      }
    },
  );

  // 密钥对列表 ListKeypairs
  router.get(
    '/:id/resources/key-pairs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListKeypairs({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询密钥对失败', error: error.message });
      }
    },
  );

  // 创建密钥对 CreateKeypair
  router.post(
    '/:id/resources/key-pairs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { name, publicKey } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!name) return res.status(400).json({ message: '缺少密钥对名称 name' });
        const data = await huaweiCreateKeypair({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, name, publicKey);
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建密钥对失败', error: error.message });
      }
    },
  );

  // 删除密钥对 DeleteKeypair
  router.delete(
    '/:id/resources/key-pairs/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiDeleteKeypair({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, name);
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除密钥对失败', error: error.message });
      }
    },
  );

  // 创建实例 CreateServers
  router.post(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const b = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!b.imageRef || !b.flavorRef || !b.vpcid || !b.subnetId)
          return res.status(400).json({ message: '缺少必要参数：imageRef / flavorRef / vpcid / subnetId' });
        const server: any = {
          name: b.name || `ecs-${Date.now()}`,
          imageRef: b.imageRef,
          flavorRef: b.flavorRef,
          vpcid: b.vpcid,
          nics: [{ subnet_id: b.subnetId }],
          root_volume: { volumetype: b.rootVolumeType || 'SAS', size: Number(b.rootVolumeSize || 40) },
          count: Number(b.count || 1),
        };
        if (b.availabilityZone) server.availability_zone = b.availabilityZone;
        if (b.keyName) server.key_name = b.keyName;
        if (b.adminPass) server.adminPass = b.adminPass;
        if (Array.isArray(b.securityGroupIds) && b.securityGroupIds.length) server.security_groups = b.securityGroupIds.map((sid: string) => ({ id: sid }));
        if (Array.isArray(b.dataVolumes) && b.dataVolumes.length) server.data_volumes = b.dataVolumes.map((d: any) => ({ volumetype: d.volumetype || 'SAS', size: Number(d.size || 10) }));
        const data = await huaweiCreateServers({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, server);
        res.json({ message: '创建实例指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建实例失败', error: error.message });
      }
    },
  );

  // 删除实例 DeleteServers
  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { deleteVolume } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiDeleteServers({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, [instanceId], !!deleteVolume);
        res.json({ message: '删除指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除实例失败', error: error.message });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const result = await huaweiStartServer(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          instanceId,
        );
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const result = await huaweiStopServer(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          instanceId,
          !!force,
        );
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const result = await huaweiRebootServer(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          instanceId,
          !!force,
        );
        res.json({ message: '重启指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '重启实例失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListVpcs({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询VPC失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/vpcs/:vpcId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, vpcId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!vpcId) return res.status(400).json({ message: '缺少 vpcId 参数' });
        const data = await huaweiShowVpc(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          vpcId,
        );
        res.json({ message: '查询成功', data });
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
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const src = (req.body && (req.body.vpc || req.body)) || {};
        const name: string | undefined = src?.name || src?.VpcName;
        const description: string | undefined = src?.description || src?.Description;
        const cidr: string | undefined = src?.cidr || src?.CidrBlock;
        const enterprise_project_id: string | undefined = src?.enterprise_project_id;
        const tags: string[] | undefined = Array.isArray(src?.tags) ? src?.tags : undefined;
        const block_service_endpoint_states: string | undefined =
          src?.block_service_endpoint_states;
        const enable_network_address_usage_metrics: boolean | undefined =
          src?.enable_network_address_usage_metrics;
        if (!cidr) return res.status(400).json({ message: '缺少必填参数：cidr' });
        const data = await huaweiCreateVpc(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          {
            cidr,
            name,
            description,
            enterprise_project_id,
            tags,
            block_service_endpoint_states,
            enable_network_address_usage_metrics,
          },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建VPC失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/vpcs/:vpcId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, vpcId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!vpcId) return res.status(400).json({ message: '缺少 vpcId 参数' });
        const src = (req.body && (req.body.vpc || req.body)) || {};
        const name: string | undefined = src?.name || src?.VpcName;
        const description: string | undefined = src?.description || src?.Description;
        const cidr: string | undefined = src?.cidr || src?.CidrBlock;
        const enterprise_project_id: string | undefined = src?.enterprise_project_id;
        const tags: string[] | undefined = Array.isArray(src?.tags) ? src?.tags : undefined;
        const block_service_endpoint_states: string | undefined =
          src?.block_service_endpoint_states;
        const enable_network_address_usage_metrics: boolean | undefined =
          src?.enable_network_address_usage_metrics;
        if (
          name === undefined &&
          description === undefined &&
          cidr === undefined &&
          enterprise_project_id === undefined &&
          block_service_endpoint_states === undefined &&
          enable_network_address_usage_metrics === undefined &&
          (!tags || !tags.length)
        ) {
          return res.status(400).json({ message: '至少提供一个可修改字段' });
        }
        const data = await huaweiUpdateVpc(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          vpcId,
          {
            name,
            description,
            cidr,
            enterprise_project_id,
            tags,
            block_service_endpoint_states,
            enable_network_address_usage_metrics,
          },
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新VPC失败', error: error.message });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!vpcId) return res.status(400).json({ message: '缺少 vpcId 参数' });
        const data = await huaweiDeleteVpc(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          vpcId,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除VPC失败', error: error.message });
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
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListRouteTables({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        const capabilities = { isHarvester: false, supportsDisk: false };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询路由表失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/route-tables',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const { vpcId, name, description, routes } = req.body || {};
        if (!vpcId) return res.status(400).json({ message: '缺少 vpcId 参数' });
        const data = await huaweiCreateRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          { vpcId, name, description, routes },
        );
        res.json({ message: '创建成功', data });
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
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const { name, description, routes } = req.body || {};
        const data = await huaweiUpdateRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
          { name, description, routes },
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新路由表失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/route-tables/:routeTableId/associate',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, routeTableId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const { subnetIds } = req.body || {};
        const arr: string[] = Array.isArray(subnetIds) ? subnetIds : [];
        if (!arr.length) return res.status(400).json({ message: '缺少 subnetIds 参数' });
        const data = await huaweiAssociateRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
          arr,
        );
        res.json({ message: '挂载成功', data });
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
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const { subnetIds } = req.body || {};
        const arr: string[] = Array.isArray(subnetIds) ? subnetIds : [];
        if (!arr.length) return res.status(400).json({ message: '缺少 subnetIds 参数' });
        const data = await huaweiDisassociateRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
          arr,
        );
        res.json({ message: '解绑成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '解绑子网失败', error: error.message });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiDeleteRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除路由表失败', error: error.message });
      }
    },
  );

  // Route Entries
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const current: any = await huaweiShowRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
        );
        const d = current && (current as any).data ? (current as any).data : current;
        const direct: any[] =
          d?.routetable?.routes ||
          d?.route_table?.routes ||
          d?.routeTable?.routes ||
          d?.routes ||
          [];
        const list: any[] = Array.isArray(direct)
          ? direct
          : (function () {
              const seen = new Set<any>();
              const stack: any[] = [d];
              while (stack.length) {
                const o = stack.pop();
                if (!o || typeof o !== 'object' || seen.has(o)) continue;
                seen.add(o);
                for (const k of Object.keys(o)) {
                  const v: any = (o as any)[k];
                  if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
                    const f = v[0];
                    if ('destination' in f || 'nexthop' in f || 'type' in f) return v;
                  }
                  if (v && typeof v === 'object') stack.push(v);
                }
              }
              return [] as any[];
            })();
        res.json({ message: '查询成功', data: Array.isArray(list) ? list : [] });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询路由条目失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/route-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { routeTableId, route } = req.body || {};
        if (!routeTableId || !route)
          return res.status(400).json({ message: '缺少 routeTableId 或 route 参数' });
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const t = String(route?.type || '').toLowerCase();
        const dst = String(route?.destination || '').trim();
        const nh = String(route?.nexthop || '').trim();
        const typeOk = ['ecs', 'eni', 'vip', 'nat', 'pcn'].includes(t);
        const cidrOk =
          dst === '0.0.0.0/0' ||
          /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\/(3[0-2]|[12]?\d)$/.test(
            dst,
          );
        if (!typeOk)
          return res
            .status(400)
            .json({ message: '路由类型不支持', error: `不支持的 type: ${route?.type}` });
        if (!cidrOk)
          return res.status(400).json({ message: '目的网段不合法', error: `非法CIDR: ${dst}` });
        if (!nh) return res.status(400).json({ message: '缺少下一跳', error: 'nexthop 不能为空' });
        const current: any = await huaweiShowRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
        );
        const existed: any[] = current?.routetable?.routes || current?.route_table?.routes || [];
        const locals: string[] = existed
          .filter((r) => String(r?.type || '').toLowerCase() === 'local')
          .map((r) => String(r?.destination || ''))
          .filter(Boolean);
        const overlapsLocal = locals.some((l) => {
          const [lip, lmask] = String(l).split('/');
          const [dip, dmask] = String(dst).split('/');
          const toNum = (ip: string) =>
            ip.split('.').reduce((acc, n) => (acc << 8) + (parseInt(n) || 0), 0);
          const ln = toNum(lip || '0.0.0.0');
          const dn = toNum(dip || '0.0.0.0');
          const m = 32 - (parseInt(lmask || '0') || 0);
          const mask = m >= 32 ? 0 : (~0 << m) >>> 0;
          return (ln & mask) === (dn & mask);
        });
        if (overlapsLocal)
          return res
            .status(400)
            .json({ message: '目的网段与Local冲突', error: `不能与系统Local路由重叠：${dst}` });
        const dup = existed.find(
          (r) => String(r?.destination || '') === dst && String(r?.nexthop || '') === nh,
        );
        if (dup)
          return res
            .status(400)
            .json({ message: '路由已存在', error: `重复的目的网段 ${dst} 与下一跳 ${nh}` });
        try {
          const clean = {
            type: t,
            destination: dst,
            nexthop: nh,
            description: String(route?.description || '').trim(),
          } as any;
          const data = await huaweiUpdateRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
            { add: [clean] },
          );
          res.json({ message: '新增成功', data });
        } catch (err: any) {
          const after: any = await huaweiShowRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
          );
          const routes: any[] = after?.routetable?.routes || after?.route_table?.routes || [];
          const existsNow = routes.some(
            (r) => String(r?.destination || '') === dst && String(r?.nexthop || '') === nh,
          );
          if (existsNow) return res.json({ message: '新增成功', data: { confirm: true } });
          const status = err?.response?.status ?? err?.status ?? 500;
          const data = err?.response?.data ?? err?.data;
          const code = err?.code ?? err?.errorCode;
          const detail =
            (data && (typeof data === 'string' ? data : JSON.stringify(data))) ||
            err?.errorMsg ||
            err?.message ||
            String(code || '');
          return res
            .status(typeof status === 'number' ? status : 500)
            .json({ message: '新增路由条目失败', error: detail || '未知错误', code });
        }
      } catch (error: any) {
        const status = error?.response?.status ?? error?.status ?? 500;
        const data = error?.response?.data ?? error?.data;
        const code = error?.code ?? error?.errorCode;
        const detail =
          (data && (typeof data === 'string' ? data : JSON.stringify(data))) ||
          error?.errorMsg ||
          error?.message ||
          String(code || '');
        res
          .status(typeof status === 'number' ? status : 500)
          .json({ message: '新增路由条目失败', error: detail || '未知错误', code });
      }
    },
  );

  router.patch(
    '/:id/resources/route-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { routeTableId, oldRoute, newRoute, route } = req.body || {};
        if (!routeTableId) return res.status(400).json({ message: '缺少 routeTableId 参数' });
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (route) {
          const t = String(route?.type || '').toLowerCase();
          const dst = String(route?.destination || '').trim();
          const nh = String(route?.nexthop || '').trim();
          const desc = route?.description != null ? String(route?.description).trim() : undefined;
          const reqDst = dst;
          const parseCidr = (cidr: string) => {
            const [ip, maskStr] = String(cidr).split('/');
            const mask = parseInt(maskStr || '0');
            const toNum = (s: string) =>
              s.split('.').reduce((a, n) => (a << 8) + (parseInt(n) || 0), 0) >>> 0;
            return { net: toNum(ip || '0.0.0.0'), mask };
          };
          const samePrefix = (
            a: { net: number; mask: number },
            b: { net: number; mask: number },
          ) => {
            const m = 32 - Math.min(a.mask, b.mask);
            const prefMask = m >= 32 ? 0 : (~0 << m) >>> 0;
            return (a.net & prefMask) === (b.net & prefMask);
          };
          const current: any = await huaweiShowRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
          );
          const existRoutes: any[] =
            current?.routetable?.routes || current?.route_table?.routes || [];
          const reqC = parseCidr(reqDst);
          let target = existRoutes.find((r: any) => String(r?.destination || '') === reqDst);
          if (!target) {
            const candidates = existRoutes.filter(
              (r: any) => r && r.destination && String(r.type || '').toLowerCase() !== 'local',
            );
            const matched = candidates.find((r: any) => {
              const rc = parseCidr(String(r.destination));
              return samePrefix(reqC, rc);
            });
            if (matched) target = matched;
          }
          if (!target)
            return res
              .status(404)
              .json({
                message: '未找到需要更新的路由',
                error: `destination=${route?.destination}`,
              });
          const clean = { type: t, destination: dst, nexthop: nh, description: desc } as any;
          try {
            let data: any;
            if (String(target.destination).trim() === dst) {
              data = await huaweiUpdateRouteTable(
                { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
                routeTableId,
                { mod: [clean] },
              );
            } else {
              data = await huaweiUpdateRouteTable(
                { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
                routeTableId,
                { del: [target], add: [clean] },
              );
            }
            const after: any = await huaweiShowRouteTable(
              { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
              routeTableId,
            );
            const routes: any[] = after?.routetable?.routes || after?.route_table?.routes || [];
            const ok = routes.some(
              (r) => String(r?.destination || '') === dst && String(r?.nexthop || '') === nh,
            );
            if (!ok)
              return res.status(500).json({ message: '更新路由条目失败', error: '云端未生效' });
            return res.json({ message: '更新成功', data });
          } catch (err: any) {
            const status = err?.response?.status ?? err?.status ?? 500;
            const data = err?.response?.data ?? err?.data;
            const code = err?.code ?? err?.errorCode;
            const detail =
              (data && (typeof data === 'string' ? data : JSON.stringify(data))) ||
              err?.errorMsg ||
              err?.message ||
              String(code || '');
            return res
              .status(typeof status === 'number' ? status : 500)
              .json({ message: '更新路由条目失败', error: detail || '未知错误', code });
          }
        }
        if (!oldRoute || !newRoute)
          return res.status(400).json({ message: '缺少 oldRoute/newRoute 参数' });
        const current: any = await huaweiShowRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
        );
        const existRoutes: any[] =
          current?.routetable?.routes || current?.route_table?.routes || [];
        const match = (r: any) =>
          String(r?.destination || '') === String(oldRoute?.destination || '') &&
          String(r?.nexthop || '') === String(oldRoute?.nexthop || '');
        const oldFull = existRoutes.find(match);
        if (!oldFull)
          return res
            .status(404)
            .json({
              message: '未找到需要更新的旧路由',
              error: `destination=${oldRoute?.destination}, nexthop=${oldRoute?.nexthop}`,
            });
        const tNew = String((newRoute as any)?.type || '').toLowerCase();
        const dstNew = String((newRoute as any)?.destination || '').trim();
        const nhNew = String((newRoute as any)?.nexthop || '').trim();
        const descNew =
          (newRoute as any)?.description != null
            ? String((newRoute as any)?.description).trim()
            : undefined;
        let data: any;
        if (dstNew === String(oldRoute?.destination || '').trim()) {
          const modClean = {
            type: tNew || String(oldFull?.type || '').toLowerCase(),
            destination: dstNew,
            nexthop: nhNew,
            description: descNew,
          } as any;
          data = await huaweiUpdateRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
            { mod: [modClean] },
          );
        } else {
          const addClean = {
            type: tNew || String(oldFull?.type || '').toLowerCase(),
            destination: dstNew,
            nexthop: nhNew,
            description: descNew,
          } as any;
          data = await huaweiUpdateRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
            { del: [oldFull], add: [addClean] },
          );
        }
        try {
          const after: any = await huaweiShowRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
          );
          const routes: any[] = after?.routetable?.routes || after?.route_table?.routes || [];
          const ok =
            dstNew === String(oldRoute?.destination || '').trim()
              ? routes.some(
                  (r) =>
                    String(r?.destination || '') === dstNew && String(r?.nexthop || '') === nhNew,
                )
              : routes.some(
                  (r) =>
                    String(r?.destination || '') === dstNew && String(r?.nexthop || '') === nhNew,
                ) &&
                !routes.some(
                  (r) =>
                    String(r?.destination || '') === String(oldRoute?.destination || '') &&
                    String(r?.nexthop || '') === String(oldRoute?.nexthop || ''),
                );
          if (!ok)
            return res.status(500).json({ message: '更新路由条目失败', error: '云端未生效' });
          res.json({ message: '更新成功', data });
        } catch (e: any) {
          res.json({ message: '更新成功', data });
        }
      } catch (error: any) {
        const status = error?.response?.status ?? error?.status ?? 500;
        const data = error?.response?.data ?? error?.data;
        const code = error?.code ?? error?.errorCode;
        const detail =
          (data && (typeof data === 'string' ? data : JSON.stringify(data))) ||
          error?.errorMsg ||
          error?.message ||
          String(code || '');
        res
          .status(typeof status === 'number' ? status : 500)
          .json({ message: '更新路由条目失败', error: detail || '未知错误', code });
      }
    },
  );

  router.delete(
    '/:id/resources/route-entries',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { routeTableId, route } = req.body || {};
        if (!routeTableId || !route)
          return res.status(400).json({ message: '缺少 routeTableId 或 route 参数' });
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const current: any = await huaweiShowRouteTable(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          routeTableId,
        );
        const existRoutes: any[] =
          current?.routetable?.routes || current?.route_table?.routes || [];
        const reqDst = String(route?.destination || '');
        const parseCidr = (cidr: string) => {
          const [ip, maskStr] = String(cidr).split('/');
          const mask = parseInt(maskStr || '0');
          const toNum = (s: string) =>
            s.split('.').reduce((a, n) => (a << 8) + (parseInt(n) || 0), 0) >>> 0;
          return { net: toNum(ip || '0.0.0.0'), mask };
        };
        const samePrefix = (a: { net: number; mask: number }, b: { net: number; mask: number }) => {
          const m = 32 - Math.min(a.mask, b.mask);
          const prefMask = m >= 32 ? 0 : (~0 << m) >>> 0;
          return (a.net & prefMask) === (b.net & prefMask);
        };
        const reqC = parseCidr(reqDst);
        let target = existRoutes.find((r: any) => String(r?.destination || '') === reqDst);
        if (!target) {
          const candidates = existRoutes.filter(
            (r: any) => r && r.destination && String(r.type || '').toLowerCase() !== 'local',
          );
          const matched = candidates.find((r: any) => {
            const rc = parseCidr(String(r.destination));
            return samePrefix(reqC, rc);
          });
          if (matched) target = matched;
        }
        if (!target)
          return res
            .status(404)
            .json({ message: '未找到需要删除的路由', error: `destination=${route?.destination}` });
        try {
          const data = await huaweiUpdateRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
            { del: [target] },
          );
          res.json({ message: '删除成功', data });
        } catch (err: any) {
          const after: any = await huaweiShowRouteTable(
            { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
            routeTableId,
          );
          const routes: any[] = after?.routetable?.routes || after?.route_table?.routes || [];
          const stillThere = (function () {
            const reqC = parseCidr(reqDst);
            return routes.some((r) => {
              const d = String(r?.destination || '');
              const rc = parseCidr(d);
              return samePrefix(reqC, rc);
            });
          })();
          if (!stillThere) return res.json({ message: '删除成功', data: { confirm: true } });
          const status = err?.response?.status ?? err?.status ?? 500;
          const data = err?.response?.data ?? err?.data;
          const code = err?.code ?? err?.errorCode;
          const detail =
            (data && (typeof data === 'string' ? data : JSON.stringify(data))) ||
            err?.errorMsg ||
            err?.message ||
            String(code || '');
          return res
            .status(typeof status === 'number' ? status : 500)
            .json({ message: '删除路由条目失败', error: detail || '未知错误', code });
        }
      } catch (error: any) {
        const status = error?.response?.status;
        const data = error?.response?.data;
        const detail =
          (data && (typeof data === 'string' ? data : JSON.stringify(data))) ||
          error?.errorMsg ||
          error?.message;
        res
          .status(typeof status === 'number' ? status : 500)
          .json({ message: '删除路由条目失败', error: detail || '未知错误' });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListSnapshots({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询快照失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/disks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListVolumes({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询云盘失败', error: error.message });
      }
    },
  );

  // 创建云盘 CreateVolume
  router.post(
    '/:id/resources/disks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const b = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!b.availabilityZone || !b.size) return res.status(400).json({ message: '缺少可用区或容量' });
        const volume: any = { availability_zone: b.availabilityZone, volume_type: b.volumeType || 'SAS', size: Number(b.size), count: Number(b.count || 1) };
        if (b.name) volume.name = b.name;
        if (b.description) volume.description = b.description;
        const data = await huaweiCreateVolume({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, volume);
        res.json({ message: '创建云盘指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建云盘失败', error: error.message });
      }
    },
  );

  // 删除云盘 DeleteVolume
  router.delete(
    '/:id/resources/disks/:diskId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiDeleteVolume({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, diskId);
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除云盘失败', error: error.message });
      }
    },
  );

  // 扩容云盘 ResizeVolume
  router.post(
    '/:id/resources/disks/:diskId/resize',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { newSize } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!newSize) return res.status(400).json({ message: '缺少目标容量 newSize' });
        const data = await huaweiResizeVolume({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, diskId, Number(newSize));
        res.json({ message: '扩容指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '扩容云盘失败', error: error.message });
      }
    },
  );

  // 挂载云盘 AttachVolume
  router.post(
    '/:id/resources/disks/:diskId/attach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { instanceId, device } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!instanceId) return res.status(400).json({ message: '缺少目标实例 instanceId' });
        const data = await huaweiAttachVolume({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, instanceId, diskId, device);
        res.json({ message: '挂载指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '挂载云盘失败', error: error.message });
      }
    },
  );

  // 卸载云盘 DetachVolume
  router.post(
    '/:id/resources/disks/:diskId/detach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { instanceId } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!instanceId) return res.status(400).json({ message: '缺少所属实例 instanceId' });
        const data = await huaweiDetachVolume({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, instanceId, diskId);
        res.json({ message: '卸载指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '卸载云盘失败', error: error.message });
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
        const { diskId, name, description } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!diskId) return res.status(400).json({ message: '缺少源云盘 diskId' });
        const data = await huaweiCreateSnapshot({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, diskId, name, description);
        res.json({ message: '创建快照指令已下发', data });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiDeleteSnapshot({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, snapshotId);
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除快照失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/vswitches',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListSubnets({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询子网失败', error: error.message });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListSubnets(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          vpcId,
        );
        const capabilities = {
          isHarvester: false,
          supportsSubnets: true,
          supportsNetworkFusion: false,
          supportsMultus: false,
        };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询子网失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/security-groups',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListSecurityGroups({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询安全组失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/security-groups',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const src = (req.body && (req.body.security_group || req.body)) || {};
        const name: string | undefined =
          src?.name || src?.SecurityGroupName || src?.SecurityGroupId || src?.SecurityGroup;
        const description: string | undefined = src?.description || src?.Description;
        const enterprise_project_id: string | undefined = src?.enterprise_project_id;
        if (!name) return res.status(400).json({ message: '缺少必填参数：name' });
        const data = await huaweiCreateSecurityGroup(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          { name, description, enterprise_project_id },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建安全组失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/security-groups/:sgId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!sgId) return res.status(400).json({ message: '缺少 sgId 参数' });
        const data = await huaweiShowSecurityGroup(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          sgId,
        );
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询安全组详情失败', error: error.message });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!sgId) return res.status(400).json({ message: '缺少 sgId 参数' });
        const data = await huaweiDeleteSecurityGroup(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          sgId,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除安全组失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/security-groups/:sgId/rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!sgId) return res.status(400).json({ message: '缺少 sgId 参数' });
        const src = (req.body && (req.body.rule || req.body)) || {};
        const direction: string = String(src?.direction || '').toLowerCase();
        const protocol: string | undefined = src?.protocol
          ? String(src?.protocol).toLowerCase()
          : undefined;
        const ethertype: string | undefined = src?.ethertype
          ? String(src?.ethertype).toLowerCase()
          : undefined;
        const port_range_min: number | undefined =
          src?.port_range_min != null
            ? Number(src?.port_range_min)
            : src?.port_min != null
              ? Number(src?.port_min)
              : undefined;
        const port_range_max: number | undefined =
          src?.port_range_max != null
            ? Number(src?.port_range_max)
            : src?.port_max != null
              ? Number(src?.port_max)
              : undefined;
        const remote_ip_prefix: string | undefined = src?.remote_ip_prefix || src?.remote_ip_cidr;
        const remote_group_id: string | undefined = src?.remote_group_id;
        const description: string | undefined = src?.description;
        if (!direction) return res.status(400).json({ message: '缺少必填参数：direction' });
        const data = await huaweiCreateSecurityGroupRule(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          {
            security_group_id: sgId,
            direction,
            protocol,
            ethertype,
            port_range_min,
            port_range_max,
            remote_ip_prefix,
            remote_group_id,
            description,
          },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建安全组规则失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/security-groups/:sgId/rules/:ruleId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId, ruleId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!sgId) return res.status(400).json({ message: '缺少 sgId 参数' });
        if (!ruleId) return res.status(400).json({ message: '缺少 ruleId 参数' });
        const data = await huaweiDeleteSecurityGroupRule(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          ruleId,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除安全组规则失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/security-groups/:sgId/rules/:ruleId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, sgId, ruleId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!sgId) return res.status(400).json({ message: '缺少 sgId 参数' });
        if (!ruleId) return res.status(400).json({ message: '缺少 ruleId 参数' });
        const src = (req.body && (req.body.rule || req.body)) || {};
        const direction: string = String(src?.direction || '').toLowerCase();
        const protocol: string | undefined = src?.protocol
          ? String(src?.protocol).toLowerCase()
          : undefined;
        const ethertype: string | undefined = src?.ethertype
          ? String(src?.ethertype).toLowerCase()
          : undefined;
        const port_range_min: number | undefined =
          src?.port_range_min != null
            ? Number(src?.port_range_min)
            : src?.port_min != null
              ? Number(src?.port_min)
              : undefined;
        const port_range_max: number | undefined =
          src?.port_range_max != null
            ? Number(src?.port_range_max)
            : src?.port_max != null
              ? Number(src?.port_max)
              : undefined;
        const remote_ip_prefix: string | undefined = src?.remote_ip_prefix || src?.remote_ip_cidr;
        const remote_group_id: string | undefined = src?.remote_group_id;
        const description: string | undefined = src?.description;
        await huaweiDeleteSecurityGroupRule(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          ruleId,
        );
        const data = await huaweiCreateSecurityGroupRule(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          {
            security_group_id: sgId,
            direction,
            protocol,
            ethertype,
            port_range_min,
            port_range_max,
            remote_ip_prefix,
            remote_group_id,
            description,
          },
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新安全组规则失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/eips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListPublicips({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        const publicips =
          data?.publicips ||
          data?.data?.publicips ||
          data?.publicIps ||
          data?.data?.publicIps ||
          [];
        res.json({ message: '查询成功', publicips, data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询弹性公网IP失败', error: error.message });
      }
    },
  );

  // 申请 EIP CreatePublicip
  router.post(
    '/:id/resources/eips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { ipType, bandwidthName, bandwidthSize, shareType, chargeMode } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiCreatePublicip(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          { ipType, bandwidthName, bandwidthSize, shareType, chargeMode },
        );
        res.json({ message: '申请成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '申请EIP失败', error: error.message });
      }
    },
  );

  // 释放 EIP DeletePublicip
  router.delete(
    '/:id/resources/eips/:eipId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, eipId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiDeletePublicip({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, eipId);
        res.json({ message: '释放成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '释放EIP失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/eips/:eipId/bind',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, eipId } = req.params;
        const { port_id } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!port_id) return res.status(400).json({ message: '缺少 port_id 参数' });
        const data = await huaweiUpdateFloatingip(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          String(eipId),
          String(port_id),
        );
        res.json({ message: '绑定成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '绑定EIP失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/eips/:eipId/unbind',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, eipId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiUpdateFloatingip(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          String(eipId),
          null,
        );
        res.json({ message: '解绑成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '解绑EIP失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/ports',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { deviceId } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!deviceId) return res.status(400).json({ message: '缺少 deviceId 参数' });
        const data = await huaweiListPorts(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          String(deviceId),
        );
        const ports: any[] = data?.ports || (data as any)?.data?.ports || [];
        res.json({ message: '查询成功', ports, data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询端口失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/ports/:portId/source-dest-check',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, portId } = req.params;
        const { enabled, allowed_ip } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (enabled === undefined && !allowed_ip)
          return res.status(400).json({ message: '至少提供 enabled 或 allowed_ip' });
        const payload: any = {};
        if (enabled !== undefined) {
          payload.port_security_enabled = !!enabled;
          if (enabled === false) {
            payload.security_groups = [];
          }
        }
        if (allowed_ip && (enabled === undefined || enabled === true)) {
          payload.allowed_address_pairs = [{ ip_address: String(allowed_ip) }];
        }
        const data = await huaweiUpdatePort(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          String(portId),
          payload,
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新端口失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/ports/:portId/security-groups',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, portId } = req.params;
        const { add, remove, set } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (add === undefined && remove === undefined && !Array.isArray(set))
          return res.status(400).json({ message: '至少提供 add 或 remove 或 set' });
        const current: any = await huaweiShowPort(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          String(portId),
        );
        const rawPort: any = current?.port || current?.data?.port || {};
        const curGroups: string[] = Array.isArray(rawPort?.security_groups)
          ? rawPort.security_groups
              .map((x: any) => (typeof x === 'string' ? x : x?.id || x?.SecurityGroupId || ''))
              .filter((s: any) => !!s)
              .map(String)
          : [];
        let nextGroups: string[] = curGroups.slice();
        if (Array.isArray(set)) {
          nextGroups = set.map(String);
        } else if (add !== undefined) {
          const gid = String(add);
          const s = new Set(nextGroups.map(String));
          s.add(gid);
          nextGroups = Array.from(s);
        } else if (remove !== undefined) {
          const gid = String(remove);
          nextGroups = nextGroups.filter((x) => String(x) !== gid);
        }
        const payload: any =
          nextGroups.length === 0
            ? { port_security_enabled: false, security_groups: [] }
            : { port_security_enabled: true, security_groups: nextGroups };
        const data = await huaweiUpdatePort(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          String(portId),
          payload,
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新端口安全组失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/loadbalancers',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListLoadBalancers({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        const loadbalancers = data?.loadbalancers || data?.data?.loadbalancers || [];
        res.json({ message: '查询成功', loadbalancers, data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询负载均衡失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/nat-gateways',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListNatGateways({
          ak: cloud.accessKey,
          sk: cloud.secretKey,
          region: cloud.region,
          projectId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询NAT网关失败', error: error.message });
      }
    },
  );

  // SNAT 规则列表
  router.get(
    '/:id/resources/nat-gateways/snat-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { natGatewayId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListSnatRules({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, natGatewayId);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询SNAT规则失败', error: error.message });
      }
    },
  );

  // 创建 SNAT 规则
  router.post(
    '/:id/resources/nat-gateways/snat-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { natGatewayId, floatingIpId, cidr, subnetId, sourceType } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!natGatewayId || !floatingIpId || (!cidr && !subnetId))
          return res.status(400).json({ message: '缺少 natGatewayId / floatingIpId / (cidr 或 subnetId)' });
        const rule: any = { nat_gateway_id: natGatewayId, floating_ip_id: floatingIpId };
        if (subnetId) { rule.network_id = subnetId; rule.source_type = sourceType ?? 0; }
        else { rule.cidr = cidr; rule.source_type = sourceType ?? 1; }
        const data = await huaweiCreateSnatRule({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, rule);
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建SNAT规则失败', error: error.message });
      }
    },
  );

  // 删除 SNAT 规则
  router.delete(
    '/:id/resources/nat-gateways/snat-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { natGatewayId, snatRuleId } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!natGatewayId || !snatRuleId) return res.status(400).json({ message: '缺少 natGatewayId 或 snatRuleId' });
        const data = await huaweiDeleteSnatRule({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, natGatewayId, snatRuleId);
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除SNAT规则失败', error: error.message });
      }
    },
  );

  // DNAT 规则列表
  router.get(
    '/:id/resources/nat-gateways/dnat-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { natGatewayId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListDnatRules({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, natGatewayId);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询DNAT规则失败', error: error.message });
      }
    },
  );

  // 创建 DNAT 规则
  router.post(
    '/:id/resources/nat-gateways/dnat-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { natGatewayId, floatingIpId, protocol, externalServicePort, internalServicePort, privateIp, portId } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!natGatewayId || !floatingIpId || !protocol)
          return res.status(400).json({ message: '缺少 natGatewayId / floatingIpId / protocol' });
        const rule: any = {
          nat_gateway_id: natGatewayId,
          floating_ip_id: floatingIpId,
          protocol,
          external_service_port: Number(externalServicePort),
          internal_service_port: Number(internalServicePort),
        };
        if (privateIp) rule.private_ip = privateIp;
        if (portId) rule.port_id = portId;
        const data = await huaweiCreateDnatRule({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, rule);
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建DNAT规则失败', error: error.message });
      }
    },
  );

  // 删除 DNAT 规则
  router.delete(
    '/:id/resources/nat-gateways/dnat-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { natGatewayId, dnatRuleId } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!natGatewayId || !dnatRuleId) return res.status(400).json({ message: '缺少 natGatewayId 或 dnatRuleId' });
        const data = await huaweiDeleteDnatRule({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, natGatewayId, dnatRuleId);
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除DNAT规则失败', error: error.message });
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
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiListDbInstances({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询云数据库失败', error: error.message });
      }
    },
  );

  // RDS 数据库版本
  router.get(
    '/:id/resources/rds/datastores',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { engine } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!engine) return res.status(400).json({ message: '缺少 engine' });
        const data = await huaweiListDatastores({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, engine);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询数据库版本失败', error: error.message });
      }
    },
  );

  // RDS 规格
  router.get(
    '/:id/resources/rds/flavors',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { engine, version } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!engine) return res.status(400).json({ message: '缺少 engine' });
        const data = await huaweiListRdsFlavors({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, engine, version);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询数据库规格失败', error: error.message });
      }
    },
  );

  // 创建 RDS 实例
  router.post(
    '/:id/resources/rds',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const b = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!b.name || !b.engine || !b.engineVersion || !b.flavorRef || !b.volumeType || !b.volumeSize || !b.vpcId || !b.subnetId || !b.securityGroupId || !b.availabilityZone || !b.password)
          return res.status(400).json({ message: '缺少必要参数（name/engine/engineVersion/flavorRef/volumeType/volumeSize/vpcId/subnetId/securityGroupId/availabilityZone/password）' });
        const instance: any = {
          name: b.name,
          datastore: { type: b.engine, version: b.engineVersion },
          flavor_ref: b.flavorRef,
          volume: { type: b.volumeType, size: Number(b.volumeSize) },
          region: cloud.region,
          availability_zone: b.availabilityZone,
          vpc_id: b.vpcId,
          subnet_id: b.subnetId,
          security_group_id: b.securityGroupId,
          password: b.password,
          charge_info: { charge_mode: 'postPaid' },
        };
        if (b.port) instance.port = String(b.port);
        const data = await huaweiCreateDbInstance({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, instance);
        res.json({ message: '创建数据库指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建云数据库失败', error: error.message });
      }
    },
  );

  // 删除 RDS 实例
  router.delete(
    '/:id/resources/rds/:dbInstanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiDeleteDbInstance({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, dbInstanceId);
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除云数据库失败', error: error.message });
      }
    },
  );

  // 重启 RDS 实例
  router.post(
    '/:id/resources/rds/:dbInstanceId/restart',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const data = await huaweiRestartDbInstance({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId }, dbInstanceId);
        res.json({ message: '重启指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '重启云数据库失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        const src = (req.body && (req.body.subnet || req.body)) || {};
        const vpc_id: string = String(src?.vpc_id || src?.VpcId || '').trim();
        const cidr: string = String(src?.cidr || src?.Cidr || '').trim();
        const name: string | undefined = src?.name || src?.SubnetName;
        const description: string | undefined = src?.description || src?.Description;
        const gateway_ip: string | undefined = src?.gateway_ip || src?.GatewayIp;
        const dhcp_enable: boolean | undefined =
          src?.dhcp_enable !== undefined ? !!src?.dhcp_enable : undefined;
        const primary_dns: string | undefined = src?.primary_dns;
        const secondary_dns: string | undefined = src?.secondary_dns;
        const dnsList: string[] | undefined = Array.isArray(src?.dnsList)
          ? src?.dnsList
          : undefined;
        const availability_zone: string | undefined =
          src?.availability_zone || src?.Zone || src?.ZoneId;
        if (!vpc_id) return res.status(400).json({ message: '缺少必填参数：vpc_id' });
        if (!cidr) return res.status(400).json({ message: '缺少必填参数：cidr' });
        const data = await huaweiCreateSubnet(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          {
            vpc_id,
            cidr,
            name,
            description,
            gateway_ip,
            dhcp_enable,
            primary_dns,
            secondary_dns,
            dnsList,
            availability_zone,
          },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建子网失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/subnets/:subnetId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, subnetId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!subnetId) return res.status(400).json({ message: '缺少 subnetId 参数' });
        const src = (req.body && (req.body.subnet || req.body)) || {};
        const name: string | undefined = src?.name || src?.SubnetName;
        const description: string | undefined = src?.description || src?.Description;
        const dhcp_enable: boolean | undefined =
          src?.dhcp_enable !== undefined ? !!src?.dhcp_enable : undefined;
        const primary_dns: string | undefined = src?.primary_dns;
        const secondary_dns: string | undefined = src?.secondary_dns;
        const dnsList: string[] | undefined = Array.isArray(src?.dnsList)
          ? src?.dnsList
          : undefined;
        if (
          name === undefined &&
          description === undefined &&
          dhcp_enable === undefined &&
          primary_dns === undefined &&
          secondary_dns === undefined &&
          (!dnsList || !dnsList.length)
        ) {
          return res.status(400).json({ message: '至少提供一个可修改字段' });
        }
        const data = await huaweiUpdateSubnet(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          subnetId,
          { name, description, dhcp_enable, primary_dns, secondary_dns, dnsList },
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '更新子网失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/subnets/:subnetId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, subnetId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isHuawei(cloud)) return next();
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId)
          return res.status(400).json({ message: '缺少华为云访问密钥或项目ID（projectId）' });
        if (!subnetId) return res.status(400).json({ message: '缺少 subnetId 参数' });
        const data = await huaweiDeleteSubnet(
          { ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId },
          subnetId,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除子网失败', error: error.message });
      }
    },
  );
};
