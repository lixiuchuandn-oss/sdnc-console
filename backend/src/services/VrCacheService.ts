import { AppDataSource } from '../config/database';
import { vrController } from './vrController';
import { VRConfig } from '../entities/vRouter/VRConfig';
import { VRCacheBasic } from '../entities/vRouter/VRCacheBasic';
import { VRCacheExtended } from '../entities/vRouter/VRCacheExtended';
import { VRCacheDevice } from '../entities/vRouter/VRCacheDevice';
import { extractRows } from '../utils/apiUtils';

export class VRCacheService {
  private static instance: VRCacheService;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): VRCacheService {
    if (!VRCacheService.instance) {
      VRCacheService.instance = new VRCacheService();
    }
    return VRCacheService.instance;
  }

  /**
   * 启动后台同步任务
   * @param intervalMs 同步间隔，默认 5 分钟
   */
  public startSyncJob(intervalMs: number = 300000) {
    console.log('[VR-CACHE] 启动后台同步任务...');

    // 立即执行一次
    this.syncAll().catch((err) => console.error('[VR-CACHE] 初始同步失败', err));

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.syncAll().catch((err) => console.error('[VR-CACHE] 定时同步失败', err));
    }, intervalMs);
  }

  public stopSyncJob() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[VR-CACHE] 后台同步任务已停止。');
  }

  /**
   * 执行所有同步任务
   */
  public async syncAll() {
    if (this.isRunning) {
      // console.log('[VR-CACHE] 同步进行中，跳过...');
      return;
    }

    this.isRunning = true;
    console.log('[VR-CACHE] 开始全量同步...');

    try {
      await Promise.all([this.syncBasicCache(), this.syncExtendedCache(), this.syncDeviceCache()]);
      console.log('[VR-CACHE] 全量同步完成。');
    } catch (err) {
      console.error('[VR-CACHE] 严重错误:', err);
    } finally {
      this.isRunning = false;
    }
  }

  // 同步 VR1 基础信息 (CSMCTL -> VrCacheBasic)
  private async syncBasicCache() {
    console.log('[VR-CACHE] 开始同步 VR1 基础信息...');
    const repo = AppDataSource.getRepository(VRCacheBasic);

    try {
      // 拉取全量 (假设不超过 1000)
      const csmData = await vrController.getVRList(1000, 1);

      // Debug log for response structure
      if (csmData) {
        // 用户要求完整显示，不截断
        // const debugStr = JSON.stringify(csmData);
        // console.log(`[VR-CACHE] VR1 响应预览: ${debugStr}`);
      } else {
        console.warn('[VR-CACHE] VR1 响应为空');
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
      console.log(`[VR-CACHE] VR1 同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      console.error('[VR-CACHE] VR1 同步失败:', err);
    }
  }

  // Helper to sort interfaces by PCI slot or name
  private sortInterfaces(interfaces: any[]) {
    if (!Array.isArray(interfaces)) return [];
    return interfaces.sort((a, b) => {
      // Try pci_slot, pci_bus, bus_info, or just name (eth0, eth1)
      const pciA = a.pci_slot || a.pci_bus || a.bus_info || a.pci || '';
      const pciB = b.pci_slot || b.pci_bus || b.bus_info || b.pci || '';
      if (pciA && pciB) {
        return pciA.localeCompare(pciB);
      }
      // Fallback to name (eth0 < eth1)
      const nameA = a.name || a.iface || '';
      const nameB = b.name || b.iface || '';
      if (nameA && nameB) {
        return nameA.localeCompare(nameB, undefined, { numeric: true });
      }
      return 0;
    });
  }

  // 同步 VR3 扩展信息 (CSMCTL -> VrCacheExtended)
  private async syncExtendedCache() {
    console.log('[VR-CACHE] 开始同步 VR3 扩展信息...');
    const repo = AppDataSource.getRepository(VRCacheExtended);

    try {
      // 拉取全量
      const csmData = await vrController.getVR3List(1000, 1);

      // Debug log for response structure
      if (csmData) {
        // 用户要求完整显示，不截断
        // const debugStr = JSON.stringify(csmData);
        // console.log(`[VR-CACHE] VR3 响应预览: ${debugStr}`);
      }

      const rows = extractRows(csmData);

      // 清空旧数据
      await repo.clear();

      // 批量写入
      const entities = rows
        .map((row: any) => {
          const id = row.uuid || row.id;
          
          // Sort interfaces if present
          if (row.interfaces && Array.isArray(row.interfaces)) {
            row.interfaces = this.sortInterfaces(row.interfaces);
          }

          return repo.create({
            uuid: id,
            data: JSON.stringify(row),
          });
        })
        .filter((e: any) => !!e.uuid);

      await repo.save(entities);
      console.log(`[VR-CACHE] VR3 同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      console.error('[VR-CACHE] VR3 同步失败:', err);
    }
  }

  // 同步本地 SASE 设备配置 (DB -> VrCacheDevice)
  private async syncDeviceCache() {
    console.log('[VR-CACHE] 开始同步本地设备配置...');
    const deviceRepo = AppDataSource.getRepository(VRCacheDevice);
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
      console.log(`[VR-CACHE] 设备同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      console.error('[VR-CACHE] 设备同步失败:', err);
    }
  }
}
