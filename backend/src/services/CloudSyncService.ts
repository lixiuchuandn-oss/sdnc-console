import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { callAliyunEcs } from './aliyun';
import { huaweiListServers } from './huaweicloud';
import { listCsmVms } from './clouds/csm/client';
import {
  syncKubevirtVms,
  syncKubevirtVmis,
  syncHarvesterNodes,
  syncHarvesterStorageClasses,
  syncHarvesterLoadBalancers,
  syncHarvesterImages,
  syncHarvesterVolumes,
  syncHarvesterNads,
  syncKubeOvnVpcs,
  syncKubeOvnSubnets,
  syncHarvesterGpus,
  syncHarvesterNamespaces,
  syncHarvesterSnapshots,
  syncHarvesterBackups,
  syncHarvesterSshKeys,
  syncHarvesterCloudInits,
  syncHarvesterIngresses,
  syncHarvesterLoadBalancerIPPools,
  syncHarvesterPciDevices,
  syncHarvesterCapabilities,
  syncHarvesterServices,
  syncKubeOvnEips,
  syncKubeOvnFips,
  syncKubeOvnNatRules,
  syncHarvesterTemplates,
  syncHarvesterScheduleVmBackups,
} from './clouds/harvester/syncInventory';

export class CloudSyncService {
  private static instance: CloudSyncService;
  private isRunning: boolean = false;

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): CloudSyncService {
    if (!CloudSyncService.instance) {
      CloudSyncService.instance = new CloudSyncService();
    }
    return CloudSyncService.instance;
  }

  /**
   * 启动后台同步任务
   * @param intervalMs 同步间隔，默认 5 分钟 (300000ms)
   */
  public startSyncJob(intervalMs: number = 300000) {
    console.log('[CloudSync] Starting background sync job...');
    this.syncAllClouds(); // 立即运行一次
    setInterval(() => {
      this.syncAllClouds();
    }, intervalMs);
  }

  /**
   * 同步所有云平台的资源状态
   * 遍历数据库中所有云平台记录，逐个执行同步
   */
  public async syncAllClouds() {
    if (this.isRunning) {
      console.log('[CloudSync] 同步正在进行中，跳过...');
      return;
    }

    this.isRunning = true;
    console.log('[CloudSync] 开始云同步...');

    try {
      const cloudRepo = AppDataSource.getRepository(Cloud);
      const clouds = await cloudRepo.find();

      // 串行同步所有云，以避免 SQLite 事务冲突
      // 使用 try-catch 确保一个失败不影响其他
      for (const cloud of clouds) {
        try {
          await this.syncSingleCloud(cloud);
        } catch (err) {
          console.error(`[CloudSync] 同步云 ${cloud.name} (${cloud.id}) 时出错:`, err);
        }
      }
      
    } catch (err) {
      console.error('[CloudSync] 同步任务发生严重错误:', err);
    } finally {
      this.isRunning = false;
      console.log('[CloudSync] 同步完成。');
    }
  }

  /**
   * 同步单个云平台的资源
   * 根据 provider 类型分发到不同的同步逻辑
   */
  private async syncSingleCloud(cloud: Cloud) {
    const provider = String(cloud.config?.provider || '').toLowerCase();

    // 辅助函数：标准化运行状态判断
    const isRunning = (status: any) => {
      const s = String(status || '').toLowerCase();
      return s === 'running' || s === 'active' || s === 'on' || s === '1' || status === 1;
    };

    if (provider === 'aliyun') {
      // 阿里云同步逻辑
      // 1. 获取实例总数 (Total Count)
      const totalRes = await callAliyunEcs({
        accessKeyId: cloud.accessKey || '',
        accessKeySecret: cloud.secretKey || '',
        regionId: cloud.region || '',
        action: 'DescribeInstances',
        extraParams: { PageSize: 1 },
      });
      const totalCount =
        totalRes.TotalCount !== undefined
          ? totalRes.TotalCount
          : totalRes.Instances?.Instance?.length || 0;

      // 2. 获取运行中实例数 (Running Count)
      const runningRes = await callAliyunEcs({
        accessKeyId: cloud.accessKey || '',
        accessKeySecret: cloud.secretKey || '',
        regionId: cloud.region || '',
        action: 'DescribeInstances',
        extraParams: { PageSize: 1, Status: 'Running' },
      });
      const runningCount = runningRes.TotalCount !== undefined ? runningRes.TotalCount : 0;

      cloud.vmCount = totalCount;
      cloud.runningVmCount = runningCount;
    } else if (provider === 'huaweicloud') {
      // 华为云同步逻辑
      const res = await huaweiListServers({
        ak: cloud.accessKey || '',
        sk: cloud.secretKey || '',
        region: cloud.region || '',
        projectId: cloud.config?.projectId || '',
      });
      // 华为云 ListServersDetails API 通常返回 'count' 和 'servers' 列表
      const list = res.servers || [];
      const total = res.count !== undefined ? res.count : list.length;

      // 估算运行中实例数：如果列表被分页截断，这里只能统计当前页的运行状态
      const running = list.filter((i: any) => i.status === 'ACTIVE').length;

      cloud.vmCount = total;
      // 如果 total > list.length，说明有分页，无法确切知道所有运行中的数量。
      // 暂时只统计可见列表中的运行实例。
      cloud.runningVmCount = running;
    } else if (
      provider === 'harvester' ||
      provider === 'cloudmap.private' ||
      provider === 'cloudmap.edge'
    ) {
      // ---------------------------Harvester / Cloudmap私有云 / Cloudmap边缘云同步逻辑-----------------------------------
      const insecure = !!(cloud.config as any)?.ignoreTls;
      
      // 1. 同步各类资源清单到数据库 (VM, VMI, Nodes, Storage, LoadBalancers)
      // 并直接获取数量，避免重复查询数据库
      cloud.vmCount = await syncKubevirtVms(cloud, insecure);
      cloud.runningVmCount = await syncKubevirtVmis(cloud, insecure);
  
      await syncHarvesterNodes(cloud, insecure);
      await syncHarvesterStorageClasses(cloud, insecure);
      await syncHarvesterLoadBalancers(cloud, insecure);
      await syncHarvesterLoadBalancerIPPools(cloud, insecure);
      await syncHarvesterImages(cloud, insecure);
      await syncHarvesterVolumes(cloud, insecure);
      await syncHarvesterNads(cloud, insecure);
      await syncKubeOvnVpcs(cloud, insecure);
      await syncKubeOvnSubnets(cloud, insecure);
      await syncHarvesterGpus(cloud, insecure);
      await syncHarvesterNamespaces(cloud, insecure);
      await syncHarvesterSnapshots(cloud, insecure);
      await syncHarvesterBackups(cloud, insecure);
      await syncHarvesterSshKeys(cloud, insecure);
      await syncHarvesterCloudInits(cloud, insecure);
      await syncHarvesterIngresses(cloud, insecure);
      await syncHarvesterPciDevices(cloud, insecure);
      await syncHarvesterServices(cloud, insecure);
      await syncKubeOvnEips(cloud, insecure);
      await syncKubeOvnFips(cloud, insecure);
      await syncKubeOvnNatRules(cloud, insecure);
      await syncHarvesterTemplates(cloud, insecure);
      await syncHarvesterScheduleVmBackups(cloud, insecure);
    } else if (provider === 'cloudmap.public') {
      // CSM (Cloud Service Management) 同步逻辑
      const list = await listCsmVms({
        endpoint: cloud.endpoint || '',
        accessKey: cloud.accessKey || '',
        secretKey: cloud.secretKey || '',
        ignoreTls: !!cloud.config?.ignoreTls,
      });
      cloud.vmCount = list.length;
      cloud.runningVmCount = list.filter((i: any) => isRunning(i.status)).length;
    }

    // 更新云平台记录的同步时间和统计数据
    cloud.lastSyncAt = new Date();
    await AppDataSource.getRepository(Cloud).save(cloud);
    // console.log(`[CloudSync] Updated ${cloud.name}: ${cloud.runningVmCount}/${cloud.vmCount}`);
  }
}
