import { Router, Response } from 'express';
import axios from 'axios';
import https from 'https';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database';
import { Cloud, CloudType, CloudStatus } from '../entities/Cloud';
import { CloudInstanceInventory } from '../entities/CloudInstanceInventory';
import { HarvesterVmInventory } from '../entities/harvester/HarvesterVmInventory';
import { HarvesterVmiInventory } from '../entities/harvester/HarvesterVmiInventory';
import { ResourcePoolAssignment } from '../entities/ResourcePoolAssignment';
import { UserSpace } from '../entities/UserSpace';
import { AuthRequest } from '../middleware/auth';
import { User, UserRole } from '../entities/User';
import { syncKubevirtVms, syncKubevirtVmis } from '../services/clouds/harvester/inventory';
import { licenseService } from '../services/LicenseService';
// 新权限体系
import { createApiPermissionMiddleware } from '../permissions';
import { logger } from '../utils/logger';
import { attachDatacenterTopologyRoutes } from './clouds/datacenterTopology.routes';
import { attachRancherClusterResourceRoutes } from './clouds/rancherClusterResources.routes';

const cloudRouteLog = logger.child('Cloud');
const cloudDebugLog = logger.child('Cloud-Debug');

// 多云接入与资源池路由：
// - 管理云资源池（Cloud）对象的增删改查与连通性测试
// - 按统一格式列出不同云厂商/Harvester/CloudMap 中的实例、VPC 等资源
// - 提供权限控制中间件，细分到实例、控制台、VPC 等不同子资源
// - 承接 Harvester、CloudMap 相关的同步任务
const router = Router();

// 对 Cloud 实体进行脱敏处理：
// - 将枚举字段 type/status 统一小写，便于前端处理
// - 对 accessKey/secretKey 仅保留末尾 4 位，避免在接口中泄露完整密钥
const redactCloud = (cloud: any) => ({
  ...cloud,
  status: typeof cloud.status === 'string' ? cloud.status.toLowerCase() : cloud.status,
  type: typeof cloud.type === 'string' ? cloud.type.toLowerCase() : cloud.type,
  accessKey: cloud.accessKey ? '***' + String(cloud.accessKey).slice(-4) : undefined,
  secretKey: cloud.secretKey ? '***' + String(cloud.secretKey).slice(-4) : undefined,
});

type RancherClusterListItem = {
  id: string;
  name: string;
  state: string;
  kubernetesVersion?: string;
};

// 统一的云连接测试入口：
// 根据 provider 选择对应云厂商 / Harvester / CloudMap 的测试函数，
// 返回 { ok, message, data? } 结构，供创建/测试接口复用。
const testCloudConnectionUnified = async (args: {
  provider?: string;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  endpoint?: string;
  config?: any;
}): Promise<{
  ok: boolean;
  message: string;
  data?: { rancherClusters: RancherClusterListItem[] };
}> => {
  const providerRaw = String(args.provider || args.config?.provider || '').trim();
  const provider = providerRaw.toLowerCase();
  if (provider === 'aliyun') {
    const t = await testAliyunConnection({
      accessKeyId: args.accessKey || '',
      accessKeySecret: args.secretKey || '',
      regionId: args.region || '',
      action: 'DescribeVpcs',
    });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'huaweicloud') {
    const projectId = args.config?.projectId;
    if (!args.accessKey || !args.secretKey || !projectId)
      return { ok: false, message: '缺少华为云访问密钥或项目ID（projectId）' };
    const t = await testHuaweiConnection({
      ak: args.accessKey,
      sk: args.secretKey,
      region: args.region || '',
      projectId,
    });
    return { ok: !!t.ok, message: t.message || '' };
  }
  // 在平台当前版本中不再支持直接接入腾讯云，这里统一返回失败信息
  if (provider === 'tencentcloud') {
    return { ok: false, message: '已不支持腾讯云接入' };
  }
  if (provider === 'cloudmap.csm') {
    try {
      const config = {
        endpoint: String(args.endpoint || '').trim(),
        accessKey: String(args.accessKey || '').trim(),
        secretKey: String(args.secretKey || '').trim(),
        ignoreTls: !!args.config?.ignoreTls,
      };
      // Perform a real API call to verify connectivity and permissions
      // Querying VM list (limit 1) to ensure the data plane is accessible
      await csmRequest(config, '/V2/ctcontrol/VM04/vms', { page_size: 1, page_num: 1 });
      return { ok: true, message: '连接成功，API调用正常' };
    } catch (err: any) {
      cloudRouteLog.error(
        'Cloudmap connection test failed:',
        err?.response?.data?.message || err?.message || String(err),
      );
      const msg = err?.response?.data?.message || err?.message || '连接失败';
      return { ok: false, message: `连接失败: ${msg}` };
    }
  }
  if (provider === 'cloudmap.private' || provider === 'cloudmap.edge') {
    const t = await testHarvesterConnection({
      endpoint: args.endpoint || '',
      token: args.config?.apiToken || args.config?.token || args.secretKey || '',
      insecure: !!args.config?.ignoreTls,
    });
    // 对于 Cloudmap 资源池，将 "Harvester" 字样替换为更通用的提示
    let message = t.message || '';
    if (message.includes('Harvester')) {
      message = message.replace(/Harvester/g, 'Cloudmap');
    }
    return { ok: !!t.ok, message };
  }
  if (provider === 'rancher') {
    let base = String(args.endpoint || args.config?.rancherUrl || '')
      .trim()
      .replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) {
      base = `https://${base}`;
    }
    const token = String(
      args.secretKey || args.config?.apiToken || args.config?.token || '',
    ).trim();
    const insecure = !!args.config?.ignoreTls;
    if (!base || !token) {
      return { ok: false, message: '缺少 Rancher 地址或 API 令牌' };
    }
    try {
      const u = new URL(base);
      const isHttps = u.protocol === 'https:';
      const agent = isHttps
        ? new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure })
        : undefined;
      const url = `${u.origin}/v3`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        ...(isHttps && agent ? { httpsAgent: agent } : {}),
        timeout: 20000,
        validateStatus: () => true,
      });
      if (res.status === 200) {
        let rancherClusters: RancherClusterListItem[] = [];
        try {
          const listUrl = `${u.origin}/v3/clusters?limit=1000`;
          const cRes = await axios.get(listUrl, {
            headers: { Authorization: `Bearer ${token}` },
            ...(isHttps && agent ? { httpsAgent: agent } : {}),
            timeout: 30000,
            validateStatus: () => true,
          });
          if (cRes.status === 200) {
            const body = cRes.data;
            const items: any[] = Array.isArray(body?.data)
              ? body.data
              : Array.isArray(body?.items)
                ? body.items
                : [];
            rancherClusters = items.map((c) => {
              const cid = String(c?.id || c?.Id || '').trim();
              const name =
                String(c?.name || c?.Name || cid || '').trim() || cid || '—';
              const state = String(c?.state || c?.State || '').trim() || 'unknown';
              const k8s =
                c?.version?.gitVersion ||
                c?.kubernetesVersion ||
                c?.appliedSpec?.rancherKubernetesEngineConfig?.kubernetesVersion ||
                '';
              return {
                id: cid,
                name,
                state,
                kubernetesVersion: String(k8s || '').trim() || undefined,
              };
            });
            const want = String(args.config?.clusterId || '')
              .trim();
            if (want) {
              const found = rancherClusters.some((c) => c.id === want);
              if (!found) {
                return {
                  ok: false,
                  message: `未在 Rancher 中找到 id 为「${want}」的集群，请核对 Norman 集群 id（c-xxxxx）`,
                };
              }
            }
          } else {
            const want = String(args.config?.clusterId || '').trim();
            if (want) {
              return {
                ok: false,
                message: `无法拉取 Rancher 集群列表以校验 clusterId（HTTP ${cRes.status}），请检查 API 令牌权限`,
              };
            }
          }
        } catch (e) {
          cloudDebugLog.debug('Rancher /v3/clusters in test-connection', (e as any)?.message);
          if (String(args.config?.clusterId || '').trim()) {
            return {
              ok: false,
              message: `拉取 Rancher 集群列表失败，无法校验 clusterId: ${(e as any)?.message || String(e)}`,
            };
          }
        }
        return { ok: true, message: 'Rancher 接口连通', data: { rancherClusters } };
      }
      if (res.status === 401) {
        return { ok: false, message: '认证失败：Rancher API 令牌无效或已过期' };
      }
      return { ok: false, message: `Rancher 连接失败: HTTP ${res.status}` };
    } catch (err: any) {
      const m =
        err?.response?.data?.message || err?.message || 'Rancher 连接失败';
      return { ok: false, message: `连接失败: ${m}` };
    }
  }
  if (provider === 'harvester') {
    const t = await testHarvesterConnection({
      endpoint: args.endpoint || '',
      token: args.config?.apiToken || args.config?.token || args.secretKey || '',
      insecure: !!args.config?.ignoreTls,
    });
    return { ok: !!t.ok, message: t.message || '' };
  }
  return { ok: false, message: '暂不支持该云接入' };
};

// 通用的 Cloud 查找函数，未找到时直接在响应中返回 404，并返回 null
const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

// 校验 Cloud 是否属于指定 provider，避免错误地在不兼容云类型上执行操作
const ensureProvider = (cloud: any, provider: string, res: Response, msg: string) => {
  if (String(cloud?.config?.provider || '').toLowerCase() !== String(provider).toLowerCase()) {
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

// Cloud 创建/更新的输入验证中间件：
// - 校验 name/type/region/endpoint/config.provider 等必填字段
// - 限制 provider 必须在支持列表内
// - 对 provider 值做 trim 与统一小写处理，并为 harvester 系列补充默认版本号
const validateCloudInput = (req: AuthRequest, res: Response, next: any) => {
  const { name, type, region, endpoint, config } = req.body;
  if (!name || !type || !region || !endpoint || !config?.provider) {
    return res
      .status(400)
      .json({ message: '缺少必填字段：name, type, region, endpoint, config.provider' });
  }
  if (!Object.values(CloudType).includes(type)) {
    return res.status(400).json({ message: '无效的云服务类型' });
  }
  const pvRaw = String(config.provider).trim();
  const allowed = [
    'aliyun',
    'huaweicloud',
    'tencentcloud',
    'cloudmap.private',
    'cloudmap.edge',
    'cloudmap.csm',
    'rancher',
  ];
  if (!allowed.includes(pvRaw)) {
    return res.status(400).json({ message: `不支持的 provider：${pvRaw}` });
  }
  const fixedConfig = { ...(config || {}), provider: pvRaw };
  if (pvRaw === 'cloudmap.private' || pvRaw === 'cloudmap.edge') {
    fixedConfig.harvesterVersion = '1.6';
  }
  if (pvRaw === 'rancher' && !String(fixedConfig.clusterId || '').trim()) {
    return res.status(400).json({
      message: 'Rancher 资源池需填写活动集群 ID（一池对应一个下游集群，即 Norman 的 c-xxxxx）',
    });
  }
  req.body.config = fixedConfig;
  next();
};

// 权限检查中间件（已迁移到新权限体系）
// 使用新的权限体系中间件，自动从 API 路径解析权限
// 保持向后兼容：如果新权限体系无法解析，会回退到旧的路径匹配逻辑
const checkAdminPermission = createApiPermissionMiddleware({
  allowSuperAdmin: true,
});

// 引入阿里云 RPC 调用封装（不依赖官方 SDK）
import {
  testAliyunConnection,
  callAliyunEcs,
  callAliyunSlb,
  callAliyunVpc,
  callAliyunCms,
} from '../services/clouds/aliyun/client';
// 引入华为云 SDK 封装
import {
  testHuaweiConnection,
  huaweiListVpcs,
  huaweiListServers,
  huaweiListSnapshots,
  huaweiListSubnets,
  huaweiListRouteTables,
} from '../services/clouds/huaweicloud/client';
import {
  testHarvesterConnection,
  listHarvesterVMsStandard,
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterDeleteVM,
  listKubeOvnVpcs,
  listKubeOvnSubnets,
} from '../services/clouds/harvester/client';
import { listCsmVms, csmRequest } from '../services/clouds/csm/client';
import { registerCsmRoutes } from './clouds/csm';
import { registerAliyunRoutes } from './clouds/aliyun';
import { registerHuaweiRoutes } from './clouds/huaweicloud';
import { registerTencentRoutes } from './clouds/tencentcloud';
import {
  registerHarvesterDirectRoutes,
  registerHarvesterRoutes,
  registerHarvesterServiceRoutesProvider,
} from './clouds/harvester';
import { standardResourceService } from '../services/StandardResourceService';

// 工具函数：从不同云厂商/平台的原始资源对象中抽取统一的 id / name 标识，
// 避免在前端或其它服务中到处写兼容逻辑。
const extractIdentity = (provider: string, type: 'vm' | 'vpc', r: any) => {
  let id = '';
  let name = '';

  if (type === 'vm') {
    if (provider === 'aliyun') {
      id = r?.InstanceId;
      name = r?.InstanceName || r?.HostName;
    } else if (provider === 'huaweicloud') {
      id = r?.id;
      name = r?.name;
    } else if (
      provider === 'harvester' ||
      provider === 'cloudmap.private' ||
      provider === 'cloudmap.edge'
    ) {
      id = r?.InstanceId || '';
      // Harvester name logic (split from ID or Extra.Name)
      if (id.includes('/')) name = id.split('/').pop() || '';
      else name = r?.Extra?.Name;
    } else if (provider === 'cloudmap.csm' || provider === 'cloudmap') {
      id = r?.InstanceId || r?.id || r?.Id || r?.uuid || '';
      name = r?.InstanceName || r?.HostName || r?.name || r?.Name;
    }
  } else if (type === 'vpc') {
    if (provider === 'aliyun') {
      id = r?.VpcId;
      name = r?.VpcName;
    } else if (provider === 'huaweicloud') {
      id = r?.id || r?.VpcId;
      name = r?.name || r?.VpcName;
    }
  }

  // Fallbacks if specific logic didn't find them
  if (!id) id = r?.id || r?.Id || '';
  if (!name) name = r?.name || r?.Name || '';

  // Final guarantee: name defaults to ID if ID exists
  if (id && !name) name = id;

  return { id, name };
};

// 将各云厂商/Harvester/CloudMap 的子路由注册到统一的 /clouds 路由下，
// 并统一使用 checkAdminPermission 做权限拦截。
//
// 顺序说明：阿里云 / 华为云 / 腾讯云 的部分路由与 Harvester 缓存路由使用相同路径
//（如 GET /:id/resources/vpcs、GET /:id/resources/ecs）。公有云实现会在非本厂商时 next()，
// 若先注册 Harvester 的 createProviderRouter，则会先响应并返回「云平台 xxx 不支持此操作」。
// 因此必须先注册公有云专用路由，再注册 Harvester 缓存路由。
registerHarvesterDirectRoutes(router, checkAdminPermission);
registerAliyunRoutes(router, checkAdminPermission);
registerHuaweiRoutes(router, checkAdminPermission);
registerTencentRoutes(router, checkAdminPermission);
registerCsmRoutes(router, checkAdminPermission);
registerHarvesterRoutes(router, checkAdminPermission);
registerHarvesterServiceRoutesProvider(router, checkAdminPermission);
attachRancherClusterResourceRoutes(router, checkAdminPermission);

// 标准化获取实例列表：
// - 对不同 provider 的接口调用结果进行统一转换，输出统一结构的实例信息
// - 支持 raw=true 直接返回云厂商原始响应，便于排查问题
const fetchInstancesForCloud = async (cloud: Cloud, raw: boolean = false) => {
  const providerRaw = String((cloud as any)?.config?.provider || '');
  const provider = providerRaw.toLowerCase();
  const supported = [
    'aliyun',
    'huaweicloud',
    'harvester',
    'cloudmap.private',
    'cloudmap.edge',
    'cloudmap.csm',
  ];

  if (!supported.includes(provider)) return raw ? { error: 'Unsupported provider' } : [];

  let list: any[] = [];
  const vpcInfoMap = new Map<string, { name?: string; cidr?: string }>();
  const vswInfoMap = new Map<string, { name?: string; cidr?: string; vpcId?: string }>();

  if (provider === 'aliyun') {
    if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
      return raw ? { error: 'Missing credentials' } : [];
    const resp: any = await callAliyunEcs({
      accessKeyId: cloud.accessKey,
      accessKeySecret: cloud.secretKey,
      regionId: cloud.region,
      action: 'DescribeInstances',
      extraParams: { PageNumber: 1, PageSize: 100 },
    } as any);
    if (raw) return resp;
    list = resp?.Instances?.Instance || [];
    try {
      const vpcResp: any = await callAliyunVpc({
        accessKeyId: cloud.accessKey,
        accessKeySecret: cloud.secretKey,
        regionId: cloud.region,
        action: 'DescribeVpcs',
        extraParams: { PageNumber: 1, PageSize: 100 },
      } as any);
      const vpcs: any[] = vpcResp?.Vpcs?.Vpc || vpcResp?.VpcSets?.VpcSet || [];
      for (const v of Array.isArray(vpcs) ? vpcs : []) {
        if (v?.VpcId) vpcInfoMap.set(v.VpcId, { name: v?.VpcName, cidr: v?.CidrBlock });
      }
      const vswResp: any = await callAliyunVpc({
        accessKeyId: cloud.accessKey,
        accessKeySecret: cloud.secretKey,
        regionId: cloud.region,
        action: 'DescribeVSwitches',
        extraParams: { PageNumber: 1, PageSize: 100 },
      } as any);
      const vsws: any[] = vswResp?.VSwitches?.VSwitch || [];
      for (const s of Array.isArray(vsws) ? vsws : []) {
        if (s?.VSwitchId)
          vswInfoMap.set(s.VSwitchId, {
            name: s?.VSwitchName,
            cidr: s?.CidrBlock,
            vpcId: s?.VpcId,
          });
      }
    } catch {}
  } else if (provider === 'huaweicloud') {
    const projectId = (cloud.config as any)?.projectId;
    if (!cloud.accessKey || !cloud.secretKey || !projectId)
      return raw ? { error: 'Missing credentials' } : [];
    const resp: any = await huaweiListServers({
      ak: cloud.accessKey,
      sk: cloud.secretKey,
      region: cloud.region,
      projectId,
    });
    if (raw) return resp;
    list = resp?.servers || [];
    try {
      const vpcResp: any = await huaweiListVpcs({
        ak: cloud.accessKey,
        sk: cloud.secretKey,
        region: cloud.region,
        projectId,
      });
      const vpcs: any[] = (vpcResp as any)?.vpcs || (vpcResp as any)?.vpcs?.vpcs || [];
      for (const v of Array.isArray(vpcs) ? vpcs : []) {
        const vid = v?.id || v?.VpcId;
        if (vid)
          vpcInfoMap.set(vid, { name: v?.name || v?.VpcName, cidr: v?.cidr || v?.CidrBlock });
      }
    } catch {}
  } else if (provider === 'harvester') {
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const version = String((cloud.config as any)?.harvesterVersion || '').trim();
    const resp: any[] = await listHarvesterVMsStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
      version,
    } as any);
    if (raw) return resp;
    list = Array.isArray(resp) ? resp : [];
  } else if (provider === 'cloudmap.csm') {
    const endpointRaw = String(cloud.endpoint || '').trim();
    const ak = String(cloud.accessKey || '').trim();
    const sk = String(cloud.secretKey || '').trim();
    if (!ak || !sk) {
      list = [];
    } else {
      const ignoreTls = !!(cloud as any)?.config?.ignoreTls;
      list = await listCsmVms({ endpoint: endpointRaw, accessKey: ak, secretKey: sk, ignoreTls });
    }
    if (raw) return list;
  } else if (provider === 'cloudmap.private' || provider === 'cloudmap.edge') {
    const insecure = !!(cloud.config as any)?.ignoreTls;
    let version = String((cloud.config as any)?.harvesterVersion || '').trim();
    if (!version) version = '1.6';
    const resp: any[] = await listHarvesterVMsStandard({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
      version,
    } as any);
    if (raw) return resp;
    list = Array.isArray(resp) ? resp : [];
  }

  const items: any[] = [];
  for (const r of Array.isArray(list) ? list : []) {
    const norm = await (async () => {
      if (provider === 'aliyun') {
        const ips: any[] = r?.VpcAttributes?.PrivateIpAddress?.IpAddress || [];
        const cpu = (r as any)?.Cpu;
        const memRaw = (r as any)?.Memory;
        const memoryGb =
          typeof memRaw === 'number'
            ? memRaw > 256
              ? Math.round(memRaw / 1024)
              : memRaw
            : undefined;
        let usageCpuPct: number | undefined;
        let usageMemPct: number | undefined;
        try {
          const now = new Date();
          const end = now.toISOString().slice(0, 19) + 'Z';
          const startDt = new Date(now.getTime() - 5 * 60 * 1000);
          const start = startDt.toISOString().slice(0, 19) + 'Z';
          const dims = JSON.stringify([{ instanceId: r?.InstanceId }]);
          const cpuRes: any = await callAliyunCms({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeMetricList',
            version: '2019-01-01',
            extraParams: {
              Namespace: 'acs_ecs_dashboard',
              MetricName: 'CPUUtilization',
              Period: '60',
              Dimensions: dims,
              StartTime: start,
              EndTime: end,
            },
          } as any);
          const cpuPointsStr: string = cpuRes?.Datapoints || '[]';
          const cpuPoints: any[] = JSON.parse(cpuPointsStr);
          const cpuLatest = cpuPoints.length ? cpuPoints[cpuPoints.length - 1] : undefined;
          const cpuAvg = cpuLatest?.Average ?? cpuLatest?.Value;
          usageCpuPct =
            typeof cpuAvg === 'number' ? Math.min(100, Math.max(0, Math.round(cpuAvg))) : undefined;
          if (typeof memoryGb === 'number' && memoryGb > 0) {
            const memRes: any = await callAliyunCms({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeMetricList',
              version: '2019-01-01',
              extraParams: {
                Namespace: 'acs_ecs_dashboard',
                MetricName: 'memory_usedutilization',
                Period: '60',
                Dimensions: dims,
                StartTime: start,
                EndTime: end,
              },
            } as any);
            const memPointsStr: string = memRes?.Datapoints || '[]';
            const memPoints: any[] = JSON.parse(memPointsStr);
            const memLatest = memPoints.length ? memPoints[memPoints.length - 1] : undefined;
            const memAvg = memLatest?.Average ?? memLatest?.Value;
            usageMemPct =
              typeof memAvg === 'number'
                ? Math.min(100, Math.max(0, Math.round(memAvg)))
                : undefined;
          }
        } catch {}
        const vswId: string | undefined = r?.VpcAttributes?.VSwitchId || r?.VSwitchId;
        if (vswId && !vswInfoMap.has(vswId)) {
          try {
            const one: any = await callAliyunVpc({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeVSwitches',
              extraParams: { VSwitchId: vswId },
            } as any);
            const arr: any[] = one?.VSwitches?.VSwitch || [];
            const item = Array.isArray(arr) ? arr[0] : undefined;
            if (item?.VSwitchId)
              vswInfoMap.set(item.VSwitchId, {
                name: item?.VSwitchName,
                cidr: item?.CidrBlock,
                vpcId: item?.VpcId,
              });
          } catch {}
        }
        const vpcIdAli =
          r?.VpcId || r?.VpcAttributes?.VpcId || (vswId ? vswInfoMap.get(vswId)?.vpcId : undefined);
        if (vpcIdAli && !vpcInfoMap.has(vpcIdAli)) {
          try {
            const one: any = await callAliyunVpc({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeVpcs',
              extraParams: { VpcId: vpcIdAli },
            } as any);
            const arr: any[] = one?.Vpcs?.Vpc || one?.VpcSets?.VpcSet || [];
            const item = Array.isArray(arr) ? arr[0] : undefined;
            if (item?.VpcId)
              vpcInfoMap.set(item.VpcId, { name: item?.VpcName, cidr: item?.CidrBlock });
          } catch {}
        }
        if (vpcIdAli) {
          const cached = vpcInfoMap.get(vpcIdAli);
          if (!cached?.name || cached.name === vpcIdAli) {
            try {
              const attr: any = await callAliyunVpc({
                accessKeyId: cloud.accessKey,
                accessKeySecret: cloud.secretKey,
                regionId: cloud.region,
                action: 'DescribeVpcAttribute',
                extraParams: { VpcId: vpcIdAli },
              } as any);
              const name2 = attr?.VpcName || attr?.Vpc?.VpcName;
              const cidr2 = attr?.CidrBlock || attr?.Vpc?.CidrBlock;
              vpcInfoMap.set(vpcIdAli, {
                name: name2 || cached?.name,
                cidr: cidr2 || cached?.cidr,
              });
            } catch {}
          }
        }
        const { id, name } = extractIdentity(provider, 'vm', r);
        return {
          id,
          name,
          provider,
          cloudId: cloud.id,
          region: cloud.region,
          status: r?.Status,
          vpcId: vpcIdAli,
          zoneId: r?.ZoneId,
          instanceType: r?.InstanceType,
          privateIps: Array.isArray(ips) ? ips : [],
          createdAt: r?.CreationTime,
          extra: {
            vpcId: vpcIdAli,
            vpcName: (vpcIdAli && vpcInfoMap.get(vpcIdAli)?.name) || vpcIdAli || undefined,
            vpcCidr:
              (vpcIdAli && vpcInfoMap.get(vpcIdAli)?.cidr) ||
              r?.VpcAttributes?.CidrBlock ||
              undefined,
            subnetId: vswId,
            subnetName:
              ((r?.VpcAttributes?.VSwitchId || r?.VSwitchId) &&
                vswInfoMap.get(r?.VpcAttributes?.VSwitchId || r?.VSwitchId)?.name) ||
              undefined,
            subnetCidr:
              ((r?.VpcAttributes?.VSwitchId || r?.VSwitchId) &&
                vswInfoMap.get(r?.VpcAttributes?.VSwitchId || r?.VSwitchId)?.cidr) ||
              undefined,
          },
          cpu: typeof cpu === 'number' ? cpu : undefined,
          memoryGb,
          usageCpuPct,
          usageMemPct,
          caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true },
        };
      } else if (provider === 'cloudmap.csm' || provider === 'cloudmap') {
        const { id, name } = extractIdentity(provider, 'vm', r);
        const pri = Array.isArray((r as any)?.IPs)
          ? (r as any)?.IPs
          : Array.isArray((r as any)?.Extra?.IPs)
            ? (r as any)?.Extra?.IPs
            : [];
        const cpuRaw = (r as any)?.CPU ?? (r as any)?.Extra?.CPU ?? (r as any)?.Spec?.CPU;
        const cpu = typeof cpuRaw === 'number' ? cpuRaw : undefined;
        const memRaw = (r as any)?.Memory ?? (r as any)?.Extra?.Memory;
        const memMatch =
          typeof memRaw === 'string' ? String(memRaw).match(/([0-9]+\.?[0-9]*)/i) : null;
        const memoryGb = memMatch
          ? Math.round(parseFloat(memMatch[1]))
          : typeof memRaw === 'number'
            ? memRaw
            : undefined;
        const cpuUsagePct = (r as any)?.CpuUsagePct ?? (r as any)?.Extra?.CpuUsagePct;
        const memUsageStr: string | undefined = (r as any)?.MemUsage ?? (r as any)?.Extra?.MemUsage;
        const memUsageMiMatch =
          typeof memUsageStr === 'string' ? memUsageStr.match(/([0-9]+\.?[0-9]*)\s*Mi/i) : null;
        const memUsageMi = memUsageMiMatch ? parseFloat(memUsageMiMatch[1]) : undefined;
        const usageMemPct =
          typeof memoryGb === 'number' && memoryGb > 0 && typeof memUsageMi === 'number'
            ? Math.min(100, Math.max(0, Math.round((memUsageMi / (memoryGb * 1024)) * 100)))
            : undefined;
        return {
          id,
          name,
          provider,
          cloudId: cloud.id,
          region: cloud.region,
          status: r?.Status || (r as any)?.status || (r as any)?.PowerStatus,
          vpcId: undefined,
          zoneId: undefined,
          instanceType: undefined,
          privateIps: Array.isArray(pri) ? pri : [],
          createdAt:
            r?.CreationTime ||
            (r as any)?.CreatedAt ||
            (r as any)?.createTime ||
            (r?.Extra as any)?.CreationTime ||
            undefined,
          extra: {
            namespace: (r as any)?.namespace,
            networks: (r as any)?.Networks || (r?.Extra as any)?.Networks,
            imageType: (r as any)?.ImageType || (r?.Extra as any)?.ImageType,
            imageVersion: (r as any)?.ImageVersion || (r?.Extra as any)?.ImageVersion,
          },
          cpu: typeof cpu === 'number' ? cpu : undefined,
          memoryGb,
          usageCpuPct: typeof cpuUsagePct === 'number' ? cpuUsagePct : undefined,
          usageMemPct: usageMemPct,
          caps: { 'provider.cloudmap.kvm': true },
        };
      } else if (provider === 'huaweicloud') {
        const ipArr = Array.isArray((r as any)?.addresses) ? (r as any)?.addresses : [];
        const pri = Array.isArray((r as any)?.privateIps) ? (r as any)?.privateIps : [];
        const ips = pri.length ? pri : ipArr;
        const flavor = (r as any)?.flavor || {};
        const cpu = typeof flavor?.vcpus === 'number' ? flavor.vcpus : undefined;
        const memRaw = typeof flavor?.ram === 'number' ? flavor.ram : undefined;
        const memoryGb = typeof memRaw === 'number' ? Math.round(memRaw / 1024) : undefined;
        const { id, name } = extractIdentity(provider, 'vm', r);
        return {
          id,
          name,
          provider,
          cloudId: cloud.id,
          region: cloud.region,
          status: r?.status,
          vpcId: (r as any)?.vpcId,
          zoneId: (r as any)?.az || (r as any)?.availability_zone,
          instanceType: (r as any)?.flavor?.id || (r as any)?.flavorId,
          privateIps: Array.isArray(ips) ? ips : [],
          createdAt: (r as any)?.created || (r as any)?.create_time,
          extra: {
            vpcName: ((r as any)?.vpcId && vpcInfoMap.get((r as any)?.vpcId)?.name) || undefined,
            vpcCidr: ((r as any)?.vpcId && vpcInfoMap.get((r as any)?.vpcId)?.cidr) || undefined,
          },
          cpu,
          memoryGb,
          caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true },
        };
      } else if (
        provider === 'harvester' ||
        provider === 'cloudmap.private' ||
        provider === 'cloudmap.edge'
      ) {
        const { id, name } = extractIdentity(provider, 'vm', r);
        const ns = id.includes('/') ? id.split('/')[0] : '';
        const pri = Array.isArray(r?.Extra?.IPs) ? r?.Extra?.IPs : [];
        const cpu = typeof (r?.Extra as any)?.CPU === 'number' ? (r?.Extra as any).CPU : undefined;
        const memStr = (r?.Extra as any)?.Memory as string | undefined;
        const memMatch = typeof memStr === 'string' ? memStr.match(/([0-9]+\.?[0-9]*)/i) : null;
        const memoryGb = memMatch ? Math.round(parseFloat(memMatch[1])) : undefined;
        const cpuUsagePct =
          typeof (r?.Extra as any)?.CpuUsagePct === 'number'
            ? (r?.Extra as any)?.CpuUsagePct
            : undefined;
        const memUsageStr: string | undefined = (r?.Extra as any)?.MemUsage;
        const memUsageMiMatch =
          typeof memUsageStr === 'string' ? memUsageStr.match(/([0-9]+\.?[0-9]*)\s*Mi/i) : null;
        const memUsageMi = memUsageMiMatch ? parseFloat(memUsageMiMatch[1]) : undefined;
        const usageMemPct =
          typeof memoryGb === 'number' && memoryGb > 0 && typeof memUsageMi === 'number'
            ? Math.min(100, Math.max(0, Math.round((memUsageMi / (memoryGb * 1024)) * 100)))
            : undefined;
        return {
          id,
          name,
          provider,
          cloudId: cloud.id,
          region: cloud.region,
          status: r?.Status || (r as any)?.status,
          vpcId: r?.VpcId || undefined,
          zoneId: undefined,
          instanceType: undefined,
          privateIps: Array.isArray(pri) ? pri : [],
          createdAt: r?.CreationTime || (r?.Extra as any)?.CreationTime || undefined,
          extra: {
            namespace: ns,
            subnetName: (r?.Extra as any)?.SubnetName,
            networks: (r?.Extra as any)?.Networks,
          },
          cpu,
          memoryGb,
          usageCpuPct: cpuUsagePct,
          usageMemPct: usageMemPct,
          caps: {
            'compute.instanceType': false,
            'compute.zone': false,
            'network.vpc': true,
            'network.fusion': true,
            'provider.harvester.multus': true,
          },
        };
      }
      return null;
    })();
    if (norm && norm.id) {
      items.push(norm);
    }
  }
  return items;
};

// 标准化获取 VPC 列表：
// - 目前仅对阿里云与华为云实现映射，其它 provider 视为不支持或返回空
const fetchVpcsForCloud = async (cloud: Cloud, raw: boolean = false) => {
  const providerRaw = String((cloud as any)?.config?.provider || '');
  const provider = providerRaw.toLowerCase();
  const supported = [
    'aliyun',
    'huaweicloud',
    'harvester',
    'cloudmap.private',
    'cloudmap.edge',
    'cloudmap.csm',
  ];

  if (!supported.includes(provider)) return raw ? { error: 'Unsupported provider' } : [];

  let list: any[] = [];

  if (provider === 'aliyun') {
    if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
      return raw ? { error: 'Missing credentials' } : [];
    try {
      const vpcResp: any = await callAliyunVpc({
        accessKeyId: cloud.accessKey,
        accessKeySecret: cloud.secretKey,
        regionId: cloud.region,
        action: 'DescribeVpcs',
        extraParams: { PageNumber: 1, PageSize: 100 },
      } as any);
      if (raw) return vpcResp;
      list = vpcResp?.Vpcs?.Vpc || vpcResp?.VpcSets?.VpcSet || [];
    } catch {}
  } else if (provider === 'huaweicloud') {
    const projectId = (cloud.config as any)?.projectId;
    if (!cloud.accessKey || !cloud.secretKey || !projectId)
      return raw ? { error: 'Missing credentials' } : [];
    try {
      const vpcResp: any = await huaweiListVpcs({
        ak: cloud.accessKey,
        sk: cloud.secretKey,
        region: cloud.region,
        projectId,
      });
      if (raw) return vpcResp;
      list = (vpcResp as any)?.vpcs || (vpcResp as any)?.vpcs?.vpcs || [];
    } catch {}
  } else if (
    provider === 'harvester' ||
    provider === 'cloudmap.private' ||
    provider === 'cloudmap.edge'
  ) {
    // For Harvester/Cloudmap, "VPC" might be mapped to "Namespace" conceptually, or it might not support VPCs.
    // Currently returning empty or mapping namespaces if desired.
    // For now, let's assume no explicit VPCs unless we query namespaces.
    if (raw) return [];
  }

  const items: any[] = [];
  for (const r of Array.isArray(list) ? list : []) {
    const { id, name } = extractIdentity(provider, 'vpc', r);
    const norm = (() => {
      if (provider === 'aliyun') {
        return {
          id,
          name,
          cidr: r?.CidrBlock,
          provider,
          cloudId: cloud.id,
          region: cloud.region,
          status: r?.Status,
          extra: { routerId: r?.VRouterId },
        };
      } else if (provider === 'huaweicloud') {
        return {
          id,
          name,
          cidr: r?.cidr || r?.CidrBlock,
          provider,
          cloudId: cloud.id,
          region: cloud.region,
          status: r?.status,
        };
      }
      return null;
    })();
    if (norm && norm.id) {
      items.push(norm);
    }
  }
  return items;
};

// 获取云资源列表：
// - 管理员可看到所有云资源
// - 租户用户(TenantUser)仅能看到与自己 UserSpace 关联的云资源，实现多租户隔离
router.get('/', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const cloudRepository = AppDataSource.getRepository(Cloud);
    let clouds = await cloudRepository.find();

    // 租户隔离：
    // - 当用户为租户用户（拥有 tenantId 且角色不是 sase_device）或角色为 'tenant' 时，
    //   仅返回其所属租户下处于 active 状态的 UserSpace 所关联的 Cloud。
    const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
    
    if (isTenantUser || (req.user as any)?.role === 'tenant') {
      const tenantId = (req.user as any).tenantId;
      // 只有在拿到有效 tenantId 的情况下才做过滤；如果角色为 'tenant' 却没有 tenantId，
      // 说明用户数据存在异常，此时不额外做隔离逻辑（以避免误过滤所有结果）。
      if (tenantId) {
        const userSpaceRepo = AppDataSource.getRepository(UserSpace);
        const userSpaces = await userSpaceRepo.find({
          where: { tenantId, status: 'active' },
        });
        const allowedCloudIds = userSpaces.map(us => us.cloudId);
        clouds = clouds.filter(c => allowedCloudIds.includes(c.id));
      }
    }

    res.json(clouds.map(redactCloud));
  } catch (error) {
    console.error('获取云资源列表失败:', error);
    res.status(500).json({ message: '获取云资源列表失败' });
  }
});

// 创建云资源
router.post(
  '/',
  createApiPermissionMiddleware(),
  validateCloudInput,
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, description, type, region, endpoint, accessKey, secretKey, config } = req.body;

      const cloudRepository = AppDataSource.getRepository(Cloud);

      // License Check
      const licStatus = licenseService.getStatus();
      const features = licStatus.payload?.features || [];
      const limits = licStatus.payload?.limits;
      // Check if multi-cloud feature is enabled
      const isMultiCloud = features.includes('platform.multi-cloud');
      // Default max accounts is 1 if not specified in license
      const maxAccounts = limits?.maxCloudAccounts || 1; 

      // 1. Check max accounts limit
      const currentCount = await cloudRepository.count();
      if (currentCount >= maxAccounts) {
        return res.status(403).json({ message: `已达到最大云资源连接数限制 (${maxAccounts})。请联系管理员升级授权。` });
      }

      // 2. 未启用多云时仅允许 CloudMap 类资源池（默认授权、导入授权但未含 platform.multi-cloud 均适用）
      const provider = String(config?.provider || '').toLowerCase();
      if (!isMultiCloud) {
        const allowedWithoutMultiCloud = ['cloudmap.private', 'cloudmap.edge', 'cloudmap.csm'];
        if (!allowedWithoutMultiCloud.includes(provider)) {
          return res.status(403).json({ message: '当前授权仅支持接入 CloudMap 类型的资源池。需接入多云资源请升级授权。' });
        }
      }

      // 检查名称是否已存在
      const existingCloud = await cloudRepository.findOne({
        where: { name },
      });

      if (existingCloud) {
        return res.status(400).json({ message: '云资源名称已存在' });
      }

      const test = await testCloudConnectionUnified({
        provider: config?.provider,
        accessKey,
        secretKey,
        region,
        endpoint,
        config,
      });
      const isConnected = !!test.ok;
      const connectionMessage = test.message || '';

      const cloud = cloudRepository.create({
        name,
        description,
        type,
        region,
        endpoint,
        accessKey,
        secretKey,
        config,
        status: isConnected ? CloudStatus.ONLINE : CloudStatus.OFFLINE,
        createdBy: req.user?.id,
      });

      await cloudRepository.save(cloud);

      // 返回结果时隐藏敏感信息
      const safeCloud = redactCloud(cloud);

      res.status(201).json({
        message: '云资源创建成功',
        cloud: safeCloud,
        connectionStatus: isConnected ? '连接成功' : connectionMessage || '连接失败，请检查配置',
      });
    } catch (error: any) {
      res.status(500).json({ message: '创建云资源失败', error: error.message });
    }
  },
);

// 预创建连接测试（不保存云资源）
router.post('/test-connection', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { provider, accessKey, secretKey, region, endpoint, config } = (req.body || {}) as any;
    const r = await testCloudConnectionUnified({
      provider,
      accessKey,
      secretKey,
      region,
      endpoint,
      config,
    });
    res.json({
      ok: !!r.ok,
      message: r.message || (r.ok ? '连接成功' : '连接失败'),
      ...(r.data ? { data: r.data } : {}),
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error?.message || '连接测试失败' });
  }
});

// 获取标准化查询指令
router.get('/:id/query-commands', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { types } = req.query; // e.g. types=vpc,vm or types[]=vpc&types[]=vm

    const typeList = Array.isArray(types)
      ? types
      : String(types || '')
          .split(',')
          .filter(Boolean);
    const result: any = { resourcePoolId: id };

    // 默认查询所有类型
    const queryAll = typeList.length === 0;

    if (queryAll || typeList.includes('vpc')) {
      try {
        result.vpcQuery = await standardResourceService.assembleVpcQuery(id);
      } catch (e: any) {
        result.vpcQuery = { error: e.message };
      }
    }

    if (queryAll || typeList.includes('vm')) {
      try {
        result.vmQuery = await standardResourceService.assembleVmQuery(id);
      } catch (e: any) {
        result.vmQuery = { error: e.message };
      }
    }

    res.json({ message: 'Success', data: result });
  } catch (error: any) {
    res.status(500).json({ message: '获取查询指令失败', error: error.message });
  }
});

// 获取指定云资源的 VPC 列表 (标准化接口)
router.get('/:id/resources/vpcs', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const cloud = await fetchCloudOr404(req.params.id, res);
    if (!cloud) return;
    const vpcs = await fetchVpcsForCloud(cloud);
    res.json(vpcs);
  } catch (error: any) {
    res.status(500).json({ message: '获取VPC列表失败', error: error.message });
  }
});

// 获取指定云资源的 ECS 实例列表 (标准化接口)
// 【迁移示例】使用新的权限体系中间件
router.get('/:id/resources/ecs', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const cloud = await fetchCloudOr404(req.params.id, res);
    if (!cloud) return;
    const instances = await fetchInstancesForCloud(cloud);
    res.json(instances);
  } catch (error: any) {
    res.status(500).json({ message: '获取实例列表失败', error: error.message });
  }
});

// 测试云资源连接
router.post('/:id/test', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const cloudRepository = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepository.findOne({ where: { id } });
    if (!cloud) return res.status(404).json({ message: '云资源不存在' });
    const r = await testCloudConnectionUnified({
      provider: cloud.config?.provider,
      accessKey: cloud.accessKey,
      secretKey: cloud.secretKey,
      region: cloud.region,
      endpoint: cloud.endpoint,
      config: cloud.config,
    });
    const ok = !!r.ok;
    cloud.status = ok ? CloudStatus.ONLINE : CloudStatus.OFFLINE;
    cloud.lastTestAt = new Date();
    await cloudRepository.save(cloud);
    res.json({
      message: ok ? '连接测试成功' : r.message || '连接测试失败',
      status: cloud.status,
      lastTestAt: cloud.lastTestAt,
    });
  } catch (error: any) {
    res.status(500).json({ message: '连接测试失败', error: error.message });
  }
});

// 手动同步云资源
router.post('/:id/sync', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const providerRaw = String(cloud.config?.provider || '');
    const provider = providerRaw.toLowerCase();

    if (
      provider === 'harvester' ||
      provider === 'cloudmap.private' ||
      provider === 'cloudmap.edge'
    ) {
      const insecure = !!(cloud.config as any)?.ignoreTls;
      // 同步 VM 和 VMI
      await syncKubevirtVms(cloud, insecure);
      await syncKubevirtVmis(cloud, insecure);
      
      res.json({ message: '同步成功' });
    } else {
      // 对于其他云厂商，触发 Inventory 刷新逻辑 (复用 inventory 接口的部分逻辑)
      // 目前主要响应 Harvester 的需求，其他云直接返回成功即可
      res.json({ message: '该云类型已触发后台同步' });
    }
  } catch (error: any) {
    cloudRouteLog.error(`Sync cloud ${req.params.id} failed:`, error?.message ?? String(error));
    res.status(500).json({ message: '同步失败', error: error.message });
  }
});

// 更新云资源
router.put('/:id', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const cloudRepository = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepository.findOne({ where: { id } });

    if (!cloud) {
      return res.status(404).json({ message: '云资源不存在' });
    }

    // 如果更新了连接配置，重新测试连接
    const needsConnectionTest = updateData.endpoint || updateData.accessKey || updateData.secretKey;

    Object.assign(cloud, updateData);
    cloud.updatedAt = new Date();

    const cfgProv = String((cloud as any).config?.provider || '').toLowerCase();
    const hasCluster = !!String((cloud as any).config?.clusterId || '').trim();
    if (
      cfgProv === 'rancher' &&
      !hasCluster &&
      updateData &&
      Object.prototype.hasOwnProperty.call(updateData, 'config')
    ) {
      return res.status(400).json({
        message: 'Rancher 资源池必须在 config 中配置 clusterId（一池对应一个下游集群）',
      });
    }

    if (needsConnectionTest) {
      const r = await testCloudConnectionUnified({
        provider: cloud.config?.provider,
        accessKey: cloud.accessKey,
        secretKey: cloud.secretKey,
        region: cloud.region,
        endpoint: cloud.endpoint,
        config: cloud.config,
      });
      cloud.status = r.ok ? CloudStatus.ONLINE : CloudStatus.OFFLINE;
      cloud.lastTestAt = new Date();
    }

    await cloudRepository.save(cloud);

    const safeCloud = redactCloud(cloud);

    res.json({ message: '云资源更新成功', cloud: safeCloud });
  } catch (error: any) {
    res.status(500).json({ message: '更新云资源失败', error: error.message });
  }
});

// 删除云资源
router.delete('/:id', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const cloudRepository = AppDataSource.getRepository(Cloud);
    const userSpaceRepository = AppDataSource.getRepository(UserSpace);

    const cloud = await cloudRepository.findOne({
      where: { id },
    });

    if (!cloud) {
      return res.status(404).json({ message: '云资源不存在' });
    }

    // 检查是否有资源池分配（UserSpace check）
    const assignments = await userSpaceRepository.find({
      where: { cloudId: id },
    });

    if (assignments.length > 0) {
      return res.status(400).json({
        message: `无法删除云资源池，已分配给 ${assignments.length} 个组织，请先移除相关分配`,
      });
    }

    await cloudRepository.remove(cloud);

    res.json({ message: '云资源删除成功' });
  } catch (error: any) {
    res.status(500).json({ message: '删除云资源失败', error: error.message });
  }
});

export { router as cloudRoutes };
// 聚合：查询全部资源池的云主机列表（统一实例模型）
router.get('/resources/ecs-all', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const clouds = await cloudRepository.find();

    const items: any[] = [];
    for (const cloud of clouds) {
      try {
        const instances = await fetchInstancesForCloud(cloud);
        items.push(...instances);
      } catch (e) {
        cloudRouteLog.warn(
          `Failed to fetch instances for cloud ${cloud.name}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    res.json({ message: '查询成功', data: items });
  } catch (error: any) {
    res.status(500).json({ message: '查询全部云主机失败', error: error.message });
  }
});

// 库存：查询已入库的云主机（必要时刷新）
router.get(
  '/inventory/instances',
  createApiPermissionMiddleware(),
  async (req: AuthRequest, res: Response) => {
    try {
      const invRepo = AppDataSource.getRepository(CloudInstanceInventory);
      const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
      const vmiRepo = AppDataSource.getRepository(HarvesterVmiInventory);
      const cloudRepository = AppDataSource.getRepository(Cloud);
      const cloudsAll = await cloudRepository.find();
      const existingCloudIds = (Array.isArray(cloudsAll) ? cloudsAll : []).map((c) => c.id);
      if (existingCloudIds.length > 0) {
        await invRepo
          .createQueryBuilder()
          .delete()
          .from(CloudInstanceInventory)
          .where('cloudId NOT IN (:...ids)', { ids: existingCloudIds })
          .execute();
        await vmRepo
          .createQueryBuilder()
          .delete()
          .from(HarvesterVmInventory)
          .where('cloudId NOT IN (:...ids)', { ids: existingCloudIds })
          .execute();
        await vmiRepo
          .createQueryBuilder()
          .delete()
          .from(HarvesterVmiInventory)
          .where('cloudId NOT IN (:...ids)', { ids: existingCloudIds })
          .execute();
      } else {
        await invRepo.createQueryBuilder().delete().from(CloudInstanceInventory).execute();
        await vmRepo.createQueryBuilder().delete().from(HarvesterVmInventory).execute();
        await vmiRepo.createQueryBuilder().delete().from(HarvesterVmiInventory).execute();
      }
      let inv = await invRepo.find();
      let vmInv = await vmRepo.find();
      let vmiInv = await vmiRepo.find();
      const targetCloudId =
        typeof (req.query as any)?.cloudId === 'string'
          ? String((req.query as any).cloudId)
          : undefined;
      const hasTarget = targetCloudId
        ? inv.some((x) => x.cloudId === targetCloudId) || vmInv.some((x) => x.cloudId === targetCloudId)
        : inv.length > 0 || vmInv.length > 0;
      const needRefresh = !hasTarget || String(req.query.refresh || '').toLowerCase() === 'true';
      const slow = String((req.query as any)?.slow || '').toLowerCase() === 'true';
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      if (needRefresh) {
        const clouds = await cloudRepository.find();
        const supported = [
          'aliyun',
          'huaweicloud',
          'tencentcloud',
          'harvester',
          'cloudmap.private',
          'cloudmap.edge',
          'cloudmap.csm',
        ];
        for (const cloud of clouds) {
          if (slow) {
            await sleep(1200);
          }
          if (targetCloudId && cloud.id !== targetCloudId) continue;
          const providerRaw = String((cloud as any)?.config?.provider || '');
          const provider = providerRaw.toLowerCase();
          cloudDebugLog.debug(`Inventory sync: processing cloud ${cloud.name} (${providerRaw})`);
          if (!supported.includes(provider)) continue;
          let list: any[] = [];
          const vpcInfoMap = new Map<string, { name?: string; cidr?: string }>();
          const vswInfoMap = new Map<string, { name?: string; cidr?: string; vpcId?: string }>();
          if (provider === 'aliyun') {
            if (!cloud.accessKey || !cloud.secretKey || !cloud.region) continue;
            const resp: any = await callAliyunEcs({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeInstances',
              extraParams: { PageNumber: 1, PageSize: 100 },
            } as any);
            list = resp?.Instances?.Instance || [];
            try {
              const vpcResp: any = await callAliyunVpc({
                accessKeyId: cloud.accessKey,
                accessKeySecret: cloud.secretKey,
                regionId: cloud.region,
                action: 'DescribeVpcs',
                extraParams: { PageNumber: 1, PageSize: 100 },
              } as any);
              const vpcs: any[] = vpcResp?.Vpcs?.Vpc || vpcResp?.VpcSets?.VpcSet || [];
              for (const v of Array.isArray(vpcs) ? vpcs : []) {
                if (v?.VpcId) vpcInfoMap.set(v.VpcId, { name: v?.VpcName, cidr: v?.CidrBlock });
              }
              const vswResp: any = await callAliyunVpc({
                accessKeyId: cloud.accessKey,
                accessKeySecret: cloud.secretKey,
                regionId: cloud.region,
                action: 'DescribeVSwitches',
                extraParams: { PageNumber: 1, PageSize: 100 },
              } as any);
              const vsws: any[] = vswResp?.VSwitches?.VSwitch || [];
              for (const s of Array.isArray(vsws) ? vsws : []) {
                if (s?.VSwitchId)
                  vswInfoMap.set(s.VSwitchId, {
                    name: s?.VSwitchName,
                    cidr: s?.CidrBlock,
                    vpcId: s?.VpcId,
                  });
              }
            } catch {}
          } else if (provider === 'huaweicloud') {
            const projectId = (cloud.config as any)?.projectId;
            if (!cloud.accessKey || !cloud.secretKey || !projectId) continue;
            const resp: any = await huaweiListServers({
              ak: cloud.accessKey,
              sk: cloud.secretKey,
              region: cloud.region,
              projectId,
            });
            list = resp?.servers || [];
            try {
              const vpcsResp: any = await huaweiListVpcs({
                ak: cloud.accessKey,
                sk: cloud.secretKey,
                region: cloud.region,
                projectId,
              });
              const vpcs: any[] = vpcsResp?.vpcs || vpcsResp?.data?.vpcs || [];
              for (const v of Array.isArray(vpcs) ? vpcs : []) {
                const vid = v?.id || v?.vpcId || v?.VpcId;
                const name = v?.name || v?.vpcName || v?.VpcName;
                const cidr = v?.cidr || v?.cidr_block || v?.CidrBlock;
                if (vid) vpcInfoMap.set(String(vid), { name, cidr });
              }
            } catch {}
          } else if (
            provider === 'harvester' ||
            provider === 'cloudmap.private' ||
            provider === 'cloudmap.edge'
          ) {
            // New sync logic using dedicated entities
            const insecure = !!(cloud.config as any)?.ignoreTls;
            try {
              await syncKubevirtVms(cloud, insecure);
              await syncKubevirtVmis(cloud, insecure);
            } catch (err) {
              cloudRouteLog.error(
                `Error syncing Kubevirt VMs/VMIs for cloud ${cloud.name}:`,
                err instanceof Error ? err.message : String(err),
              );
            }
            // Cleanup old inventory for this cloud (deprecated tables)
            await invRepo.delete({ cloudId: cloud.id });
            continue;
          } else if (provider === 'cloudmap.csm') {
            const endpointRaw = String(cloud.endpoint || '').trim();
            const ak = String(cloud.accessKey || '').trim();
            const sk = String(cloud.secretKey || '').trim();
            if (!ak || !sk) {
              list = [];
            } else {
              const ignoreTls = !!(cloud as any)?.config?.ignoreTls;
              cloudDebugLog.debug(`Inventory sync: calling listCsmVms for ${cloud.name}`);
              list = await listCsmVms({
                endpoint: endpointRaw,
                accessKey: ak,
                secretKey: sk,
                ignoreTls,
              });
            }
          }
          
          const seenIds = new Set<string>();
          for (const r of Array.isArray(list) ? list : []) {
            const base = {
              cloudId: cloud.id,
              provider,
              region: cloud.region,
            } as Partial<CloudInstanceInventory>;
            let record: Partial<CloudInstanceInventory> | null = null;
            if (provider === 'aliyun') {
              const pri: any[] = r?.VpcAttributes?.PrivateIpAddress?.IpAddress || [];
              const cpu = (r as any)?.Cpu;
              const memRaw = (r as any)?.Memory;
              const memoryGb =
                typeof memRaw === 'number'
                  ? memRaw > 256
                    ? Math.round(memRaw / 1024)
                    : memRaw
                  : undefined;
              const vswId = r?.VpcAttributes?.VSwitchId || r?.VSwitchId;
              if (vswId && !vswInfoMap.has(vswId)) {
                try {
                  const one: any = await callAliyunVpc({
                    accessKeyId: cloud.accessKey,
                    accessKeySecret: cloud.secretKey,
                    regionId: cloud.region,
                    action: 'DescribeVSwitches',
                    extraParams: { VSwitchId: vswId },
                  } as any);
                  const arr: any[] = one?.VSwitches?.VSwitch || [];
                  const item = Array.isArray(arr) ? arr[0] : undefined;
                  if (item?.VSwitchId)
                    vswInfoMap.set(item.VSwitchId, {
                      name: item?.VSwitchName,
                      cidr: item?.CidrBlock,
                      vpcId: item?.VpcId,
                    });
                } catch {}
              }
              const vpcIdAli =
                r?.VpcId ||
                r?.VpcAttributes?.VpcId ||
                (vswId ? vswInfoMap.get(vswId)?.vpcId : undefined);
              if (vpcIdAli && !vpcInfoMap.has(vpcIdAli)) {
                try {
                  const one: any = await callAliyunVpc({
                    accessKeyId: cloud.accessKey,
                    accessKeySecret: cloud.secretKey,
                    regionId: cloud.region,
                    action: 'DescribeVpcs',
                    extraParams: { VpcId: vpcIdAli },
                  } as any);
                  const arr: any[] = one?.Vpcs?.Vpc || one?.VpcSets?.VpcSet || [];
                  const item = Array.isArray(arr) ? arr[0] : undefined;
                  if (item?.VpcId)
                    vpcInfoMap.set(item.VpcId, { name: item?.VpcName, cidr: item?.CidrBlock });
                } catch {}
              }
              if (vpcIdAli) {
                const cached = vpcInfoMap.get(vpcIdAli);
                if (!cached?.name || cached.name === vpcIdAli) {
                  try {
                    const attr: any = await callAliyunVpc({
                      accessKeyId: cloud.accessKey,
                      accessKeySecret: cloud.secretKey,
                      regionId: cloud.region,
                      action: 'DescribeVpcAttribute',
                      extraParams: { VpcId: vpcIdAli },
                    } as any);
                    const name2 = attr?.VpcName || attr?.Vpc?.VpcName;
                    const cidr2 = attr?.CidrBlock || attr?.Vpc?.CidrBlock;
                    vpcInfoMap.set(vpcIdAli, {
                      name: name2 || cached?.name,
                      cidr: cidr2 || cached?.cidr,
                    });
                  } catch {}
                }
              }
              record = {
                ...base,
                instanceId: r?.InstanceId,
                instanceName: r?.InstanceName || r?.HostName || r?.InstanceId,
                status: r?.Status,
                zoneId: r?.ZoneId,
                instanceType: r?.InstanceType,
                privateIps: JSON.stringify(Array.isArray(pri) ? pri : []),
                cpu: typeof cpu === 'number' ? cpu : undefined,
                memoryGb,
                vpcId: vpcIdAli,
                vpcName: (vpcIdAli && vpcInfoMap.get(vpcIdAli)?.name) || vpcIdAli,
                vpcCidr:
                  (vpcIdAli && vpcInfoMap.get(vpcIdAli)?.cidr) || r?.VpcAttributes?.CidrBlock,
                subnetId: vswId,
                subnetName: (vswId && vswInfoMap.get(vswId)?.name) || undefined,
                subnetCidr: (vswId && vswInfoMap.get(vswId)?.cidr) || undefined,
                instanceCreatedAt: r?.CreationTime,
              };
            } else if (provider === 'huaweicloud') {
              const addrsRaw = (r as any)?.addresses;
              const addrItems: any[] = Array.isArray(addrsRaw)
                ? addrsRaw
                : Object.values(addrsRaw || {}).reduce(
                    (acc: any[], v: any) => acc.concat(Array.isArray(v) ? v : [v]),
                    [],
                  );
              const floats: string[] = (addrItems || [])
                .filter(
                  (a: any) =>
                    String((a && (a['OS-EXT-IPS:type'] || a.type)) || '').toLowerCase() ===
                    'floating',
                )
                .map((a: any) => a?.addr || a?.ipAddress || a?.ip)
                .filter((s: any) => typeof s === 'string');
              let fixedIps: string[] = (addrItems || [])
                .filter((a: any) => {
                  const t = String((a && (a['OS-EXT-IPS:type'] || a.type)) || '').toLowerCase();
                  return t === 'fixed' || t === '' || t !== 'floating';
                })
                .map((a: any) => a?.addr || a?.ipAddress || a?.ip)
                .filter((s: any) => typeof s === 'string');
              if (!fixedIps.length) {
                const fallback =
                  (r as any)?.accessIPv4 || (r as any)?.privateIpAddress || (r as any)?.privateip;
                fixedIps = typeof fallback === 'string' && fallback ? [fallback] : [];
              }
              const flavor = (r as any)?.flavor || {};
              const cpu = typeof flavor?.vcpus === 'number' ? flavor.vcpus : undefined;
              const memRaw = typeof flavor?.ram === 'number' ? flavor.ram : undefined;
              const memoryGb = typeof memRaw === 'number' ? Math.round(memRaw / 1024) : undefined;
              const networkNames: string[] =
                addrsRaw && !Array.isArray(addrsRaw) ? Object.keys(addrsRaw) : [];
              record = {
                ...base,
                instanceId: r?.id,
                instanceName: r?.name || r?.id,
                status: r?.status,
                zoneId: (r as any)?.az || (r as any)?.availability_zone,
                instanceType: (r as any)?.flavor?.id || (r as any)?.flavorId,
                privateIps: JSON.stringify(Array.isArray(fixedIps) ? fixedIps : []),
                cpu,
                memoryGb,
                vpcId: (r as any)?.vpcId,
                networks: JSON.stringify(networkNames),
                instanceCreatedAt: (r as any)?.created || (r as any)?.create_time,
              };
            } else if (provider === 'tencentcloud') {
              const ips: any[] = r?.PrivateIpAddresses || [];
              const cpu = (r as any)?.CPU;
              const memRaw = (r as any)?.Memory;
              const memoryGb = typeof memRaw === 'number' ? memRaw : undefined;
              record = {
                ...base,
                instanceId: r?.InstanceId,
                instanceName: r?.InstanceName || r?.InstanceId,
                status: r?.InstanceState || r?.State || r?.Status,
                zoneId: r?.Zone || (r?.Placement && r?.Placement?.Zone),
                instanceType: r?.InstanceType,
                privateIps: JSON.stringify(Array.isArray(ips) ? ips : []),
                cpu: typeof cpu === 'number' ? cpu : undefined,
                memoryGb,
                vpcId: r?.VpcId,
              };
            } else if (
              provider === 'harvester' ||
              provider === 'cloudmap' ||
              provider === 'cloudmap.private' ||
              provider === 'cloudmap.edge'
            ) {
              const id: string = r?.InstanceId || '';
              const pri =
                r?.VpcAttributes?.PrivateIpAddress?.IpAddress ||
                (Array.isArray(r?.Extra?.IPs) ? r?.Extra?.IPs : []);
              const cpu =
                typeof (r?.Extra as any)?.CPU === 'number' ? (r?.Extra as any).CPU : undefined;
              const memStr = (r?.Extra as any)?.Memory as string | undefined;
              const memMatch =
                typeof memStr === 'string' ? memStr.match(/([0-9]+\.?[0-9]*)/i) : null;
              const memoryGb = memMatch ? Math.round(parseFloat(memMatch[1])) : undefined;
              record = {
                ...base,
                instanceId: id,
                instanceName: r?.InstanceName || (id.includes('/') ? id.split('/').pop() : id),
                status: r?.Status || (r as any)?.status,
                privateIps: JSON.stringify(Array.isArray(pri) ? pri : []),
                cpu,
                memoryGb,
                vpcId: (r as any)?.VpcId,
                vpcName: (r as any)?.VpcName,
                subnetId: (r?.Extra as any)?.SubnetId,
                subnetName: (r?.Extra as any)?.SubnetName,
                networks: JSON.stringify(
                  Array.isArray((r?.Extra as any)?.Networks) ? (r?.Extra as any)?.Networks : [],
                ),
                instanceCreatedAt: r?.CreationTime || (r?.Extra as any)?.CreationTime || undefined,
                extra: r?.Extra,
              };
            } else if (provider === 'cloudmap.csm') {
              const id: string =
                (r as any)?.InstanceId ||
                (r as any)?.id ||
                (r as any)?.Id ||
                (r as any)?.uuid ||
                '';
              const name: string =
                (r as any)?.InstanceName ||
                (r as any)?.HostName ||
                (r as any)?.name ||
                (r as any)?.Name ||
                id;
              const priArr = Array.isArray((r as any)?.IPs)
                ? (r as any)?.IPs
                : Array.isArray((r as any)?.Extra?.IPs)
                  ? (r as any)?.Extra?.IPs
                  : [];
              const cpuRaw = (r as any)?.CPU ?? (r as any)?.Extra?.CPU;
              const cpu = typeof cpuRaw === 'number' ? cpuRaw : undefined;
              const memRaw = (r as any)?.Memory ?? (r as any)?.Extra?.Memory;
              const memMatch =
                typeof memRaw === 'string' ? String(memRaw).match(/([0-9]+\.?[0-9]*)/i) : null;
              const memoryGb = memMatch
                ? Math.round(parseFloat(memMatch[1]))
                : typeof memRaw === 'number'
                  ? memRaw
                  : undefined;
              record = {
                ...base,
                instanceId: id,
                instanceName: name,
                status: (r as any)?.Status || (r as any)?.status || (r as any)?.PowerStatus,
                privateIps: JSON.stringify(Array.isArray(priArr) ? priArr : []),
                cpu,
                memoryGb,
                networks: JSON.stringify(
                  Array.isArray((r as any)?.Networks)
                    ? (r as any)?.Networks
                    : Array.isArray((r?.Extra as any)?.Networks)
                      ? (r?.Extra as any)?.Networks
                      : [],
                ),
                instanceCreatedAt:
                  (r as any)?.CreationTime ||
                  (r as any)?.CreatedAt ||
                  (r as any)?.createTime ||
                  (r?.Extra as any)?.CreationTime ||
                  undefined,
                extra: (r as any)?.Extra,
              };
            }
            if (!record || !record.instanceId) continue;
            if (typeof record.instanceId === 'string' && record.instanceId) {
              seenIds.add(record.instanceId);
            }
            const existing = await invRepo.findOne({
              where: { instanceId: record.instanceId, cloudId: cloud.id },
            });
            if (existing) {
              Object.assign(existing, record);
              await invRepo.save(existing);
            } else {
              const created = invRepo.create(record as CloudInstanceInventory);
              await invRepo.save(created);
            }
          }
          if (seenIds.size > 0) {
            await invRepo
              .createQueryBuilder()
              .delete()
              .from(CloudInstanceInventory)
              .where('cloudId = :cloudId AND instanceId NOT IN (:...ids)', {
                cloudId: cloud.id,
                ids: Array.from(seenIds),
              })
              .execute();
          } else {
            await invRepo
              .createQueryBuilder()
              .delete()
              .from(CloudInstanceInventory)
              .where('cloudId = :cloudId', { cloudId: cloud.id })
              .execute();
          }
        }
        inv = await invRepo.find();
      }
      
      const cloudMap = new Map(cloudsAll.map(c => [c.id, c]));

      const dataInv = (
        targetCloudId ? (inv || []).filter((i) => i.cloudId === targetCloudId) : inv || []
      ).map((i) => ({
        id: i.instanceId,
        name: i.instanceName || i.instanceId,
        provider: i.provider,
        cloudId: i.cloudId,
        region: i.region,
        status: i.status,
        zoneId: i.zoneId,
        instanceType: i.instanceType,
        privateIps: (() => {
          try {
            return JSON.parse(i.privateIps || '[]');
          } catch {
            return [];
          }
        })(),
        createdAt: i.instanceCreatedAt || undefined,
        updatedAt: i.updatedAt,
        extra: {
          vpcId: i.vpcId,
          vpcName: i.vpcName,
          vpcCidr: i.vpcCidr,
          subnetId: i.subnetId,
          subnetName: i.subnetName,
          subnetCidr: i.subnetCidr,
          Interfaces: i.extra?.Interfaces,
          networks: (() => {
            try {
              return JSON.parse(i.networks || '[]');
            } catch {
              return [];
            }
          })(),
        },
        cpu: i.cpu,
        memoryGb: i.memoryGb,
        caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true },
      }));

      const vms = await vmRepo.find();
      const vmis = await vmiRepo.find();
      const vmiByName = new Map<string, HarvesterVmiInventory>();
      vmis.forEach(v => vmiByName.set(`${v.cloudId}/${v.namespace}/${v.name}`, v));

      const dataKv = (
        targetCloudId ? vms.filter((i) => i.cloudId === targetCloudId) : vms
      ).map((i) => {
          const c = cloudMap.get(i.cloudId);
          const provider = (c?.config as any)?.provider || 'harvester';
          const vmi = vmiByName.get(`${i.cloudId}/${i.namespace}/${i.name}`);
          
          // Determine Status
          let status = 'Unknown';
          if (vmi) {
             status = vmi.phase || 'Unknown';
             if (String(status).toLowerCase() === 'running') status = 'Running';
          } else {
             // If no VMI, check if it's supposed to be running
             if (i.running) status = 'Starting'; 
             else status = 'Stopped';
             
             if (i.runStrategy === 'Halted') status = 'Stopped';
             if (i.runStrategy === 'Always') status = 'Starting'; // If VMI missing
             if (i.runStrategy === 'RerunOnFailure') status = 'Starting';
          }
          
          // Memory extraction from template
          let memGb: number | undefined = undefined;
          try {
             const dom = i.template?.spec?.domain;
             const mem = dom?.resources?.requests?.memory || dom?.resources?.limits?.memory;
             if (mem) {
                 const m = String(mem).trim();
                 if (m.endsWith('Gi')) memGb = parseFloat(m);
                 else if (m.endsWith('Mi')) memGb = parseFloat(m) / 1024;
                 else if (m.endsWith('Ki')) memGb = parseFloat(m) / (1024 * 1024);
                 else if (!isNaN(parseFloat(m))) memGb = parseFloat(m) / (1024*1024*1024);
             }
          } catch {}
          
          if (memGb !== undefined) {
            memGb = Math.round(memGb * 100) / 100;
          }
          
          // CPU extraction
          let cpuCores: number | undefined = undefined;
          try {
             const dom = i.template?.spec?.domain;
             cpuCores = dom?.cpu?.cores;
          } catch {}

          return {
            id: i.uid,
            name: i.name,
            view: i.view,
            links: { view: i.view },
            provider,
            cloudId: i.cloudId,
            region: c?.region,
            status: status,
            zoneId: vmi?.nodeName || '',
            instanceType: 'Custom',
            privateIps: vmi?.ipAddresses || [],
            createdAt: i.creationTimestamp,
            updatedAt: i.updatedAt,
            extra: {
                namespace: i.namespace,
                nodeName: vmi?.nodeName,
                networks: vmi?.interfaces || [], 
                Interfaces: vmi?.interfaces,
                labels: i.labels,
                annotations: i.annotations,
            },
            cpu: cpuCores,
            memoryGb: memGb,
            caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true },
          };
      });

      res.json({ message: '查询成功', data: [...dataInv, ...dataKv] });
    } catch (error: any) {
      res.status(500).json({ message: '库存查询失败', error: error.message });
    }
  },
);

router.post(
  '/:id/reveal',
  createApiPermissionMiddleware(),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({ message: '请输入管理员密码' });
      }

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: '未登录' });
      }

      let userPasswordHash = user.password;
      if (!userPasswordHash) {
        const userRepo = AppDataSource.getRepository(User);
        const fullUser = await userRepo.findOne({
          where: { id: user.id },
          select: ['password'],
        });
        if (fullUser) {
          userPasswordHash = fullUser.password;
        }
      }

      if (!userPasswordHash) {
        return res.status(500).json({ message: '无法获取用户信息' });
      }

      const isMatch = await bcrypt.compare(password, userPasswordHash);
      if (!isMatch) {
        return res.status(403).json({ message: '密码错误' });
      }

      const cloudRepo = AppDataSource.getRepository(Cloud);
      const cloud = await cloudRepo.findOne({ where: { id } });

      if (!cloud) {
        return res.status(404).json({ message: '云资源不存在' });
      }

      res.json({
        accessKey: cloud.accessKey,
        secretKey: cloud.secretKey,
      });
    } catch (error: any) {
      cloudRouteLog.error('Reveal credentials error:', error?.message ?? String(error));
      res.status(500).json({ message: '获取凭证失败', error: error.message });
    }
  },
);

attachDatacenterTopologyRoutes(router);

// Rancher：列出下游集群（Norman /v3/clusters），供资源池列表展开区懒加载
router.get(
  '/:id/rancher/clusters',
  createApiPermissionMiddleware(),
  async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchCloudOr404(req.params.id, res);
      if (!cloud) return;
      const provider = String(cloud.config?.provider || '').toLowerCase();
      if (provider !== 'rancher') {
        res.status(400).json({ message: '仅 Rancher 资源池支持该接口' });
        return;
      }
      let base = String(
        (cloud as any).endpoint || (cloud as any).config?.rancherUrl || '',
      )
        .trim()
        .replace(/\/+$/, '');
      if (base && !/^https?:\/\//i.test(base)) {
        base = `https://${base}`;
      }
      const token = String(
        cloud.secretKey ||
          (cloud as any).config?.apiToken ||
          (cloud as any).config?.token ||
          '',
      ).trim();
      const insecure = !!(cloud.config as any)?.ignoreTls;
      if (!base || !token) {
        res.status(400).json({ message: '缺少 Rancher 地址或 API 令牌' });
        return;
      }
      const u = new URL(base);
      const isHttps = u.protocol === 'https:';
      const agent = isHttps
        ? new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure })
        : undefined;
      const listUrl = `${u.origin}/v3/clusters?limit=1000`;
      const axiosRes = await axios.get(listUrl, {
        headers: { Authorization: `Bearer ${token}` },
        ...(isHttps && agent ? { httpsAgent: agent } : {}),
        timeout: 30000,
        validateStatus: () => true,
      });
      if (axiosRes.status === 401) {
        res.status(502).json({ message: 'Rancher 认证失败：令牌无效或已过期' });
        return;
      }
      if (axiosRes.status !== 200) {
        res.status(502).json({
          message: `拉取 Rancher 集群失败: HTTP ${axiosRes.status}`,
        });
        return;
      }
      const body = axiosRes.data;
      const items: any[] = Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body?.items)
          ? body.items
          : [];
      const clusters = items.map((c) => {
        const cid = String(c?.id || c?.Id || '').trim();
        const name =
          String(c?.name || c?.Name || cid || '').trim() || cid || '—';
        const state = String(c?.state || c?.State || '').trim() || 'unknown';
        const k8s =
          c?.version?.gitVersion ||
          c?.kubernetesVersion ||
          c?.appliedSpec?.rancherKubernetesEngineConfig?.kubernetesVersion ||
          '';
        return {
          id: cid,
          name,
          state,
          kubernetesVersion: String(k8s || '').trim() || undefined,
        };
      });
      res.json({ data: clusters });
    } catch (error: any) {
      cloudRouteLog.error('Rancher clusters list failed', error?.message ?? String(error));
      res.status(500).json({
        message:
          error?.response?.data?.message ||
          error?.message ||
          '获取 Rancher 集群列表失败',
      });
    }
  },
);

// 获取单个云资源详情
router.get('/:id', createApiPermissionMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const cloud = await fetchCloudOr404(req.params.id, res);
    if (!cloud) return;
    res.json(redactCloud(cloud));
  } catch (error: any) {
    res.status(500).json({ message: '获取云资源详情失败', error: error.message });
  }
});
