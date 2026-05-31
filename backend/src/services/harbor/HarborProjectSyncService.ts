/**
 * HarborProjectSyncService - Harbor 项目缓存同步服务
 *
 * 负责：
 * 1. 定时同步 Harbor 项目列表到本地缓存（HarborProject 实体）
 * 2. 提供手动刷新接口
 * 3. 增量同步优化（只同步有变化的项目）
 *
 * 设计要点：
 * - 采用单例模式，防止并发同步
 * - 使用 isRunning 标记避免重复执行
 * - 单个 Harbor 同步失败不影响其他 Harbor
 *
 * @see backend/src/services/CloudSyncService.ts 参考实现
 */
import { AppDataSource } from '../../config/database';
import { HarborRegistry, HarborStatus } from '../../entities/harbor/HarborRegistry';
import { HarborProject } from '../../entities/harbor/HarborProject';
import { HarborProxyService } from './HarborProxyService';
import { logger } from '../../utils/logger';

const harborSyncLog = logger.child('HarborProjectSync');

/**
 * 错误摘要函数
 */
function summarizeSyncError(err: unknown): string {
  if (err == null) return '';
  const e = err as any;
  return e?.message || String(err);
}

/**
 * Harbor 项目同步服务
 *
 * 核心职责：
 * - 周期性同步所有 healthy 状态的 Harbor 项目列表到本地缓存
 * - 支持手动触发单个 Harbor 的项目同步
 * - 增量同步：检测项目变化，只更新有变化的记录
 */
export class HarborProjectSyncService {
  private static instance: HarborProjectSyncService;
  private syncInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * 同步间隔（默认 5 分钟）
   */
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000;

  /**
   * 启动延迟（避免服务启动冲突）
   */
  private readonly STARTUP_DELAY_MS = 30 * 1000;

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): HarborProjectSyncService {
    if (!HarborProjectSyncService.instance) {
      HarborProjectSyncService.instance = new HarborProjectSyncService();
    }
    return HarborProjectSyncService.instance;
  }

  /**
   * 启动定时同步任务
   *
   * @param intervalMs 同步间隔，默认 5 分钟
   *
   * 行为说明：
   * - 延迟 30 秒启动，避免服务启动冲突
   * - 启动后立即执行一次同步
   * - 之后按固定间隔执行同步
   */
  public startSync(intervalMs: number = this.SYNC_INTERVAL_MS): void {
    if (this.syncInterval) {
      harborSyncLog.warn('同步任务已在运行中，跳过启动');
      return;
    }

    harborSyncLog.info(`Harbor 项目同步服务将在 ${this.STARTUP_DELAY_MS / 1000} 秒后启动...`);

    // 延迟启动，避免服务启动冲突
    setTimeout(() => {
      harborSyncLog.info('启动 Harbor 项目同步服务...');
      this.syncAllHarbors();

      this.syncInterval = setInterval(() => {
        this.syncAllHarbors();
      }, intervalMs);

      harborSyncLog.info(`Harbor 项目同步服务已启动，同步间隔: ${intervalMs / 1000} 秒`);
    }, this.STARTUP_DELAY_MS);
  }

  /**
   * 停止定时同步任务
   */
  public stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      harborSyncLog.info('Harbor 项目同步服务已停止');
    }
  }

  /**
   * 同步所有 Harbor 的项目
   *
   * 处理流程：
   * - 查询所有 healthy 状态的 Harbor 实例
   * - 串行同步每个 Harbor 的项目（避免并发写冲突）
   * - 单个 Harbor 失败不影响其他 Harbor
   */
  public async syncAllHarbors(): Promise<void> {
    if (this.isRunning) {
      harborSyncLog.info('同步正在进行中，跳过...');
      return;
    }

    this.isRunning = true;
    harborSyncLog.info('开始同步所有 Harbor 项目...');

    try {
      const harborRepo = AppDataSource.getRepository(HarborRegistry);
      const harbors = await harborRepo.find({
        where: { status: HarborStatus.HEALTHY },
      });

      harborSyncLog.info(`找到 ${harbors.length} 个健康的 Harbor 实例`);

      // 串行同步，避免 SQLite 写事务冲突
      for (const harbor of harbors) {
        try {
          await this.syncHarborProjects(harbor.id);
        } catch (err) {
          harborSyncLog.error(
            `同步 Harbor ${harbor.name} (${harbor.id}) 项目失败:`,
            summarizeSyncError(err),
          );
          // 继续处理其他 Harbor
        }
      }
    } catch (err) {
      harborSyncLog.error('同步任务发生严重错误:', summarizeSyncError(err));
    } finally {
      this.isRunning = false;
      harborSyncLog.info('Harbor 项目同步完成');
    }
  }

  /**
   * 同步单个 Harbor 的项目
   *
   * @param harborId Harbor 实例 ID
   *
   * 增量同步策略：
   * 1. 获取远程项目列表
   * 2. 获取本地缓存项目列表
   * 3. 对比差异，执行增量更新
   * 4. 删除不存在的项目
   */
  public async syncHarborProjects(harborId: string): Promise<{
    added: number;
    updated: number;
    deleted: number;
  }> {
    const result = { added: 0, updated: 0, deleted: 0 };

    const harborRepo = AppDataSource.getRepository(HarborRegistry);
    const harbor = await harborRepo.findOne({ where: { id: harborId } });

    if (!harbor) {
      harborSyncLog.warn(`Harbor ${harborId} 不存在，跳过同步`);
      return result;
    }

    if (harbor.status !== HarborStatus.HEALTHY) {
      harborSyncLog.info(`Harbor ${harbor.name} 状态为 ${harbor.status}，跳过同步`);
      return result;
    }

    harborSyncLog.debug(`开始同步 Harbor ${harbor.name} 的项目...`);

    const projectRepo = AppDataSource.getRepository(HarborProject);

    // 获取代理服务并拉取远程项目
    const proxy = HarborProxyService.getInstance(harbor);
    let projects: any[] = [];

    try {
      // 分页获取所有项目
      projects = await this.fetchAllProjects(proxy);
    } catch (err) {
      harborSyncLog.error(`获取 Harbor ${harbor.name} 项目列表失败:`, summarizeSyncError(err));
      throw err;
    }

    // 获取现有项目缓存
    const existingProjects = await projectRepo.find({ where: { harborId } });
    const existingMap = new Map(existingProjects.map((p) => [p.projectId, p]));

    harborSyncLog.debug(
      `Harbor ${harbor.name}: 远程项目 ${projects.length} 个，本地缓存 ${existingProjects.length} 个`,
    );

    // 批量更新或创建
    for (const project of projects) {
      const projectId = project.project_id;
      const existing = existingMap.get(projectId);

      // 提取可见性信息
      const visibility = this.extractVisibility(project);

      if (existing) {
        // 检查是否有变化
        const hasChanges =
          existing.name !== project.name ||
          existing.ownerName !== project.owner_name ||
          existing.repoCount !== (project.repo_count || 0) ||
          existing.visibility !== visibility;

        if (hasChanges) {
          existing.name = project.name;
          existing.ownerName = project.owner_name;
          existing.repoCount = project.repo_count || 0;
          existing.visibility = visibility;
          existing.description =
            project.metadata?.public?.value === 'true'
              ? '公开项目'
              : project.metadata?.public?.value === 'false'
                ? '私有项目'
                : undefined;
          existing.metadata = project;
          existing.updatedAt = new Date();
          await projectRepo.save(existing);
          result.updated++;
        }
        // 从 map 中移除，剩下的就是要删除的
        existingMap.delete(projectId);
      } else {
        // 创建新项目
        const newProject = projectRepo.create({
          harborId,
          projectId,
          name: project.name,
          ownerName: project.owner_name,
          repoCount: project.repo_count || 0,
          visibility,
          description:
            project.metadata?.public?.value === 'true'
              ? '公开项目'
              : project.metadata?.public?.value === 'false'
                ? '私有项目'
                : undefined,
          metadata: project,
          tenantId: harbor.tenantId || '',
        });
        await projectRepo.save(newProject);
        result.added++;
      }
    }

    // 删除不再存在的项目
    for (const remaining of existingMap.values()) {
      await projectRepo.remove(remaining);
      result.deleted++;
    }

    // 更新 Harbor 的最后同步时间
    harbor.lastSyncAt = new Date();
    await harborRepo.save(harbor);

    harborSyncLog.info(
      `Harbor ${harbor.name} 项目同步完成: 新增 ${result.added}, 更新 ${result.updated}, 删除 ${result.deleted}`,
    );

    return result;
  }

  /**
   * 手动刷新单个 Harbor 的项目缓存
   *
   * @param harborId Harbor 实例 ID
   * @returns 同步结果统计
   */
  public async refreshHarborProjects(harborId: string): Promise<{
    added: number;
    updated: number;
    deleted: number;
  }> {
    return this.syncHarborProjects(harborId);
  }

  /**
   * 分页获取所有项目
   *
   * Harbor API 默认每页返回 10 条，需要分页获取完整列表
   */
  private async fetchAllProjects(proxy: HarborProxyService): Promise<any[]> {
    const allProjects: any[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const projects = await proxy.getProjects({ page, pageSize });

      if (projects.length === 0) {
        hasMore = false;
      } else {
        allProjects.push(...projects);
        page++;

        // 如果返回数量少于页大小，说明已经是最后一页
        if (projects.length < pageSize) {
          hasMore = false;
        }
      }
    }

    return allProjects;
  }

  /**
   * 提取项目可见性
   */
  private extractVisibility(project: any): string {
    // Harbor v2.x 使用 metadata.public 或 project.public 字段
    if (project.public !== undefined) {
      return project.public ? 'public' : 'private';
    }
    if (project.metadata?.public?.value === 'true') {
      return 'public';
    }
    return 'private';
  }
}

// 导出单例
export const harborProjectSyncService = HarborProjectSyncService.getInstance();
