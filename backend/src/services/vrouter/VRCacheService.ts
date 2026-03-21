import { AppDataSource } from '../../config/database';
import { vrController } from './vrController';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { VRCacheDevice } from '../../entities/vRouter/VRCacheDevice';
import { extractRows } from '../../utils/apiUtils';
import { logger } from '../../utils/logger';

const vrCacheLog = logger.child('VR-Cache');

/** 单行摘要，避免 console.error(err) 打印整颗 Axios 对象（含敏感头与超长堆栈） */
function summarizeVrCacheError(err: unknown): string {
  if (err == null) return '';
  const e = err as any;
  const msg = e?.message || String(err);
  const code = e?.code ? String(e.code) : '';
  const cfg = e?.config;
  if (cfg && typeof cfg === 'object' && (cfg.url || cfg.baseURL)) {
    const method = String(cfg.method || 'get').toUpperCase();
    const url = String(cfg.url || cfg.baseURL || '');
    const status = e?.response?.status;
    const bits: string[] = [msg];
    if (code) bits.push(`code=${code}`);
    if (url) bits.push(`${method} ${url}`);
    if (status != null) bits.push(`http=${status}`);
    return bits.join(' | ');
  }
  return code ? `${msg} (${code})` : msg;
}

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

  public startSyncJob(intervalMs: number = 300000) {
    vrCacheLog.info('启动后台同步任务...');

    this.syncAll().catch((err) =>
      vrCacheLog.error('初始同步失败', summarizeVrCacheError(err)),
    );

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.syncAll().catch((err) =>
        vrCacheLog.error('定时同步失败', summarizeVrCacheError(err)),
      );
    }, intervalMs);
  }

  public stopSyncJob() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    vrCacheLog.info('后台同步任务已停止。');
  }

  public async syncAll() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    vrCacheLog.info('开始全量同步...');

    try {
      await Promise.all([this.syncBasicCache(), this.syncExtendedCache(), this.syncDeviceCache()]);
      vrCacheLog.info('全量同步完成。');
    } catch (err) {
      vrCacheLog.error('严重错误:', summarizeVrCacheError(err));
    } finally {
      this.isRunning = false;
    }
  }

  private async syncBasicCache() {
    vrCacheLog.info('开始同步 VR1 基础信息...');
    const repo = AppDataSource.getRepository(VRCacheBasic);

    try {
      const csmData = await vrController.getVRList(1000, 1);

      if (csmData) {
      } else {
        vrCacheLog.warn('VR1 响应为空');
      }

      const rows = extractRows(csmData);

      await repo.clear();

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
      vrCacheLog.info(`VR1 同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      vrCacheLog.error('VR1 同步失败:', summarizeVrCacheError(err));
    }
  }

  private sortInterfaces(interfaces: any[]) {
    if (!Array.isArray(interfaces)) return [];
    return interfaces.sort((a, b) => {
      const pciA = a.pci_slot || a.pci_bus || a.bus_info || a.pci || '';
      const pciB = b.pci_slot || b.pci_bus || b.bus_info || b.pci || '';
      if (pciA && pciB) {
        return pciA.localeCompare(pciB);
      }
      const nameA = a.name || a.iface || '';
      const nameB = b.name || b.iface || '';
      if (nameA && nameB) {
        return nameA.localeCompare(nameB, undefined, { numeric: true });
      }
      return 0;
    });
  }

  private async syncExtendedCache() {
    vrCacheLog.info('开始同步 VR3 扩展信息...');
    const repo = AppDataSource.getRepository(VRCacheExtended);

    try {
      const csmData = await vrController.getVR3List(1000, 1);

      if (csmData) {
      }

      const rows = extractRows(csmData);

      await repo.clear();

      const entities = rows
        .map((row: any) => {
          const id = row.uuid || row.id;

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
      vrCacheLog.info(`VR3 同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      vrCacheLog.error('VR3 同步失败:', summarizeVrCacheError(err));
    }
  }

  private async syncDeviceCache() {
    vrCacheLog.info('开始同步本地设备配置...');
    const deviceRepo = AppDataSource.getRepository(VRCacheDevice);
    const configRepo = AppDataSource.getRepository(VRConfig);

    try {
      const configs = await configRepo.find();

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
      vrCacheLog.info(`设备同步完成: 写入 ${entities.length} 条记录`);
    } catch (err) {
      vrCacheLog.error('设备同步失败:', summarizeVrCacheError(err));
    }
  }
}

