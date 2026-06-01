/**
 * ==============================================================================
 * 服务名称: 回收站定时任务服务 (Recycle Bin Task Service)
 * 文件路径: backend/src/services/clouds/harvester/RecycleBinTaskService.ts
 * ==============================================================================
 *
 * [功能描述]
 * 提供回收站虚拟机的定时任务管理，包括：
 * 1. 定时关机任务：扫描回收站中运行的虚拟机并自动关机
 * 2. 定时清理任务：删除过期的虚拟机
 *
 * [设计要点]
 * - 采用单例模式，防止在同一进程内启动多个任务循环
 * - 使用系统设置读取配置（关机间隔、保留时长）
 * - 记录每次关机操作到数据库，便于查询和审计
 * - 单个虚拟机操作失败不影响其他虚拟机
 *
 * ==============================================================================
 */

import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { RecycleBinShutdownRecord } from '../../../entities/harvester/RecycleBinShutdownRecord';
import { getSystemSetting } from '../../../config/systemSettings';
import { listKubevirtVMsRaw } from './vm';
import { harvesterEnsureVmStopped, harvesterForceDeleteVM, isVmNeedsShutdown } from './lifecycle';
import { HarvesterTestParams } from './types';
import { logger } from '../../../utils/logger';
import { cleanupVmDesktopResources } from '../../remote/guacamole/guacamoleAssignment';

const rbLog = logger.child('Recycle-Bin');

/** 与写入 DB 的 errorMessage 一致，用于「已为停止」跳过类记录的去重 */
const RB_SKIP_ALREADY_STOPPED_MSG = '执行关机任务时实例已为停止状态，未再次下发关机';

function summarizeRbErr(err: unknown): string {
  if (err == null) return '';
  const e = err as any;
  return e?.message || String(err);
}

// 判断 VM 是否处于运行状态（与 lifecycle.ts 中的逻辑保持一致）
const getVmStatusLower = (vm: any): string => {
  const status = vm?.status?.printableStatus || vm?.status?.phase || vm?.Status || '';
  return String(status).toLowerCase();
};

export class RecycleBinTaskService {
  private static instance: RecycleBinTaskService;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isShutdownRunning: boolean = false;
  private isCleanupRunning: boolean = false;

  private constructor() {}

  public static getInstance(): RecycleBinTaskService {
    if (!RecycleBinTaskService.instance) {
      RecycleBinTaskService.instance = new RecycleBinTaskService();
    }
    return RecycleBinTaskService.instance;
  }

  /**
   * 启动定时任务
   *
   * 行为说明：
   * - 立即执行一次关机任务和清理任务
   * - 之后根据配置的间隔定时执行
   */
  public startTasks() {
    rbLog.info('启动回收站定时任务...');

    // 立即执行一次关机任务
    this.shutdownRunningVmsInRecycleBin().catch((err) => {
      rbLog.error('初始关机任务失败:', summarizeRbErr(err));
    });

    // 立即执行一次清理任务
    this.cleanupExpiredVms().catch((err) => {
      rbLog.error('初始清理任务失败:', summarizeRbErr(err));
    });

    // 启动定时任务
    this.scheduleShutdownTask();
    this.scheduleCleanupTask();
  }

  /**
   * 停止定时任务
   */
  public stopTasks() {
    if (this.shutdownTimer) {
      clearInterval(this.shutdownTimer);
      this.shutdownTimer = null;
      rbLog.info('已停止关机定时任务');
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      rbLog.info('已停止清理定时任务');
    }
  }

  /**
   * 重新调度关机任务
   * 用于配置更新后立即应用新配置
   */
  public rescheduleShutdownTask() {
    rbLog.info('重新调度关机任务...');
    this.scheduleShutdownTask();
  }

  /**
   * 调度清理任务
   * 根据系统配置的间隔时间设置定时器（默认每天执行一次）
   */
  private scheduleCleanupTask() {
    // 停止旧的定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // 读取配置：默认 24 小时（每天一次）
    const intervalHours = parseInt(
      getSystemSetting('harvester.recycle_bin.cleanup_interval_hours') || '24',
      10,
    );
    const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000; // 至少 1 小时

    rbLog.debug(`定时清理任务间隔: ${intervalHours} 小时 (${intervalMs}ms)`);

    this.cleanupTimer = setInterval(() => {
      rbLog.debug(`定时触发清理任务...`);
      this.cleanupExpiredVms().catch((err) => {
        rbLog.error('定时清理任务失败:', summarizeRbErr(err));
      });
    }, intervalMs);

    rbLog.debug(`清理定时任务已启动，将在 ${intervalHours} 小时后执行下一次扫描`);
  }

  /**
   * 调度关机任务
   * 根据系统配置的间隔时间设置定时器
   */
  private scheduleShutdownTask() {
    // 停止旧的定时器
    if (this.shutdownTimer) {
      clearInterval(this.shutdownTimer);
    }

    // 读取配置：默认 1 小时
    const intervalHours = parseInt(
      getSystemSetting('harvester.recycle_bin.shutdown_interval_hours') || '1',
      10,
    );
    const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000; // 至少 1 小时

    rbLog.debug(`定时关机任务间隔: ${intervalHours} 小时 (${intervalMs}ms)`);

    this.shutdownTimer = setInterval(() => {
      rbLog.debug(`定时触发关机任务...`);
      this.shutdownRunningVmsInRecycleBin().catch((err) => {
        rbLog.error('定时关机任务失败:', summarizeRbErr(err));
      });
    }, intervalMs);

    rbLog.debug(`定时任务已启动，将在 ${intervalHours} 小时后执行下一次扫描`);
  }

  /**
   * 关机任务：扫描所有 Harvester 云平台，关闭回收站中运行的虚拟机
   */
  private async shutdownRunningVmsInRecycleBin() {
    if (this.isShutdownRunning) {
      rbLog.info('关机任务正在进行中，跳过...');
      return;
    }

    this.isShutdownRunning = true;
    const taskId = `task-${Date.now()}`;
    rbLog.debug(`开始执行关机任务 [${taskId}]...`);

    try {
      const cloudRepo = AppDataSource.getRepository(Cloud);
      const allClouds = await cloudRepo.find();

      // 过滤出 Harvester 相关的云平台
      const clouds = allClouds.filter((cloud) => {
        const provider = String(cloud.config?.provider || '').toLowerCase();
        return (
          provider === 'harvester' ||
          provider === 'cloudmap.private' ||
          provider === 'cloudmap.edge'
        );
      });

      rbLog.debug(`找到 ${clouds.length} 个 Harvester 云平台`);

      let totalScanned = 0;
      let totalShutdown = 0;
      let totalFailed = 0;
      let totalSkipped = 0;

      // 串行处理每个云平台
      for (const cloud of clouds) {
        try {
          const result = await this.processCloud(cloud, taskId);
          totalScanned += result.scanned;
          totalShutdown += result.shutdown;
          totalFailed += result.failed;
          totalSkipped += result.skipped;
        } catch (err) {
          rbLog.error(`处理云平台 ${cloud.name} (${cloud.id}) 失败:`, summarizeRbErr(err));
        }
      }

      rbLog.info(
        `关机任务完成 [${taskId}]: 扫描 ${totalScanned} 台, 关机 ${totalShutdown} 台, 失败 ${totalFailed} 台, 跳过 ${totalSkipped} 台`,
      );
    } catch (err) {
      rbLog.error('关机任务发生严重错误:', summarizeRbErr(err));
    } finally {
      this.isShutdownRunning = false;
    }
  }

  /**
   * 处理单个云平台的回收站虚拟机
   */
  private async processCloud(cloud: Cloud, taskId: string) {
    const provider = String(cloud.config?.provider || '').toLowerCase();
    if (
      provider !== 'harvester' &&
      provider !== 'cloudmap.private' &&
      provider !== 'cloudmap.edge'
    ) {
      return { scanned: 0, shutdown: 0, failed: 0, skipped: 0 };
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const params: HarvesterTestParams = {
      endpoint: cloud.endpoint || '',
      token: cloud.secretKey || '',
      insecure,
    };

    // 获取所有虚拟机
    const vms = await listKubevirtVMsRaw(params);
    const recycleBinFinalizer = 'tower.io/recycle-bin';

    rbLog.debug(`云平台 ${cloud.name}: 获取到 ${vms.length} 台虚拟机`);

    // 过滤出回收站中的虚拟机
    const recycleBinVms = vms.filter((vm: any) => {
      const finalizers = vm?.metadata?.finalizers || [];
      const labels = vm?.metadata?.labels || {};
      return finalizers.includes(recycleBinFinalizer) || labels['tower.io/recycle-bin'] === 'true';
    });

    rbLog.debug(`云平台 ${cloud.name}: 回收站中有 ${recycleBinVms.length} 台虚拟机`);

    const scanned = recycleBinVms.length;
    let shutdown = 0;
    let failed = 0;
    let skipped = 0;

    // 处理每个回收站中的虚拟机
    for (const vm of recycleBinVms) {
      try {
        const result = await this.processVm(cloud, vm, params, taskId);
        if (result === 'success') shutdown++;
        else if (result === 'failed') failed++;
        else skipped++;
      } catch (err) {
        rbLog.error(
          `处理虚拟机失败: ${cloud.name}/${vm.metadata?.namespace}/${vm.metadata?.name}`,
          summarizeRbErr(err),
        );
        failed++;
      }
    }

    return { scanned, shutdown, failed, skipped };
  }

  /**
   * 获取虚拟机的显示名称（与前端VmSection.tsx逻辑一致）
   */
  private getVmDisplayName(vm: any): string | undefined {
    const annotations = vm?.metadata?.annotations || {};
    // 优先使用 annotations["field.cattle.io/displayName"]
    const annotationName = annotations['field.cattle.io/displayName'];
    if (annotationName) return String(annotationName).trim();
    // 其次使用 spec.displayName
    if (vm?.spec?.displayName) return String(vm.spec.displayName).trim();
    // 最后使用顶层 displayName
    if (vm?.displayName) return String(vm.displayName).trim();
    return undefined;
  }

  /**
   * 处理单个虚拟机：检查状态并关机
   */
  private async processVm(
    cloud: Cloud,
    vm: any,
    params: HarvesterTestParams,
    taskId: string,
  ): Promise<'success' | 'failed' | 'skipped'> {
    const namespace = vm?.metadata?.namespace || '';
    const name = vm?.metadata?.name || '';
    const uid = vm?.metadata?.uid || '';
    const instanceId = namespace && name ? `${namespace}/${name}` : uid;
    const displayName = this.getVmDisplayName(vm);

    if (!namespace || !name) {
      rbLog.warn(`虚拟机缺少命名空间或名称，跳过: ${instanceId}`);
      return 'skipped';
    }

    // 检查虚拟机状态（使用与 lifecycle.ts 一致的判断逻辑）
    const status = this.getVmStatus(vm);
    const needsShutdown = isVmNeedsShutdown(vm);

    if (!needsShutdown) {
      // 已停止时写一条「跳过」便于审计；同一实例在「关机任务间隔」内不重复插入，避免每小时一条撑爆表
      rbLog.debug(`虚拟机已停止，跳过关机: ${cloud.name}/${instanceId} (状态: ${status})`);
      const dup = await this.hasRecentSkippedAlreadyStoppedRecord(cloud.id, instanceId);
      if (!dup) {
        await this.recordShutdown(cloud, {
          namespace,
          name,
          displayName,
          instanceId,
          uid,
          status: 'skipped',
          previousStatus: status,
          errorMessage: RB_SKIP_ALREADY_STOPPED_MSG,
          taskId,
        });
      }
      return 'skipped';
    }

    // 记录关机前的状态
    const previousStatus = status;
    rbLog.debug(`发现需关机的回收站虚拟机: ${cloud.name}/${instanceId} (状态: ${previousStatus})`);

    // 执行关机
    try {
      await harvesterEnsureVmStopped(params, instanceId, {
        attempts: 3,
        delayMs: 1000,
        requireRecycleBinFinalizer: true,
      });

      // 记录成功
      await this.recordShutdown(cloud, {
        namespace,
        name,
        displayName,
        instanceId,
        uid,
        status: 'success',
        previousStatus,
        taskId,
      });

      rbLog.debug(
        `成功关闭回收站中的虚拟机: ${cloud.name}/${instanceId} (原状态: ${previousStatus})`,
      );

      return 'success';
    } catch (err: any) {
      // 记录失败
      await this.recordShutdown(cloud, {
        namespace,
        name,
        displayName,
        instanceId,
        uid,
        status: 'failed',
        previousStatus,
        errorMessage: err?.message || String(err),
        taskId,
      });

      rbLog.error(`关闭回收站中的虚拟机失败: ${cloud.name}/${instanceId}`, summarizeRbErr(err));

      return 'failed';
    }
  }

  /**
   * 是否在最近一个「关机任务间隔」窗口内已有同实例的「已为停止」跳过记录（防定时任务重复写库）
   */
  private async hasRecentSkippedAlreadyStoppedRecord(
    cloudId: string,
    instanceId: string,
  ): Promise<boolean> {
    const intervalHours = parseInt(
      getSystemSetting('harvester.recycle_bin.shutdown_interval_hours') || '1',
      10,
    );
    const windowMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
    const since = new Date(Date.now() - windowMs * 0.95);

    const recordRepo = AppDataSource.getRepository(RecycleBinShutdownRecord);
    const cnt = await recordRepo
      .createQueryBuilder('r')
      .where('r.cloudId = :cloudId', { cloudId })
      .andWhere('r.instanceId = :instanceId', { instanceId })
      .andWhere('r.status = :st', { st: 'skipped' })
      .andWhere('r.shutdownAt >= :since', { since })
      .andWhere('r.errorMessage = :msg', { msg: RB_SKIP_ALREADY_STOPPED_MSG })
      .getCount();
    return cnt > 0;
  }

  /**
   * 获取虚拟机状态
   */
  private getVmStatus(vm: any): string {
    // 优先使用 printableStatus
    if (vm?.status?.printableStatus) {
      return String(vm.status.printableStatus).toLowerCase();
    }
    // 降级使用 phase
    if (vm?.status?.phase) {
      return String(vm.status.phase).toLowerCase();
    }
    // 降级使用 Status（兼容字段）
    if (vm?.Status) {
      return String(vm.Status).toLowerCase();
    }
    return 'unknown';
  }

  /**
   * 记录关机操作到数据库
   */
  private async recordShutdown(
    cloud: Cloud,
    data: {
      namespace: string;
      name: string;
      displayName?: string;
      instanceId: string;
      uid: string;
      status: string;
      previousStatus?: string;
      errorMessage?: string;
      taskId?: string;
    },
  ) {
    try {
      const recordRepo = AppDataSource.getRepository(RecycleBinShutdownRecord);
      const record = recordRepo.create({
        cloudId: cloud.id,
        cloudName: cloud.name || '',
        namespace: data.namespace,
        name: data.name,
        displayName: data.displayName,
        instanceId: data.instanceId,
        uid: data.uid,
        status: data.status,
        previousStatus: data.previousStatus,
        errorMessage: data.errorMessage,
        taskId: data.taskId,
      });
      await recordRepo.save(record);
    } catch (err) {
      rbLog.error('记录关机操作失败:', summarizeRbErr(err));
    }
  }

  /**
   * 手动触发一次关机任务（用于测试或立即执行）
   */
  public async triggerShutdownTask() {
    await this.shutdownRunningVmsInRecycleBin();
  }

  /**
   * 清理任务：扫描所有 Harvester 云平台，删除过期的回收站虚拟机
   */
  private async cleanupExpiredVms() {
    if (this.isCleanupRunning) {
      rbLog.info('清理任务正在进行中，跳过...');
      return;
    }

    this.isCleanupRunning = true;
    const taskId = `cleanup-${Date.now()}`;
    rbLog.debug(`开始执行清理任务 [${taskId}]...`);

    try {
      const cloudRepo = AppDataSource.getRepository(Cloud);
      const allClouds = await cloudRepo.find();

      // 过滤出 Harvester 相关的云平台
      const clouds = allClouds.filter((cloud) => {
        const provider = String(cloud.config?.provider || '').toLowerCase();
        return (
          provider === 'harvester' ||
          provider === 'cloudmap.private' ||
          provider === 'cloudmap.edge'
        );
      });

      rbLog.debug(`找到 ${clouds.length} 个 Harvester 云平台`);

      let totalScanned = 0;
      let totalDeleted = 0;
      let totalFailed = 0;
      let totalSkipped = 0;

      // 串行处理每个云平台
      for (const cloud of clouds) {
        try {
          const result = await this.processCloudForCleanup(cloud, taskId);
          totalScanned += result.scanned;
          totalDeleted += result.deleted;
          totalFailed += result.failed;
          totalSkipped += result.skipped;
        } catch (err: any) {
          rbLog.error(`处理云平台 ${cloud.name} (${cloud.id}) 失败:`, summarizeRbErr(err));
        }
      }

      rbLog.info(
        `清理任务完成 [${taskId}]: 扫描 ${totalScanned} 台, 删除 ${totalDeleted} 台, 失败 ${totalFailed} 台, 跳过 ${totalSkipped} 台`,
      );
    } catch (err: any) {
      rbLog.error('清理任务发生严重错误:', summarizeRbErr(err));
    } finally {
      this.isCleanupRunning = false;
    }
  }

  /**
   * 处理单个云平台的过期虚拟机清理
   */
  private async processCloudForCleanup(cloud: Cloud, taskId: string) {
    const provider = String(cloud.config?.provider || '').toLowerCase();
    if (
      provider !== 'harvester' &&
      provider !== 'cloudmap.private' &&
      provider !== 'cloudmap.edge'
    ) {
      return { scanned: 0, deleted: 0, failed: 0, skipped: 0 };
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const params: HarvesterTestParams = {
      endpoint: cloud.endpoint || '',
      token: cloud.secretKey || '',
      insecure,
    };

    // 获取所有虚拟机
    const vms = await listKubevirtVMsRaw(params);
    const recycleBinFinalizer = 'tower.io/recycle-bin';

    rbLog.debug(`云平台 ${cloud.name}: 获取到 ${vms.length} 台虚拟机`);

    // 过滤出回收站中的虚拟机
    const recycleBinVms = vms.filter((vm: any) => {
      const finalizers = vm?.metadata?.finalizers || [];
      const labels = vm?.metadata?.labels || {};
      return finalizers.includes(recycleBinFinalizer) || labels['tower.io/recycle-bin'] === 'true';
    });

    rbLog.debug(`云平台 ${cloud.name}: 回收站中有 ${recycleBinVms.length} 台虚拟机`);

    const now = new Date();
    const scanned = recycleBinVms.length;
    let deleted = 0;
    let failed = 0;
    let skipped = 0;

    // 处理每个回收站中的虚拟机
    for (const vm of recycleBinVms) {
      try {
        const result = await this.processVmForCleanup(cloud, vm, params, taskId, now);
        if (result === 'success') deleted++;
        else if (result === 'failed') failed++;
        else skipped++;
      } catch (err: any) {
        rbLog.error(
          `处理虚拟机失败: ${cloud.name}/${vm.metadata?.namespace}/${vm.metadata?.name}`,
          summarizeRbErr(err),
        );
        failed++;
      }
    }

    return { scanned, deleted, failed, skipped };
  }

  /**
   * 处理单个虚拟机：检查是否过期并删除
   */
  private async processVmForCleanup(
    cloud: Cloud,
    vm: any,
    params: HarvesterTestParams,
    taskId: string,
    now: Date,
  ): Promise<'success' | 'failed' | 'skipped'> {
    const namespace = vm?.metadata?.namespace || '';
    const name = vm?.metadata?.name || '';
    const uid = vm?.metadata?.uid || '';
    const instanceId = namespace && name ? `${namespace}/${name}` : uid;

    if (!namespace || !name) {
      rbLog.warn(`虚拟机缺少命名空间或名称，跳过: ${instanceId}`);
      return 'skipped';
    }

    // 检查过期时间
    const annotations = vm?.metadata?.annotations || {};
    const expiresAtStr = annotations['tower.io/deletion-expires'];

    if (!expiresAtStr) {
      // 没有过期时间注解，检查是否有删除时间注解（兼容旧数据）
      const scheduledAtStr = annotations['tower.io/deletion-scheduled'];
      if (!scheduledAtStr) {
        rbLog.debug(`虚拟机没有过期时间注解，跳过: ${cloud.name}/${instanceId}`);
        return 'skipped';
      }

      // 使用删除时间 + 默认保留天数（7天）计算过期时间
      const scheduledAt = new Date(scheduledAtStr);
      const defaultRetentionDays = parseInt(
        getSystemSetting('harvester.recycle_bin.retention_days') || '7',
        10,
      );
      const expiresAt = new Date(scheduledAt);
      expiresAt.setDate(expiresAt.getDate() + defaultRetentionDays);

      if (now < expiresAt) {
        rbLog.debug(
          `虚拟机未过期（基于删除时间+默认保留期），跳过: ${cloud.name}/${instanceId} (过期时间: ${expiresAt.toISOString()})`,
        );
        return 'skipped';
      }
    } else {
      // 有过期时间注解，直接比较
      const expiresAt = new Date(expiresAtStr);
      if (now < expiresAt) {
        rbLog.debug(
          `虚拟机未过期，跳过: ${cloud.name}/${instanceId} (过期时间: ${expiresAt.toISOString()})`,
        );
        return 'skipped';
      }
    }

    // 已过期，执行删除
    rbLog.debug(`发现过期的回收站虚拟机: ${cloud.name}/${instanceId}，开始删除...`);

    try {
      // 同步执行卷清理：须等 VM 删除与 PVC 删除（含重试）完成后再记成功，避免后台任务未跑完即漏删磁盘
      await harvesterForceDeleteVM(params, instanceId, true, false);
      await cleanupVmDesktopResources(cloud.id, instanceId).catch((err) => {
        rbLog.warn(`云桌面资源清理失败: ${cloud.name}/${instanceId}`, summarizeRbErr(err));
      });
      rbLog.debug(`已删除过期的回收站虚拟机及关联卷: ${cloud.name}/${instanceId}`);
      return 'success';
    } catch (err: any) {
      rbLog.error(`删除过期的回收站虚拟机失败: ${cloud.name}/${instanceId}`, summarizeRbErr(err));
      return 'failed';
    }
  }
}
