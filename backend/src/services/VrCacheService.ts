import { AppDataSource } from '../config/database';
import { vrController } from './vrController';
import { VRConfig } from '../entities/VRConfig';
import { VrCacheBasic } from '../entities/VrCacheBasic';
import { VrCacheExtended } from '../entities/VrCacheExtended';
import { VrCacheDevice } from '../entities/VrCacheDevice';
import { extractRows } from '../utils/apiUtils';

export class VrCacheService {
  private static instance: VrCacheService;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): VrCacheService {
    if (!VrCacheService.instance) {
      VrCacheService.instance = new VrCacheService();
    }
    return VrCacheService.instance;
  }

  /**
   * 启动后台同步任务
   * @param intervalMs 同步间隔，默认 5 分钟
   */
  public startSyncJob(intervalMs: number = 300000) {
    console.log('[VR_SYNC] 启动后台同步任务...');

    // 立即执行一次
    this.syncAll().catch((err) => console.error('[VR_SYNC] 初始同步失败', err));

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.syncAll().catch((err) => console.error('[VR_SYNC] 定时同步失败', err));
    }, intervalMs);
  }

  public stopSyncJob() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[VR_SYNC] 后台同步任务已停止。');
  }

  /**
   * 执行所有同步任务
   */
  public async syncAll() {
    if (this.isRunning) {
      // console.log('[VR_CACHE_SERVICE] 同步进行中，跳过...');
      return;
    }

    this.isRunning = true;
    console.log('[VR_SYNC] 开始全量同步...');

    try {
      await Promise.all([this.syncBasicCache(), this.syncExtendedCache(), this.syncDeviceCache()]);
      console.log('[VR_SYNC] 全量同步完成。');
    } catch (err) {
      console.error('[VR_SYNC] 严重错误:', err);
    } finally {
      this.isRunning = false;
    }
  }

  // 同步 VR1 基础信息 (CSMCTL -> VrCacheBasic)
  private async syncBasicCache() {
    console.log('[VR_SYNC] 开始同步 VR1 基础信息...');
    const repo = AppDataSource.getRepository(VrCacheBasic);

    try {
      // 拉取全量 (假设不超过 1000)
      const csmData = await vrController.getVRList(1000, 1);

      // Debug log for response structure
      if (csmData) {
        // 用户要求完整显示，不截断
        const debugStr = JSON.stringify(csmData);
        console.log(`[VR_SYNC] VR1 响应预览: ${debugStr}`);
      } else {
        console.warn('[VR_SYNC] VR1 响应为空');
      }

      const rows = extractRows(csmData);

      // 清空旧数据
      await repo.clear();

      // 批量写入
      const entities = rows
        .map((row: any) => {
          const id = row.uuid || row.id || row.vm_id;
          return repo.create({
            uuid: id,
            data: JSON.stringify(row),
          });
        })
        .filter((e: any) => !!e.uuid);

      await repo.save(entities);
      console.log(`[VR_SYNC] VR1 同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      console.error('[VR_SYNC] VR1 同步失败:', err);
    }
  }

  // 同步 VR3 扩展信息 (CSMCTL -> VrCacheExtended)
  private async syncExtendedCache() {
    console.log('[VR_SYNC] 开始同步 VR3 扩展信息...');
    const repo = AppDataSource.getRepository(VrCacheExtended);

    try {
      // 拉取全量
      const csmData = await vrController.getVR3List(1000, 1);

      // Debug log for response structure
      if (csmData) {
        // 用户要求完整显示，不截断
        const debugStr = JSON.stringify(csmData);
        console.log(`[VR_SYNC] VR3 响应预览: ${debugStr}`);
      }

      const rows = extractRows(csmData);

      // 清空旧数据
      await repo.clear();

      // 批量写入
      const entities = rows
        .map((row: any) => {
          const id = row.uuid || row.id;
          return repo.create({
            uuid: id,
            data: JSON.stringify(row),
          });
        })
        .filter((e: any) => !!e.uuid);

      await repo.save(entities);
      console.log(`[VR_SYNC] VR3 同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      console.error('[VR_SYNC] VR3 同步失败:', err);
    }
  }

  // 同步本地 SASE 设备配置 (DB -> VrCacheDevice)
  private async syncDeviceCache() {
    console.log('[VR_SYNC] 开始同步本地设备配置...');
    const deviceRepo = AppDataSource.getRepository(VrCacheDevice);
    const configRepo = AppDataSource.getRepository(VRConfig);

    try {
      // 从本地数据库获取所有 VR 配置 (SASE 网关上报的数据)
      const configs = await configRepo.find();

      // 清空旧数据
      await deviceRepo.clear();

      const entities = configs
        .map((config) => {
          return deviceRepo.create({
            uuid: config.uuid,
            data: JSON.stringify(config),
          });
        })
        .filter((e: any) => !!e.uuid);

      await deviceRepo.save(entities);
      console.log(`[VR_SYNC] 设备同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      console.error('[VR_SYNC] 设备同步失败:', err);
    }
  }
}
