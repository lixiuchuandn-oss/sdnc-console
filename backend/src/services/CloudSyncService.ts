import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { callAliyunEcs } from './aliyun';
import { huaweiListServers } from './huaweicloud';
import { listHarvesterVMsStandard } from './harvester';
import { listCsmVms } from './clouds/csm/client';

export class CloudSyncService {
  private static instance: CloudSyncService;
  private isRunning: boolean = false;

  private constructor() {}

  public static getInstance(): CloudSyncService {
    if (!CloudSyncService.instance) {
      CloudSyncService.instance = new CloudSyncService();
    }
    return CloudSyncService.instance;
  }

  public startSyncJob(intervalMs: number = 300000) {
    // Default 5 minutes
    console.log('[CloudSync] Starting background sync job...');
    this.syncAllClouds(); // Run immediately
    setInterval(() => {
      this.syncAllClouds();
    }, intervalMs);
  }

  public async syncAllClouds() {
    if (this.isRunning) {
      console.log('[CloudSync] Sync already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('[CloudSync] Beginning cloud synchronization...');

    try {
      const cloudRepo = AppDataSource.getRepository(Cloud);
      const clouds = await cloudRepo.find();

      for (const cloud of clouds) {
        try {
          await this.syncSingleCloud(cloud);
        } catch (err) {
          console.error(`[CloudSync] Error syncing cloud ${cloud.name} (${cloud.id}):`, err);
        }
      }
    } catch (err) {
      console.error('[CloudSync] Critical error in sync job:', err);
    } finally {
      this.isRunning = false;
      console.log('[CloudSync] Synchronization completed.');
    }
  }

  private async syncSingleCloud(cloud: Cloud) {
    const provider = String(cloud.config?.provider || '').toLowerCase();

    // Helper to normalize running status
    const isRunning = (status: any) => {
      const s = String(status || '').toLowerCase();
      return s === 'running' || s === 'active' || s === 'on' || s === '1' || status === 1;
    };

    if (provider === 'aliyun') {
      // Fetch Total Count
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

      // Fetch Running Count
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
      const res = await huaweiListServers({
        ak: cloud.accessKey || '',
        sk: cloud.secretKey || '',
        region: cloud.region || '',
        projectId: cloud.config?.projectId || '',
      });
      // Huawei ListServersDetails API usually returns 'count' and 'servers'
      const list = res.servers || [];
      const total = res.count !== undefined ? res.count : list.length;

      // Approximation for running count if we can't filter easily via this wrapper
      const running = list.filter((i: any) => i.status === 'ACTIVE').length;

      cloud.vmCount = total;
      // If total > list.length, it means we have pagination.
      // We can't know true running count without fetching all.
      // For now, use the ratio or just the visible ones?
      // Let's stick to visible ones to be safe, or just 0 if we don't know.
      // Actually, let's just use what we have.
      cloud.runningVmCount = running;
    } else if (
      provider === 'harvester' ||
      provider === 'cloudmap.private' ||
      provider === 'cloudmap.edge'
    ) {
      const list = await listHarvesterVMsStandard({
        endpoint: cloud.endpoint || '',
        token: cloud.secretKey || '',
        insecure: !!cloud.config?.ignoreTls,
      });
      cloud.vmCount = list.length;
      cloud.runningVmCount = list.filter((i: any) => {
        const phase = i.status?.printableStatus || i.status?.phase;
        return String(phase).toLowerCase() === 'running';
      }).length;
    } else if (provider === 'cloudmap.csm') {
      const list = await listCsmVms({
        endpoint: cloud.endpoint || '',
        accessKey: cloud.accessKey || '',
        secretKey: cloud.secretKey || '',
        ignoreTls: !!cloud.config?.ignoreTls,
      });
      cloud.vmCount = list.length;
      cloud.runningVmCount = list.filter((i: any) => isRunning(i.status)).length;
    }

    cloud.lastSyncAt = new Date();
    await AppDataSource.getRepository(Cloud).save(cloud);
    // console.log(`[CloudSync] Updated ${cloud.name}: ${cloud.runningVmCount}/${cloud.vmCount}`);
  }
}
