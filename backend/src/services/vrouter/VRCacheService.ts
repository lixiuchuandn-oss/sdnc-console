import { AppDataSource } from '../../config/database';
import { fetchAllVR1RowsFromCsm, fetchAllVR3RowsFromCsm, type CsmVrBizError } from './vrController';
import { syncVr2ConfigsToPlatform } from './vr2PlatformSync';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { VRCacheDevice } from '../../entities/vRouter/VRCacheDevice';
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

/** 单次 VR1/VR3/VR2/设备同步摘要（供 API 透出，避免错误仅落在服务端日志） */
export type VrCacheSyncPart = {
  ok: boolean;
  rowCount?: number;
  /** CSM 分页拉取次数（成功路径） */
  pages_fetched?: number;
  /** 对端 payload 声明的总条数（若有） */
  reported_total?: number;
  /** VR2：对端无配置条数 */
  skipped_no_config?: number;
  /** VR2：因 SRv6 公式账本而跳过 config_json 覆盖的条数 */
  skipped_srv6_ledger?: number;
  /** VR2：传输或未知失败条数 */
  fetch_errors?: number;
  csm_business_error?: CsmVrBizError;
  error?: string;
  /** CSM/拉取失败时已清空该表，避免与对端不一致的旧数据残留 */
  cache_cleared_on_failure?: boolean;
};

export type VrCacheSyncDiagnostics = {
  syncedAt: string;
  vr1: VrCacheSyncPart;
  vr3: VrCacheSyncPart;
  vr2: VrCacheSyncPart;
  device: VrCacheSyncPart;
};

export class VRCacheService {
  private static instance: VRCacheService;
  /** 串行队列：同步进行中时新请求排队，避免「直接 return 什么都不做」导致手动刷新无效果 */
  private syncChain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private lastSyncDiagnostics: VrCacheSyncDiagnostics | null = null;

  private constructor() {}

  public static getInstance(): VRCacheService {
    if (!VRCacheService.instance) {
      VRCacheService.instance = new VRCacheService();
    }
    return VRCacheService.instance;
  }

  public getLastSyncDiagnostics(): VrCacheSyncDiagnostics | null {
    return this.lastSyncDiagnostics;
  }

  public startSyncJob(intervalMs: number = 300000) {
    vrCacheLog.info('启动后台同步任务...');

    this.syncAll().catch((err) => vrCacheLog.error('初始同步失败', summarizeVrCacheError(err)));

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.syncAll().catch((err) => vrCacheLog.error('定时同步失败', summarizeVrCacheError(err)));
    }, intervalMs);
  }

  public stopSyncJob() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    vrCacheLog.info('后台同步任务已停止。');
  }

  public async syncAll(): Promise<void> {
    const job = async () => {
      vrCacheLog.info('开始全量同步...');
      const syncedAt = new Date().toISOString();
      try {
        const [vr1, vr3] = await Promise.all([this.syncBasicCache(), this.syncExtendedCache()]);
        await this.reconcileVrCachesAfterSync(vr1, vr3);
        const vr2 = await this.syncVr2PlatformCache(vr1);
        const device = await this.syncDeviceCache();
        this.lastSyncDiagnostics = { syncedAt, vr1, vr3, vr2, device };
        vrCacheLog.info('全量同步完成。');
      } catch (err) {
        vrCacheLog.error('严重错误:', summarizeVrCacheError(err));
      }
    };

    const p = this.syncChain.then(job);
    this.syncChain = p.then(
      () => undefined,
      () => undefined,
    );
    await p;
  }

  /**
   * 刷新后本地 VR 缓存须与 CSM 可解释状态一致：
   * - VR1 未成功：清空 VR3 表（避免仅有扩展、无基础）
   * - VR1+VR3 均成功：删掉 VR3 中在 VR1 不存在的 uuid
   */
  private async reconcileVrCachesAfterSync(vr1: VrCacheSyncPart, vr3: VrCacheSyncPart) {
    const basicRepo = AppDataSource.getRepository(VRCacheBasic);
    const extendedRepo = AppDataSource.getRepository(VRCacheExtended);

    if (!vr1.ok) {
      await extendedRepo.clear();
      vrCacheLog.warn('VR1 未成功同步，已清空 VR3 扩展缓存以避免与 CSM 不一致');
      return;
    }

    if (vr1.ok && vr3.ok) {
      const basics = await basicRepo.find();
      const allowed = new Set(basics.map((b) => String(b.uuid || '').trim()).filter(Boolean));
      const extendeds = await extendedRepo.find();
      let removed = 0;
      for (const e of extendeds) {
        const u = String(e.uuid || '').trim();
        if (u && !allowed.has(u)) {
          await extendedRepo.delete({ uuid: e.uuid });
          removed += 1;
        }
      }
      if (removed > 0) {
        vrCacheLog.info(`已移除 ${removed} 条 VR3 孤儿行（VR1 列表中无对应 uuid）`);
      }
    }
  }

  private async syncBasicCache(): Promise<VrCacheSyncPart> {
    const part: VrCacheSyncPart = { ok: false };
    vrCacheLog.info('开始同步 VR1 基础信息...');
    const repo = AppDataSource.getRepository(VRCacheBasic);

    try {
      const { rows, bizError, pagesFetched, reportedTotal } = await fetchAllVR1RowsFromCsm(1000);
      if (bizError) {
        await repo.clear();
        part.cache_cleared_on_failure = true;
        part.csm_business_error = bizError;
        part.error = `CSM VR1 [${bizError.code}] ${bizError.msg || ''}`;
        vrCacheLog.warn(`VR1 CSM 业务错误，已清空本地 VR1 缓存: ${part.error}`);
        return part;
      }

      part.rowCount = rows.length;
      part.pages_fetched = pagesFetched;
      if (reportedTotal != null) part.reported_total = reportedTotal;
      if (rows.length === 0) {
        vrCacheLog.warn('VR1 全量分页后无有效行');
      }

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
      part.ok = true;
      vrCacheLog.info(
        `VR1 同步完成: 写入 ${entities.length} 条（分页 ${pagesFetched} 次${reportedTotal != null ? `，对端 total=${reportedTotal}` : ''}）`,
      );
      return part;
    } catch (err) {
      try {
        await repo.clear();
        part.cache_cleared_on_failure = true;
      } catch {
        /* ignore */
      }
      part.error = summarizeVrCacheError(err);
      vrCacheLog.error('VR1 同步失败，已清空本地 VR1 缓存:', part.error);
      return part;
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

  private async syncExtendedCache(): Promise<VrCacheSyncPart> {
    const part: VrCacheSyncPart = { ok: false };
    vrCacheLog.info('开始同步 VR3 扩展信息...');
    const repo = AppDataSource.getRepository(VRCacheExtended);

    try {
      const { rows, bizError, pagesFetched, reportedTotal } = await fetchAllVR3RowsFromCsm(1000);
      if (bizError) {
        await repo.clear();
        part.cache_cleared_on_failure = true;
        part.csm_business_error = bizError;
        part.error = `CSM VR3 [${bizError.code}] ${bizError.msg || ''}`;
        vrCacheLog.warn(`VR3 CSM 业务错误，已清空本地 VR3 缓存: ${part.error}`);
        return part;
      }

      part.rowCount = rows.length;
      part.pages_fetched = pagesFetched;
      if (reportedTotal != null) part.reported_total = reportedTotal;

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
      part.ok = true;
      vrCacheLog.info(
        `VR3 同步完成: 写入 ${entities.length} 条（分页 ${pagesFetched} 次${reportedTotal != null ? `，对端 total=${reportedTotal}` : ''}）`,
      );
      return part;
    } catch (err) {
      try {
        await repo.clear();
        part.cache_cleared_on_failure = true;
      } catch {
        /* ignore */
      }
      part.error = summarizeVrCacheError(err);
      vrCacheLog.error('VR3 同步失败，已清空本地 VR3 缓存:', part.error);
      return part;
    }
  }

  /** VR1 成功后：从 CSM VR2 回写 vr_config，再刷新 device 镜像 */
  private async syncVr2PlatformCache(vr1: VrCacheSyncPart): Promise<VrCacheSyncPart> {
    const part: VrCacheSyncPart = { ok: false };
    if (!vr1.ok) {
      part.ok = true;
      part.rowCount = 0;
      vrCacheLog.info('VR1 未成功，跳过 VR2 配置同步');
      return part;
    }

    vrCacheLog.info('开始同步 VR2 配置...');
    try {
      const basicRepo = AppDataSource.getRepository(VRCacheBasic);
      const basics = await basicRepo.find();
      const uuids = basics.map((b) => String(b.uuid || '').trim()).filter(Boolean);
      const r = await syncVr2ConfigsToPlatform(uuids);
      part.rowCount = r.updated;
      part.skipped_no_config = r.noConfig;
      part.skipped_srv6_ledger = r.skippedLedger;
      part.fetch_errors = r.errors;
      part.ok = r.ok;
      if (r.error) part.error = r.error;
      vrCacheLog.info(
        `VR2 同步完成: 回写 ${r.updated} 条，保留 SRv6 账本 ${r.skippedLedger} 条，对端无配置 ${r.noConfig} 条${r.errors ? `，失败 ${r.errors} 条` : ''}`,
      );
      return part;
    } catch (err) {
      part.error = summarizeVrCacheError(err);
      vrCacheLog.error('VR2 同步失败:', part.error);
      return part;
    }
  }

  private async syncDeviceCache(): Promise<VrCacheSyncPart> {
    const part: VrCacheSyncPart = { ok: false };
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
      part.ok = true;
      part.rowCount = entities.length;
      vrCacheLog.info(`设备同步完成: 写入 ${entities.length} 条记录`);
      return part;
    } catch (err) {
      try {
        await deviceRepo.clear();
        part.cache_cleared_on_failure = true;
      } catch {
        /* ignore */
      }
      part.error = summarizeVrCacheError(err);
      vrCacheLog.error('设备缓存同步失败，已清空 VRCacheDevice:', summarizeVrCacheError(err));
      return part;
    }
  }
}
