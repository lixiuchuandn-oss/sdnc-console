import { AppDataSource } from '../config/database';
import { hasImageUploadProxyInFlightForCloud } from '../routes/clouds/harvester/handlers/imageUploadRuntime';
import { Cloud } from '../entities/Cloud';
import { callAliyunEcs } from './clouds/aliyun/client';
import { huaweiListServers } from './clouds/huaweicloud/client';
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
  syncKubeOvnProviderNetworks,
  syncKubeOvnVlans,
  syncHarvesterGpus,
  syncHarvesterNamespaces,
  syncHarvesterSnapshots,
  syncHarvesterBackups,
  syncHarvesterSshKeys,
  syncHarvesterCloudInits,
  syncHarvesterLoadBalancerIPPools,
  syncHarvesterPciDevices,
  syncHarvesterServices,
  syncKubeOvnEips,
  syncKubeOvnFips,
  syncKubeOvnNatRules,
  syncHarvesterTemplates,
  syncHarvesterScheduleVmBackups,
} from './clouds/harvester/inventory';
import { logger } from '../utils/logger';

const cloudSyncLog = logger.child('Cloud-Sync');

function summarizeSyncError(err: unknown): string {
  if (err == null) return '';
  const e = err as any;
  return e?.message || String(err);
}

/**
 * 云资源同步服务（后台任务）
 *
 * 核心职责：
 * - 周期性扫描数据库中的所有 Cloud（资源池）记录
 * - 按 provider 类型调用对应云厂商 / Harvester / CSM 的同步逻辑
 * - 更新 Cloud 表中的统计信息（如 vmCount、runningVmCount、lastSyncAt）
 * - 对 Harvester 相关资源（VM、Volume、NAD、VPC 等）进行库存表同步
 *
 * 设计要点：
 * - 采用单例模式，防止在同一进程内启动多个同步循环导致并发写冲突
 * - syncAllClouds 串行处理每个云，避免 SQLite 写事务互相抢占
 * - 单个云同步失败不会影响其他云的同步（内部有 try-catch）
 */
export class CloudSyncService {
  private static instance: CloudSyncService;
  private isRunning: boolean = false;

  private constructor() {}

  /**
   * 获取单例实例
   *
   * 使用方式：
   *   const job = CloudSyncService.getInstance();
   *   job.startSyncJob();
   */
  public static getInstance(): CloudSyncService {
    if (!CloudSyncService.instance) {
      CloudSyncService.instance = new CloudSyncService();
    }
    return CloudSyncService.instance;
  }

  /**
   * 启动后台同步任务
   *
   * @param intervalMs 同步间隔，默认 5 分钟 (300000ms)
   *
   * 行为说明：
   * - 调用时会立即执行一次 syncAllClouds（启动即同步一次）
   * - 之后以 intervalMs 为周期，定时触发后续同步
   * - 内部使用 isRunning 标记，避免上一次同步未结束时再次进入
   */
  public startSyncJob(intervalMs: number = 300000) {
    cloudSyncLog.info('Starting background sync job...');
    const deferImmediate =
      process.env.TOWER_BACKGROUND_SYNC_IMMEDIATE === '0' ||
      (process.env.NODE_ENV === 'development' && process.env.TOWER_BACKGROUND_SYNC_IMMEDIATE !== '1');
    if (deferImmediate) {
      cloudSyncLog.info('开发环境跳过启动时立即云同步，避免与登录争抢 SQLite（可设 TOWER_BACKGROUND_SYNC_IMMEDIATE=1 恢复）');
    } else {
      this.syncAllClouds();
    }
    setInterval(() => {
      this.syncAllClouds();
    }, intervalMs);
  }

  /**
   * 同步所有云平台的资源状态
   * 遍历数据库中所有云平台记录，逐个执行同步
   *
   * 处理流程：
   * - 从数据库中读取所有 Cloud 记录
   * - 按顺序逐个调用 syncSingleCloud
   * - 单个云出错会被记录日志，但不会中断整个循环
   */
  public async syncAllClouds() {
    if (this.isRunning) {
      cloudSyncLog.info('同步正在进行中，跳过...');
      return;
    }

    this.isRunning = true;
    cloudSyncLog.info('开始云同步...');

    try {
      const cloudRepo = AppDataSource.getRepository(Cloud);
      const clouds = await cloudRepo.find();

      // 串行同步所有云，以避免 SQLite 事务冲突
      // 使用 try-catch 确保一个失败不影响其他
      for (const cloud of clouds) {
        try {
          await this.syncSingleCloud(cloud);
        } catch (err) {
          cloudSyncLog.error(`同步云 ${cloud.name} (${cloud.id}) 时出错:`, summarizeSyncError(err));
        }
      }
    } catch (err) {
      cloudSyncLog.error('同步任务发生严重错误:', summarizeSyncError(err));
    } finally {
      this.isRunning = false;
      cloudSyncLog.info('同步完成。');
    }
  }

  /**
   * 同步单个云平台的资源
   * 根据 provider 类型分发到不同的同步逻辑
   *
   * 说明：
   * - 根据 cloud.config.provider 判断云类型
   * - 为不同 provider 调用不同的同步实现
   *   - aliyun：通过 ECS API 统计实例总数 / 运行中数量
   *   - huaweicloud：通过华为云 SDK 列出服务器，统计数量与运行中数量
   *   - harvester / cloudmap.private / cloudmap.edge：
   *       调用 Harvester / KubeVirt / Kube-OVN 同步逻辑，把各类资源落库
   *   - cloudmap.public：
   *       通过 CSM 接口获取 VM 列表，统计数量与运行中数量
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
      if (!hasImageUploadProxyInFlightForCloud(String(cloud.id || ''))) {
        await syncHarvesterImages(cloud, insecure);
      }
      await syncHarvesterVolumes(cloud, insecure);
      await syncHarvesterNads(cloud, insecure);
      await syncKubeOvnVpcs(cloud, insecure);
      await syncKubeOvnSubnets(cloud, insecure);
      await syncKubeOvnProviderNetworks(cloud, insecure);
      await syncKubeOvnVlans(cloud, insecure);
      await syncHarvesterGpus(cloud, insecure);
      await syncHarvesterNamespaces(cloud, insecure);
      await syncHarvesterSnapshots(cloud, insecure);
      await syncHarvesterBackups(cloud, insecure);
      await syncHarvesterSshKeys(cloud, insecure);
      await syncHarvesterCloudInits(cloud, insecure);
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
