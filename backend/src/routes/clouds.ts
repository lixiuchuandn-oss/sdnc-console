import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud, CloudType, CloudStatus } from '../entities/Cloud';
import { CloudInstanceInventory } from '../entities/CloudInstanceInventory';
import { ResourcePoolAssignment } from '../entities/ResourcePoolAssignment';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../entities/User';

const router = Router();

const redactCloud = (cloud: any) => ({
  ...cloud,
  status: typeof cloud.status === 'string' ? cloud.status.toLowerCase() : cloud.status,
  type: typeof cloud.type === 'string' ? cloud.type.toLowerCase() : cloud.type,
  accessKey: cloud.accessKey ? '***' + String(cloud.accessKey).slice(-4) : undefined,
  secretKey: cloud.secretKey ? '***' + String(cloud.secretKey).slice(-4) : undefined,
});

const testCloudConnectionUnified = async (args: { provider?: string; accessKey?: string; secretKey?: string; region?: string; endpoint?: string; config?: any }) => {
  const provider = String(args.provider || args.config?.provider || '').toLowerCase();
  if (provider === 'aliyun') {
    const t = await testAliyunConnection({ accessKeyId: args.accessKey || '', accessKeySecret: args.secretKey || '', regionId: args.region || '', action: 'DescribeVpcs' });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'huaweicloud') {
    const projectId = args.config?.projectId;
    if (!args.accessKey || !args.secretKey || !projectId) return { ok: false, message: '缺少华为云访问密钥或项目ID（projectId）' };
    const t = await testHuaweiConnection({ ak: args.accessKey, sk: args.secretKey, region: args.region || '', projectId });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'tencentcloud') {
    const t = await testTencentConnection({ secretId: args.accessKey || '', secretKey: args.secretKey || '', region: args.region || '' });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'harvester' || provider === 'cloudmap' || provider.startsWith('cloudmap')) {
    const t = await testHarvesterConnection({ endpoint: args.endpoint || '', token: args.secretKey || '', insecure: !!args.config?.ignoreTls });
    return { ok: !!t.ok, message: t.message || '' };
  }
  return { ok: false, message: '暂不支持该云接入' };
};

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) { res.status(404).json({ message: '云资源不存在' }); return null; }
  return cloud;
};

const ensureProvider = (cloud: any, provider: string, res: Response, msg: string) => {
  if (String(cloud?.config?.provider || '').toLowerCase() !== String(provider).toLowerCase()) {
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

// 输入验证中间件
const validateCloudInput = (req: AuthRequest, res: Response, next: any) => {
  const { name, type, region, endpoint } = req.body;
  
  if (!name || !type || !region || !endpoint) {
    return res.status(400).json({ 
      message: '缺少必填字段：name, type, region, endpoint' 
    });
  }
  
  if (!Object.values(CloudType).includes(type)) {
    return res.status(400).json({ 
      message: '无效的云服务类型' 
    });
  }
  
  next();
};

// 权限检查中间件：参照租户专线的权限原子逻辑，按读写与资源粒度判定
const checkAdminPermission = (req: AuthRequest, res: Response, next: any) => {
  try {
    const role: any = (req.user as any)?.role;
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any)?.permissions : [];
    if (role === UserRole.SUPER_ADMIN) return next();

    const method = String(req.method || 'GET').toUpperCase();
    const isRead = method === 'GET' || method === 'HEAD';
    const isWrite = !isRead; // POST/PUT/PATCH/DELETE

    const path = String((req.baseUrl || '') + (req.path || '')).toLowerCase();
    const actionBase = (() => {
      if (path.includes('/resources/ecs') || path.includes('/inventory/instances') || path.includes('/resources/ecs-all')) return 'clouds.instances';
      if (path.includes('/resources/vpcs')) return 'clouds.vpcs';
      if (path.includes('/resources/vswitches') || path.includes('/resources/subnets')) return 'clouds.vswitches';
      if (path.includes('/resources/security-groups')) return 'clouds.security-groups';
      if (path.includes('/resources/enis')) return 'clouds.enis';
      if (path.includes('/resources/network-acls')) return 'clouds.network-acls';
      if (path.includes('/resources/eips')) return 'clouds.eips';
      if (path.includes('/resources/loadbalancers')) return 'clouds.load-balancers';
      if (path.includes('/resources/nat-gateways')) return 'clouds.nat-gateways';
      if (path.includes('/resources/route-tables')) return 'clouds.route-tables';
      if (path.includes('/resources/route-entries')) return 'clouds.route-entries';
      if (path.includes('/resources/disks')) return 'clouds.disks';
      if (path.includes('/resources/snapshots')) return 'clouds.snapshots';
      return 'clouds';
    })();

    const need = isRead ? [`${actionBase}:read`, 'clouds:read'] : [`${actionBase}:write`, 'clouds:write'];
    const ok = need.some(a => perms.includes(a));
    if (!ok) {
      const required = need[0];
      return res.status(403).json({ message: `权限不足：需要 ${required}` });
    }
    (perms.includes('clouds:read') || perms.includes('clouds:write')
      || perms.includes('clouds.instances:read') || perms.includes('clouds.instances:write')
      || perms.includes('clouds.vpcs:read') || perms.includes('clouds.vpcs:write')
      || perms.includes('clouds.vswitches:read') || perms.includes('clouds.vswitches:write')
      || perms.includes('clouds.security-groups:read') || perms.includes('clouds.security-groups:write')
      || perms.includes('clouds.enis:read') || perms.includes('clouds.enis:write')
      || perms.includes('clouds.network-acls:read') || perms.includes('clouds.network-acls:write')
      || perms.includes('clouds.eips:read') || perms.includes('clouds.eips:write')
      || perms.includes('clouds.load-balancers:read') || perms.includes('clouds.load-balancers:write')
      || perms.includes('clouds.nat-gateways:read') || perms.includes('clouds.nat-gateways:write')
      || perms.includes('clouds.route-tables:read') || perms.includes('clouds.route-tables:write')
      || perms.includes('clouds.route-entries:read') || perms.includes('clouds.route-entries:write')
      || perms.includes('clouds.disks:read') || perms.includes('clouds.disks:write')
      || perms.includes('clouds.snapshots:read') || perms.includes('clouds.snapshots:write'));
    next();
  } catch {
    return res.status(403).json({ message: '权限不足' });
  }
};

// 引入阿里云RPC测试（无SDK）
import { testAliyunConnection, callAliyunEcs, callAliyunSlb, callAliyunVpc, callAliyunCms } from '../services/aliyun';
// 引入华为云SDK调用
import { testHuaweiConnection, huaweiListVpcs, huaweiListServers, huaweiListSnapshots, huaweiListSubnets, huaweiListRouteTables } from '../services/huaweicloud';
import { testTencentConnection, tencentListVpcs, tencentListInstances } from '../services/tencentcloud';
import { testHarvesterConnection, listHarvesterVMsStandard, harvesterStartVM, harvesterStopVM, harvesterRebootVM, harvesterDeleteVM, listKubeOvnVpcs, listKubeOvnSubnets } from '../services/harvester';
import { registerHarvesterRoutes } from './clouds.harvester';
import { registerAliyunRoutes } from './clouds.aliyun';
import { registerHuaweiRoutes } from './clouds.huaweicloud';
import { registerTencentRoutes } from './clouds.tencentcloud';

registerHarvesterRoutes(router, checkAdminPermission);
registerAliyunRoutes(router, checkAdminPermission);
registerHuaweiRoutes(router, checkAdminPermission);
registerTencentRoutes(router, checkAdminPermission);

// 获取云资源列表
router.get('/', checkAdminPermission, async (req: AuthRequest, res: Response) => {
  try {
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const clouds = await cloudRepository.find();

    res.json(clouds.map(redactCloud));
  } catch (error) {
    console.error('获取云资源列表失败:', error);
    res.status(500).json({ message: '获取云资源列表失败' });
  }
});

// 创建云资源
router.post('/', checkAdminPermission, validateCloudInput, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, type, region, endpoint, accessKey, secretKey, config } = req.body;

    const cloudRepository = AppDataSource.getRepository(Cloud);
    
    // 检查名称是否已存在
    const existingCloud = await cloudRepository.findOne({
      where: { name }
    });
    
    if (existingCloud) {
      return res.status(400).json({ message: '云资源名称已存在' });
    }

    const test = await testCloudConnectionUnified({ provider: config?.provider, accessKey, secretKey, region, endpoint, config });
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
      createdBy: req.user?.id
    });

    await cloudRepository.save(cloud);

    // 返回结果时隐藏敏感信息
    const safeCloud = redactCloud(cloud);

    res.status(201).json({ 
      message: '云资源创建成功', 
      cloud: safeCloud,
      connectionStatus: isConnected ? '连接成功' : (connectionMessage || '连接失败，请检查配置')
    });
  } catch (error: any) {
    res.status(500).json({ message: '创建云资源失败', error: error.message });
  }
});

// 预创建连接测试（不保存云资源）
router.post('/test-connection', checkAdminPermission, async (req: AuthRequest, res: Response) => {
  try {
    const { provider, accessKey, secretKey, region, endpoint, config } = (req.body || {}) as any;
    const r = await testCloudConnectionUnified({ provider, accessKey, secretKey, region, endpoint, config });
    res.json({ ok: !!r.ok, message: r.message || (r.ok ? '连接成功' : '连接失败') });
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error?.message || '连接测试失败' });
  }
});

// 测试云资源连接
router.post('/:id/test', checkAdminPermission, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const cloudRepository = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepository.findOne({ where: { id } });
    if (!cloud) return res.status(404).json({ message: '云资源不存在' });
    const r = await testCloudConnectionUnified({ provider: cloud.config?.provider, accessKey: cloud.accessKey, secretKey: cloud.secretKey, region: cloud.region, endpoint: cloud.endpoint, config: cloud.config });
    const ok = !!r.ok;
    cloud.status = ok ? CloudStatus.ONLINE : CloudStatus.OFFLINE;
    cloud.lastTestAt = new Date();
    await cloudRepository.save(cloud);
    res.json({ message: ok ? '连接测试成功' : (r.message || '连接测试失败'), status: cloud.status, lastTestAt: cloud.lastTestAt });
  } catch (error: any) {
    res.status(500).json({ message: '连接测试失败', error: error.message });
  }
});

// 更新云资源
router.put('/:id', checkAdminPermission, async (req: AuthRequest, res: Response) => {
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

    if (needsConnectionTest) {
      const r = await testCloudConnectionUnified({ provider: cloud.config?.provider, accessKey: cloud.accessKey, secretKey: cloud.secretKey, region: cloud.region, endpoint: cloud.endpoint, config: cloud.config });
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
router.delete('/:id', checkAdminPermission, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const cloudRepository = AppDataSource.getRepository(Cloud);
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
    
    const cloud = await cloudRepository.findOne({ 
      where: { id }
    });

    if (!cloud) {
      return res.status(404).json({ message: '云资源不存在' });
    }

    // 检查是否有资源池分配（与实体字段保持一致：cloudId）
    const assignments = await assignmentRepository.find({
      where: { cloudId: id }
    });

    if (assignments.length > 0) {
      return res.status(400).json({ 
        message: `无法删除云资源池，已分配给 ${assignments.length} 个组织，请先移除相关分配` 
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
router.get('/resources/ecs-all', checkAdminPermission, async (req: AuthRequest, res: Response) => {
  try {
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const clouds = await cloudRepository.find();
    const supported = ['aliyun','huaweicloud','tencentcloud','harvester','cloudmap'];
    const items: any[] = [];
    for (const cloud of clouds) {
      const provider = String((cloud as any)?.config?.provider || '').toLowerCase();
      if (!supported.includes(provider)) continue;
      let list: any[] = [];
      const vpcInfoMap = new Map<string, { name?: string; cidr?: string }>();
      const vswInfoMap = new Map<string, { name?: string; cidr?: string; vpcId?: string }>();
      if (provider === 'aliyun') {
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region) continue;
        const resp: any = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeInstances', extraParams: { PageNumber: 1, PageSize: 100 } } as any);
        list = resp?.Instances?.Instance || [];
        try {
          const vpcResp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcs', extraParams: { PageNumber: 1, PageSize: 100 } } as any);
          const vpcs: any[] = vpcResp?.Vpcs?.Vpc || vpcResp?.VpcSets?.VpcSet || [];
          for (const v of (Array.isArray(vpcs) ? vpcs : [])) {
            if (v?.VpcId) vpcInfoMap.set(v.VpcId, { name: v?.VpcName, cidr: v?.CidrBlock });
          }
          const vswResp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVSwitches', extraParams: { PageNumber: 1, PageSize: 100 } } as any);
          const vsws: any[] = vswResp?.VSwitches?.VSwitch || [];
          for (const s of (Array.isArray(vsws) ? vsws : [])) {
            if (s?.VSwitchId) vswInfoMap.set(s.VSwitchId, { name: s?.VSwitchName, cidr: s?.CidrBlock, vpcId: s?.VpcId });
          }
        } catch {}
      } else if (provider === 'huaweicloud') {
        const projectId = (cloud.config as any)?.projectId;
        if (!cloud.accessKey || !cloud.secretKey || !projectId) continue;
        const resp: any = await huaweiListServers({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId });
        list = resp?.servers || [];
        try {
          const vpcResp: any = await huaweiListVpcs({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId });
          const vpcs: any[] = (vpcResp as any)?.vpcs || (vpcResp as any)?.vpcs?.vpcs || [];
          for (const v of (Array.isArray(vpcs) ? vpcs : [])) {
            const vid = v?.id || v?.VpcId;
            if (vid) vpcInfoMap.set(vid, { name: v?.name || v?.VpcName, cidr: v?.cidr || v?.CidrBlock });
          }
        } catch {}
      } else if (provider === 'tencentcloud') {
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region) continue;
        const resp: any = await tencentListInstances({ secretId: cloud.accessKey, secretKey: cloud.secretKey, region: cloud.region });
        list = resp?.InstanceSet || [];
        try {
          const vpcResp: any = await tencentListVpcs({ secretId: cloud.accessKey, secretKey: cloud.secretKey, region: cloud.region });
          const vpcs: any[] = vpcResp?.VpcSet || [];
          for (const v of (Array.isArray(vpcs) ? vpcs : [])) {
            if (v?.VpcId) vpcInfoMap.set(v.VpcId, { name: v?.VpcName, cidr: v?.CidrBlock });
          }
        } catch {}
      } else if (provider === 'harvester' || provider === 'cloudmap') {
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const version = String((cloud.config as any)?.harvesterVersion || '').trim();
        const resp: any[] = await listHarvesterVMsStandard({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure, version } as any);
        list = Array.isArray(resp) ? resp : [];
      }
      for (const r of (Array.isArray(list) ? list : [])) {
        const norm = await (async () => {
          if (provider === 'aliyun') {
            const ips: any[] = r?.VpcAttributes?.PrivateIpAddress?.IpAddress || [];
            const cpu = (r as any)?.Cpu;
            const memRaw = (r as any)?.Memory;
            const memoryGb = typeof memRaw === 'number' ? (memRaw > 256 ? Math.round(memRaw / 1024) : memRaw) : undefined;
            let usageCpuPct: number | undefined;
            let usageMemPct: number | undefined;
            try {
              const now = new Date();
              const end = now.toISOString().slice(0,19) + 'Z';
              const startDt = new Date(now.getTime() - 5 * 60 * 1000);
              const start = startDt.toISOString().slice(0,19) + 'Z';
              const dims = JSON.stringify([{ instanceId: r?.InstanceId }]);
              const cpuRes: any = await callAliyunCms({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeMetricList', version: '2019-01-01', extraParams: { Namespace: 'acs_ecs_dashboard', MetricName: 'CPUUtilization', Period: '60', Dimensions: dims, StartTime: start, EndTime: end } } as any);
              const cpuPointsStr: string = cpuRes?.Datapoints || '[]';
              const cpuPoints: any[] = JSON.parse(cpuPointsStr);
              const cpuLatest = cpuPoints.length ? cpuPoints[cpuPoints.length - 1] : undefined;
              const cpuAvg = cpuLatest?.Average ?? cpuLatest?.Value;
              usageCpuPct = typeof cpuAvg === 'number' ? Math.min(100, Math.max(0, Math.round(cpuAvg))) : undefined;
              if (typeof memoryGb === 'number' && memoryGb > 0) {
                // 尝试内存使用率（需要云监控Agent）
                const memRes: any = await callAliyunCms({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeMetricList', version: '2019-01-01', extraParams: { Namespace: 'acs_ecs_dashboard', MetricName: 'memory_usedutilization', Period: '60', Dimensions: dims, StartTime: start, EndTime: end } } as any);
                const memPointsStr: string = memRes?.Datapoints || '[]';
                const memPoints: any[] = JSON.parse(memPointsStr);
                const memLatest = memPoints.length ? memPoints[memPoints.length - 1] : undefined;
                const memAvg = memLatest?.Average ?? memLatest?.Value;
                usageMemPct = typeof memAvg === 'number' ? Math.min(100, Math.max(0, Math.round(memAvg))) : undefined;
              }
            } catch {}
            const vswId: string | undefined = r?.VpcAttributes?.VSwitchId || r?.VSwitchId;
            if (vswId && !vswInfoMap.has(vswId)) {
              try {
                const one: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVSwitches', extraParams: { VSwitchId: vswId } } as any);
                const arr: any[] = one?.VSwitches?.VSwitch || [];
                const item = Array.isArray(arr) ? arr[0] : undefined;
                if (item?.VSwitchId) vswInfoMap.set(item.VSwitchId, { name: item?.VSwitchName, cidr: item?.CidrBlock, vpcId: item?.VpcId });
              } catch {}
            }
            const vpcIdAli = r?.VpcId || r?.VpcAttributes?.VpcId || (vswId ? vswInfoMap.get(vswId)?.vpcId : undefined);
            if (vpcIdAli && !vpcInfoMap.has(vpcIdAli)) {
              try {
                const one: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcs', extraParams: { VpcId: vpcIdAli } } as any);
                const arr: any[] = one?.Vpcs?.Vpc || one?.VpcSets?.VpcSet || [];
                const item = Array.isArray(arr) ? arr[0] : undefined;
                if (item?.VpcId) vpcInfoMap.set(item.VpcId, { name: item?.VpcName, cidr: item?.CidrBlock });
              } catch {}
            }
            if (vpcIdAli) {
              const cached = vpcInfoMap.get(vpcIdAli);
              if (!cached?.name || cached.name === vpcIdAli) {
                try {
                  const attr: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcAttribute', extraParams: { VpcId: vpcIdAli } } as any);
                  const name2 = attr?.VpcName || attr?.Vpc?.VpcName;
                  const cidr2 = attr?.CidrBlock || attr?.Vpc?.CidrBlock;
                  vpcInfoMap.set(vpcIdAli, { name: name2 || cached?.name, cidr: cidr2 || cached?.cidr });
                } catch {}
              }
            }
            return {
              id: r?.InstanceId,
              name: r?.InstanceName || r?.HostName || r?.InstanceId,
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
                vpcCidr: (vpcIdAli && vpcInfoMap.get(vpcIdAli)?.cidr) || r?.VpcAttributes?.CidrBlock || undefined,
                subnetId: vswId,
                subnetName: ((r?.VpcAttributes?.VSwitchId || r?.VSwitchId) && vswInfoMap.get(r?.VpcAttributes?.VSwitchId || r?.VSwitchId)?.name) || undefined,
                subnetCidr: ((r?.VpcAttributes?.VSwitchId || r?.VSwitchId) && vswInfoMap.get(r?.VpcAttributes?.VSwitchId || r?.VSwitchId)?.cidr) || undefined,
              },
              cpu: typeof cpu === 'number' ? cpu : undefined,
              memoryGb,
              usageCpuPct,
              usageMemPct,
              caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true }
            };
          }
          if (provider === 'huaweicloud') {
            const ipArr = Array.isArray((r as any)?.addresses) ? (r as any)?.addresses : [];
            const pri = Array.isArray((r as any)?.privateIps) ? (r as any)?.privateIps : [];
            const ips = pri.length ? pri : ipArr;
            const flavor = (r as any)?.flavor || {};
            const cpu = typeof flavor?.vcpus === 'number' ? flavor.vcpus : undefined;
            const memRaw = typeof flavor?.ram === 'number' ? flavor.ram : undefined;
            const memoryGb = typeof memRaw === 'number' ? Math.round(memRaw / 1024) : undefined;
            return {
              id: r?.id,
              name: r?.name || r?.id,
              provider,
              cloudId: cloud.id,
              region: cloud.region,
              status: r?.status,
              vpcId: (r as any)?.vpcId,
              zoneId: (r as any)?.az || (r as any)?.availability_zone,
              instanceType: (r as any)?.flavor?.id || (r as any)?.flavorId,
              privateIps: Array.isArray(ips) ? ips : [],
              createdAt: (r as any)?.created || (r as any)?.create_time,
              extra: { vpcName: ((r as any)?.vpcId && vpcInfoMap.get((r as any)?.vpcId)?.name) || undefined, vpcCidr: ((r as any)?.vpcId && vpcInfoMap.get((r as any)?.vpcId)?.cidr) || undefined },
              cpu,
              memoryGb,
              caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true }
            };
          }
          if (provider === 'tencentcloud') {
            const ips: any[] = r?.PrivateIpAddresses || [];
            const cpu = (r as any)?.CPU;
            const memRaw = (r as any)?.Memory;
            const memoryGb = typeof memRaw === 'number' ? memRaw : undefined;
            return {
              id: r?.InstanceId,
              name: r?.InstanceName || r?.InstanceId,
              provider,
              cloudId: cloud.id,
              region: cloud.region,
              status: r?.InstanceState || r?.State || r?.Status,
              vpcId: r?.VpcId,
              zoneId: r?.Zone || (r?.Placement && r?.Placement?.Zone),
              instanceType: r?.InstanceType,
              privateIps: Array.isArray(ips) ? ips : [],
              createdAt: r?.CreatedTime || r?.CreateTime,
              extra: { vpcName: (r?.VpcId && vpcInfoMap.get(r?.VpcId)?.name) || undefined, vpcCidr: (r?.VpcId && vpcInfoMap.get(r?.VpcId)?.cidr) || undefined },
              cpu: typeof cpu === 'number' ? cpu : undefined,
              memoryGb,
              caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true }
            };
          }
          if (provider === 'harvester' || provider === 'cloudmap') {
            const id: string = r?.InstanceId || '';
            const ns = id.includes('/') ? id.split('/')[0] : '';
            const name = id.includes('/') ? id.split('/').pop() : (r?.Extra?.Name || id);
            const pri = Array.isArray(r?.Extra?.IPs) ? r?.Extra?.IPs : [];
            const cpu = typeof (r?.Extra as any)?.CPU === 'number' ? (r?.Extra as any).CPU : undefined;
            const memStr = (r?.Extra as any)?.Memory as string | undefined;
            const memMatch = typeof memStr === 'string' ? memStr.match(/([0-9]+\.?[0-9]*)/i) : null;
            const memoryGb = memMatch ? Math.round(parseFloat(memMatch[1])) : undefined;
            const cpuUsagePct = typeof (r?.Extra as any)?.CpuUsagePct === 'number' ? (r?.Extra as any)?.CpuUsagePct : undefined;
            const memUsageStr: string | undefined = (r?.Extra as any)?.MemUsage;
            const memUsageMiMatch = typeof memUsageStr === 'string' ? memUsageStr.match(/([0-9]+\.?[0-9]*)\s*Mi/i) : null;
            const memUsageMi = memUsageMiMatch ? parseFloat(memUsageMiMatch[1]) : undefined;
            const usageMemPct = (typeof memoryGb === 'number' && memoryGb > 0 && typeof memUsageMi === 'number')
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
              createdAt: (r?.CreationTime || ((r?.Extra as any)?.CreationTime)) || undefined,
              extra: { namespace: ns, subnetName: (r?.Extra as any)?.SubnetName, networks: (r?.Extra as any)?.Networks },
              cpu,
              memoryGb,
              usageCpuPct: cpuUsagePct,
              usageMemPct: usageMemPct,
              caps: { 'compute.instanceType': false, 'compute.zone': false, 'network.vpc': true, 'network.fusion': true, 'provider.harvester.multus': true }
            };
          }
          return null;
        })();
        if (norm) items.push(norm);
      }
    }
    res.json({ message: '查询成功', data: items });
  } catch (error: any) {
    res.status(500).json({ message: '查询全部云主机失败', error: error.message });
  }
});

// 库存：查询已入库的云主机（必要时刷新）
router.get('/inventory/instances', checkAdminPermission, async (req: AuthRequest, res: Response) => {
  try {
    const invRepo = AppDataSource.getRepository(CloudInstanceInventory);
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const cloudsAll = await cloudRepository.find();
    const existingCloudIds = (Array.isArray(cloudsAll) ? cloudsAll : []).map(c => c.id);
    if (existingCloudIds.length > 0) {
      await invRepo.createQueryBuilder()
        .delete()
        .from(CloudInstanceInventory)
        .where('cloudId NOT IN (:...ids)', { ids: existingCloudIds })
        .execute();
    } else {
      await invRepo.createQueryBuilder()
        .delete()
        .from(CloudInstanceInventory)
        .execute();
    }
    let inv = await invRepo.find();
    const needRefresh = (!inv || inv.length === 0) || String(req.query.refresh || '').toLowerCase() === 'true';
    const targetCloudId = typeof (req.query as any)?.cloudId === 'string' ? String((req.query as any).cloudId) : undefined;
    const slow = String((req.query as any)?.slow || '').toLowerCase() === 'true';
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    if (needRefresh) {
      const clouds = await cloudRepository.find();
      const supported = ['aliyun','huaweicloud','tencentcloud','harvester','cloudmap'];
      for (const cloud of clouds) {
        if (slow) { await sleep(1200); }
        if (targetCloudId && cloud.id !== targetCloudId) continue;
        const provider = String((cloud as any)?.config?.provider || '').toLowerCase();
        if (!supported.includes(provider)) continue;
        let list: any[] = [];
        const vpcInfoMap = new Map<string, { name?: string; cidr?: string }>();
        const vswInfoMap = new Map<string, { name?: string; cidr?: string; vpcId?: string }>();
        if (provider === 'aliyun') {
          if (!cloud.accessKey || !cloud.secretKey || !cloud.region) continue;
          const resp: any = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeInstances', extraParams: { PageNumber: 1, PageSize: 100 } } as any);
          list = resp?.Instances?.Instance || [];
          try {
            const vpcResp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcs', extraParams: { PageNumber: 1, PageSize: 100 } } as any);
            const vpcs: any[] = vpcResp?.Vpcs?.Vpc || vpcResp?.VpcSets?.VpcSet || [];
            for (const v of (Array.isArray(vpcs) ? vpcs : [])) {
              if (v?.VpcId) vpcInfoMap.set(v.VpcId, { name: v?.VpcName, cidr: v?.CidrBlock });
            }
            const vswResp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVSwitches', extraParams: { PageNumber: 1, PageSize: 100 } } as any);
            const vsws: any[] = vswResp?.VSwitches?.VSwitch || [];
            for (const s of (Array.isArray(vsws) ? vsws : [])) {
              if (s?.VSwitchId) vswInfoMap.set(s.VSwitchId, { name: s?.VSwitchName, cidr: s?.CidrBlock, vpcId: s?.VpcId });
            }
          } catch {}
        } else if (provider === 'huaweicloud') {
          const projectId = (cloud.config as any)?.projectId;
          if (!cloud.accessKey || !cloud.secretKey || !projectId) continue;
          const resp: any = await huaweiListServers({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId });
          list = resp?.servers || [];
          try {
            const vpcsResp: any = await huaweiListVpcs({ ak: cloud.accessKey, sk: cloud.secretKey, region: cloud.region, projectId });
            const vpcs: any[] = vpcsResp?.vpcs || vpcsResp?.data?.vpcs || [];
            for (const v of (Array.isArray(vpcs) ? vpcs : [])) {
              const vid = v?.id || v?.vpcId || v?.VpcId;
              const name = v?.name || v?.vpcName || v?.VpcName;
              const cidr = v?.cidr || v?.cidr_block || v?.CidrBlock;
              if (vid) vpcInfoMap.set(String(vid), { name, cidr });
            }
          } catch {}
        } else if (provider === 'tencentcloud') {
          if (!cloud.accessKey || !cloud.secretKey || !cloud.region) continue;
          const resp: any = await tencentListInstances({ secretId: cloud.accessKey, secretKey: cloud.secretKey, region: cloud.region });
          list = resp?.InstanceSet || [];
        } else if (provider === 'harvester' || provider === 'cloudmap') {
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const version = String((cloud.config as any)?.harvesterVersion || '').trim();
        const resp: any[] = await listHarvesterVMsStandard({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure, version } as any);
        list = Array.isArray(resp) ? resp : [];
        }
        const seenIds = new Set<string>();
        for (const r of (Array.isArray(list) ? list : [])) {
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
            const memoryGb = typeof memRaw === 'number' ? (memRaw > 256 ? Math.round(memRaw / 1024) : memRaw) : undefined;
            const vswId = r?.VpcAttributes?.VSwitchId || r?.VSwitchId;
            if (vswId && !vswInfoMap.has(vswId)) {
              try {
                const one: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVSwitches', extraParams: { VSwitchId: vswId } } as any);
                const arr: any[] = one?.VSwitches?.VSwitch || [];
                const item = Array.isArray(arr) ? arr[0] : undefined;
                if (item?.VSwitchId) vswInfoMap.set(item.VSwitchId, { name: item?.VSwitchName, cidr: item?.CidrBlock, vpcId: item?.VpcId });
              } catch {}
            }
            const vpcIdAli = r?.VpcId || r?.VpcAttributes?.VpcId || (vswId ? vswInfoMap.get(vswId)?.vpcId : undefined);
            if (vpcIdAli && !vpcInfoMap.has(vpcIdAli)) {
              try {
                const one: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcs', extraParams: { VpcId: vpcIdAli } } as any);
                const arr: any[] = one?.Vpcs?.Vpc || one?.VpcSets?.VpcSet || [];
                const item = Array.isArray(arr) ? arr[0] : undefined;
                if (item?.VpcId) vpcInfoMap.set(item.VpcId, { name: item?.VpcName, cidr: item?.CidrBlock });
              } catch {}
            }
            if (vpcIdAli) {
              const cached = vpcInfoMap.get(vpcIdAli);
              if (!cached?.name || cached.name === vpcIdAli) {
                try {
                  const attr: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcAttribute', extraParams: { VpcId: vpcIdAli } } as any);
                  const name2 = attr?.VpcName || attr?.Vpc?.VpcName;
                  const cidr2 = attr?.CidrBlock || attr?.Vpc?.CidrBlock;
                  vpcInfoMap.set(vpcIdAli, { name: name2 || cached?.name, cidr: cidr2 || cached?.cidr });
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
              vpcCidr: (vpcIdAli && vpcInfoMap.get(vpcIdAli)?.cidr) || r?.VpcAttributes?.CidrBlock,
              subnetId: vswId,
              subnetName: (vswId && vswInfoMap.get(vswId)?.name) || undefined,
              subnetCidr: (vswId && vswInfoMap.get(vswId)?.cidr) || undefined,
              instanceCreatedAt: r?.CreationTime,
            };
          } else if (provider === 'huaweicloud') {
            const addrsRaw = (r as any)?.addresses;
            const addrItems: any[] = Array.isArray(addrsRaw)
              ? addrsRaw
              : Object.values(addrsRaw || {}).reduce((acc: any[], v: any) => acc.concat(Array.isArray(v) ? v : [v]), []);
            const floats: string[] = (addrItems || [])
              .filter((a: any) => String((a && (a['OS-EXT-IPS:type'] || a.type)) || '').toLowerCase() === 'floating')
              .map((a: any) => a?.addr || a?.ipAddress || a?.ip)
              .filter((s: any) => typeof s === 'string');
            let fixedIps: string[] = (addrItems || [])
              .filter((a: any) => {
                const t = String((a && (a['OS-EXT-IPS:type'] || a.type)) || '').toLowerCase();
                return t === 'fixed' || t === '' || (t !== 'floating');
              })
              .map((a: any) => a?.addr || a?.ipAddress || a?.ip)
              .filter((s: any) => typeof s === 'string');
            if (!fixedIps.length) {
              const fallback = (r as any)?.accessIPv4 || (r as any)?.privateIpAddress || (r as any)?.privateip;
              fixedIps = typeof fallback === 'string' && fallback ? [fallback] : [];
            }
            const flavor = (r as any)?.flavor || {};
            const cpu = typeof flavor?.vcpus === 'number' ? flavor.vcpus : undefined;
            const memRaw = typeof flavor?.ram === 'number' ? flavor.ram : undefined;
            const memoryGb = typeof memRaw === 'number' ? Math.round(memRaw / 1024) : undefined;
            const networkNames: string[] = (addrsRaw && !Array.isArray(addrsRaw)) ? Object.keys(addrsRaw) : [];
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
          } else if (provider === 'harvester' || provider === 'cloudmap') {
            const id: string = r?.InstanceId || '';
            const pri = r?.VpcAttributes?.PrivateIpAddress?.IpAddress || (Array.isArray(r?.Extra?.IPs) ? r?.Extra?.IPs : []);
            const cpu = typeof (r?.Extra as any)?.CPU === 'number' ? (r?.Extra as any).CPU : undefined;
            const memStr = (r?.Extra as any)?.Memory as string | undefined;
            const memMatch = typeof memStr === 'string' ? memStr.match(/([0-9]+\.?[0-9]*)/i) : null;
            const memoryGb = memMatch ? Math.round(parseFloat(memMatch[1])) : undefined;
            record = {
              ...base,
              instanceId: id,
              instanceName: id.split('/').pop() || id,
              status: r?.Status || (r as any)?.status,
              privateIps: JSON.stringify(Array.isArray(pri) ? pri : []),
              cpu,
              memoryGb,
              vpcId: (r as any)?.VpcId,
              subnetId: (r?.Extra as any)?.SubnetId,
              subnetName: (r?.Extra as any)?.SubnetName,
              networks: JSON.stringify(Array.isArray((r?.Extra as any)?.Networks) ? (r?.Extra as any)?.Networks : []),
              instanceCreatedAt: (r?.CreationTime || ((r?.Extra as any)?.CreationTime)) || undefined,
            };
          }
          if (!record || !record.instanceId) continue;
          if (typeof record.instanceId === 'string' && record.instanceId) { seenIds.add(record.instanceId); }
          const existing = await invRepo.findOne({ where: { instanceId: record.instanceId, cloudId: cloud.id } });
          if (existing) {
            Object.assign(existing, record);
            await invRepo.save(existing);
          } else {
            const created = invRepo.create(record as CloudInstanceInventory);
            await invRepo.save(created);
          }
        }
        if (seenIds.size > 0) {
          await invRepo.createQueryBuilder()
            .delete()
            .from(CloudInstanceInventory)
            .where('cloudId = :cloudId AND instanceId NOT IN (:...ids)', { cloudId: cloud.id, ids: Array.from(seenIds) })
            .execute();
        } else {
          await invRepo.createQueryBuilder()
            .delete()
            .from(CloudInstanceInventory)
            .where('cloudId = :cloudId', { cloudId: cloud.id })
            .execute();
        }
      }
      inv = await invRepo.find();
    }
    const data = ((targetCloudId ? (inv || []).filter(i => i.cloudId === targetCloudId) : (inv || []))).map((i) => ({
      id: i.instanceId,
      name: i.instanceName || i.instanceId,
      provider: i.provider,
      cloudId: i.cloudId,
      region: i.region,
      status: i.status,
      zoneId: i.zoneId,
      instanceType: i.instanceType,
      privateIps: (()=>{ try { return JSON.parse(i.privateIps || '[]'); } catch { return []; } })(),
      createdAt: i.instanceCreatedAt || undefined,
      updatedAt: i.updatedAt,
      extra: {
        vpcId: i.vpcId,
        vpcName: i.vpcName,
        vpcCidr: i.vpcCidr,
        subnetId: i.subnetId,
        subnetName: i.subnetName,
        subnetCidr: i.subnetCidr,
        networks: (()=>{ try { return JSON.parse(i.networks || '[]'); } catch { return []; } })(),
      },
      cpu: i.cpu,
      memoryGb: i.memoryGb,
      caps: { 'compute.instanceType': true, 'compute.zone': true, 'network.vpc': true }
    }));
    res.json({ message: '查询成功', data });
  } catch (error: any) {
    res.status(500).json({ message: '库存查询失败', error: error.message });
  }
});
