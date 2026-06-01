import { AppDataSource } from '../config/database';
import { getSystemSetting } from '../config/systemSettings';
import { AuditLog } from '../entities/AuditLog';
import { logger } from '../utils/logger';

const auditRetentionLog = logger.child('AuditLogRetention');
const DEFAULT_RETENTION_DAYS = 180;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getRetentionDays(): number {
  const raw = getSystemSetting('audit.logs.retention_days');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  return Math.max(1, Math.min(3650, Math.floor(parsed)));
}

export class AuditLogRetentionService {
  private static instance: AuditLogRetentionService | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  static getInstance(): AuditLogRetentionService {
    if (!this.instance) this.instance = new AuditLogRetentionService();
    return this.instance;
  }

  start(): void {
    if (this.timer) return;
    this.runOnce().catch((err) => {
      auditRetentionLog.error(
        '首次清理审计日志失败:',
        err instanceof Error ? err.message : String(err),
      );
    });
    this.timer = setInterval(() => {
      this.runOnce().catch((err) => {
        auditRetentionLog.error(
          '定时清理审计日志失败:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }, ONE_DAY_MS);
    auditRetentionLog.info('审计日志清理任务已启动（每24小时一次）');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const days = getRetentionDays();
      const cutoff = new Date(Date.now() - days * ONE_DAY_MS);
      const repo = AppDataSource.getRepository(AuditLog);
      const result = await repo
        .createQueryBuilder()
        .delete()
        .from(AuditLog)
        .where('createdAt < :cutoff', { cutoff: cutoff.toISOString() })
        .execute();
      const affected = typeof result.affected === 'number' ? result.affected : 0;
      auditRetentionLog.info(`审计日志清理完成：保留 ${days} 天，删除 ${affected} 条`);
    } finally {
      this.running = false;
    }
  }
}
