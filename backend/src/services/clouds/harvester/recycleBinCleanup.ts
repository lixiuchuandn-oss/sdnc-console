/**
 * 回收站清理服务
 * 定期检查回收站中过期的虚拟机并真正删除
 */

import { AppDataSource } from '../../../config/database';
import { Cloud, CloudStatus } from '../../../entities/Cloud';
import { harvesterForceDeleteVM } from './lifecycle';
import { listKubevirtVMsRawWithMeta } from './vm';
import { getSystemSetting } from '../../../config/systemSettings';

export class RecycleBinCleanupService {
  private static instance: RecycleBinCleanupService;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): RecycleBinCleanupService {
    if (!RecycleBinCleanupService.instance) {
      RecycleBinCleanupService.instance = new RecycleBinCleanupService();
    }
    return RecycleBinCleanupService.instance;
  }

  /**
   * 解析清理周期配置
   * 支持格式：
   * - 数字（小时）："12" -> 12小时
   * - 带单位："12h" -> 12小时, "1d" -> 1天, "2d" -> 2天
   * - 默认：24小时
   */
  private parseCleanupInterval(): number {
    const configValue = getSystemSetting('recycleBin.cleanupInterval');
    // console.log(`[RecycleBinCleanup] 读取配置 recycleBin.cleanupInterval: ${configValue}`);
    
    if (!configValue) {
      console.log('[RecycleBinCleanup] 配置为空，使用默认值 24小时');
      return 24 * 60 * 60 * 1000; // 默认24小时
    }

    const value = configValue.trim().toLowerCase();
    
    // 解析带单位的格式：如 "12h", "1d", "2d"
    const hourMatch = value.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/);
    if (hourMatch) {
      const hours = parseFloat(hourMatch[1]);
      return Math.max(1, Math.floor(hours * 60 * 60 * 1000)); // 至少1小时
    }

    const dayMatch = value.match(/^(\d+(?:\.\d+)?)\s*d(?:ays?)?$/);
    if (dayMatch) {
      const days = parseFloat(dayMatch[1]);
      return Math.max(1, Math.floor(days * 24 * 60 * 60 * 1000)); // 至少1小时
    }

    // 纯数字：视为小时
    const numMatch = value.match(/^(\d+(?:\.\d+)?)$/);
    if (numMatch) {
      const hours = parseFloat(numMatch[1]);
      return Math.max(1, Math.floor(hours * 60 * 60 * 1000)); // 至少1小时
    }

    // 解析失败，使用默认值
    console.warn(`[RecycleBinCleanup] 无效的清理周期配置: ${configValue}，使用默认值24小时`);
    return 24 * 60 * 60 * 1000;
  }

  /**
   * 启动清理任务
   * 清理周期从系统设置中读取，支持通过环境变量或系统设置API配置
   */
  public startCleanupJob(intervalMs?: number) {
    // 如果传入了参数，优先使用参数；否则从系统设置读取
    const finalInterval = intervalMs ?? this.parseCleanupInterval();
    const hours = finalInterval / (60 * 60 * 1000);
    
    console.log(`[RecycleBinCleanup] 启动回收站清理任务，清理周期: ${hours}小时`);
    this.cleanupExpiredVMs().catch((err) => 
      console.error('[RecycleBinCleanup] 初始清理失败', err)
    );
    
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.cleanupExpiredVMs().catch((err) => 
        console.error('[RecycleBinCleanup] 定时清理失败', err)
      );
    }, finalInterval);
  }

  /**
   * 重新加载配置并重启清理任务
   * 用于配置更新后动态调整清理周期
   */
  public reloadConfig() {
    console.log('[RecycleBinCleanup] 重新加载配置...');
    this.startCleanupJob();
  }

  public stopCleanupJob() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[RecycleBinCleanup] 回收站清理任务已停止');
    }
  }

  /**
   * 清理所有云中过期的虚拟机
   */
  private async cleanupExpiredVMs() {
    if (this.isRunning) {
      console.log('[RecycleBinCleanup] 清理任务正在运行，跳过本次执行');
      return;
    }

    this.isRunning = true;
    try {
      const cloudRepository = AppDataSource.getRepository(Cloud);
      const clouds = await cloudRepository.find({
        where: { status: CloudStatus.ONLINE }
      });

      const harvesterClouds = clouds.filter(
        (c) => (c.config as any)?.provider === 'harvester'
      );

      console.log(`[RecycleBinCleanup] 开始清理 ${harvesterClouds.length} 个 Harvester 云的过期虚拟机`);

      for (const cloud of harvesterClouds) {
        try {
          await this.cleanupCloudExpiredVMs(cloud);
        } catch (e: any) {
          console.error(`[RecycleBinCleanup] 清理云 ${cloud.name} 失败:`, e?.message || e);
        }
      }
    } catch (e: any) {
      console.error('[RecycleBinCleanup] 清理过程出错:', e?.message || e);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 清理单个云中过期的虚拟机
   */
  private async cleanupCloudExpiredVMs(cloud: Cloud) {
    const endpoint = cloud.endpoint || '';
    const token = cloud.secretKey || '';
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (!endpoint || !token) {
      console.warn(`[RecycleBinCleanup] 云 ${cloud.name} 缺少必要配置，跳过`);
      return;
    }

    try {
      // 获取所有VM（包括回收站中的）
      const vmsResult = await listKubevirtVMsRawWithMeta({
        endpoint,
        token,
        insecure,
      } as any);

      const vms = vmsResult?.items || [];
      const now = new Date();

      // 筛选出回收站中过期的VM
      const expiredVMs = vms.filter((vm: any) => {
        const finalizers = vm?.metadata?.finalizers || [];
        const recycleBinFinalizer = 'tower.io/recycle-bin';
        
        if (!finalizers.includes(recycleBinFinalizer)) {
          return false; // 不在回收站中
        }

        const expiresAtStr = vm?.metadata?.annotations?.['tower.io/deletion-expires'];
        if (!expiresAtStr) {
          return false; // 没有过期时间标记
        }

        const expiresAt = new Date(expiresAtStr);
        return expiresAt <= now; // 已过期
      });

      if (expiredVMs.length === 0) {
        console.log(`[RecycleBinCleanup] 云 ${cloud.name} 没有过期的虚拟机`);
        return;
      }

      console.log(`[RecycleBinCleanup] 云 ${cloud.name} 发现 ${expiredVMs.length} 个过期的虚拟机，开始删除`);

      // 逐个删除过期的VM
      for (const vm of expiredVMs) {
        const namespace = vm?.metadata?.namespace || '';
        const name = vm?.metadata?.name || '';
        const instanceId = `${namespace}/${name}`;

        try {
          console.log(`[RecycleBinCleanup] 删除过期虚拟机: ${instanceId}`);
          await harvesterForceDeleteVM(
            { endpoint, token, insecure },
            instanceId,
            false, // 不删除关联卷
            true  // 后台删除
          );
          console.log(`[RecycleBinCleanup] 成功删除过期虚拟机: ${instanceId}`);
        } catch (e: any) {
          console.error(`[RecycleBinCleanup] 删除过期虚拟机 ${instanceId} 失败:`, e?.message || e);
        }
      }
    } catch (e: any) {
      console.error(`[RecycleBinCleanup] 获取云 ${cloud.name} 的VM列表失败:`, e?.message || e);
    }
  }
}
