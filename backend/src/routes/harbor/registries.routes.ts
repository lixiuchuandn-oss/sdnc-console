/**
 * Harbor 实例管理路由
 *
 * 实现 Harbor 实例的 CRUD API 和测试连接功能。
 *
 * @see design/harbor-integration-design.md 第三章
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { HarborRegistry, HarborStatus } from '../../entities/harbor/HarborRegistry';
import { HarborProject } from '../../entities/harbor/HarborProject';
import { AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';

/** 容器页「镜像仓库」角色常授 clouds.containers.registries:*，与 harbor:registry:* 对齐 */
function canManageHarborRegistry(perms: string[], action: 'create' | 'update' | 'delete'): boolean {
  const harborPerm =
    action === 'create'
      ? 'harbor:registry:create'
      : action === 'update'
        ? 'harbor:registry:update'
        : 'harbor:registry:delete';
  return (
    checkPermission(perms, harborPerm) ||
    checkPermission(perms, 'clouds.containers.registries:write')
  );
}
import { HarborProxyService } from '../../services/harbor/HarborProxyService';
import { refreshManagedHarborPullSecrets } from '../../services/harbor/HarborSecretSyncService';
import {
  findRegistryServerConflict,
  formatRegistryServerConflictMessage,
} from '../../services/registryServerConflict';
import { findHarborRegistryForCloud } from '../../services/harbor/harborRegistryAccess';
import { logger } from '../../utils/logger';

const harborLog = logger.child('HarborRoutes');

// 简单的密码加密/解密（Base64 + 反转字符串）
const encryptPassword = (password: string): string => {
  return Buffer.from(password.split('').reverse().join('')).toString('base64');
};

const decryptPassword = (encrypted: string): string => {
  return Buffer.from(encrypted, 'base64').toString().split('').reverse().join('');
};

const router = Router();

/**
 * 获取 Harbor 实例列表
 * GET /api/harbor/registries
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(HarborRegistry);
    const { isBuiltIn, tenantId, cloudId } = req.query || {};

    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }

    const where: any = [];
    const conditions: string[] = [];

    // 平台内置 Harbor 全部可见
    conditions.push('registry.isBuiltIn = 1');

    // 用户自建 Harbor 按资源池隔离
    if (isBuiltIn === undefined || isBuiltIn === 'false') {
      conditions.push(`(registry.isBuiltIn = 0 AND registry.cloudId = :cloudId)`);
    }
    if (tenantId) {
      conditions.push(`registry.tenantId = :tenantId`);
    }

    const registries = await repo
      .createQueryBuilder('registry')
      .where(conditions.join(' OR '), { cloudId: String(cloudId), tenantId })
      .orderBy('registry.createdAt', 'DESC')
      .getMany();

    // 隐藏密码字段
    const result = registries.map((r) => ({
      ...r,
      password: undefined,
    }));

    res.json({ message: '查询成功', data: result });
  } catch (error: any) {
    harborLog.error('获取 Harbor 列表失败:', error.message);
    res.status(500).json({ message: '获取 Harbor 列表失败', error: error.message });
  }
});

/**
 * 创建 Harbor 实例
 * POST /api/harbor/registries
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!canManageHarborRegistry(perms, 'create')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { name, url, username, password, insecure, isBuiltIn, tenantId, metadata, cloudId } = req.body;

    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }
    if (!name?.trim() || !url?.trim() || !username?.trim() || !password?.trim()) {
      return res.status(400).json({ message: '缺少必填字段：name, url, username, password' });
    }

    const repo = AppDataSource.getRepository(HarborRegistry);

    // 检查名称是否已在当前资源池存在
    const existing = await repo.findOne({ where: { name, cloudId: String(cloudId) } });
    if (existing) {
      return res.status(400).json({ message: '当前资源池内 Harbor 实例名称已存在' });
    }

    // 处理 URL：确保有协议前缀
    let finalUrl = url.trim().replace(/\/$/, ''); // 移除末尾斜杠
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      // 根据 insecure 参数决定协议
      finalUrl = insecure ? `http://${finalUrl}` : `https://${finalUrl}`;
    }

    const serverConflict = await findRegistryServerConflict(finalUrl, { cloudId: String(cloudId) });
    if (serverConflict) {
      return res.status(400).json({ message: formatRegistryServerConflictMessage(serverConflict) });
    }

    // 加密密码（可逆加密，用于 Harbor API 调用）
    const encryptedPassword = encryptPassword(password);

    const registry = repo.create({
      name,
      url: finalUrl,
      username,
      password: encryptedPassword,
      insecure: insecure ?? false,
      isBuiltIn: isBuiltIn ?? false,
      tenantId,
      metadata,
      cloudId: String(cloudId),
      status: HarborStatus.UNKNOWN,
      createdBy: (req.user as any)?.id,
    });

    const saved = await repo.save(registry);

    harborLog.info(`创建 Harbor 实例: ${name} (${saved.id})`);

    res.status(201).json({
      message: '创建成功',
      data: {
        ...saved,
        password: undefined,
      },
    });
  } catch (error: any) {
    harborLog.error('创建 Harbor 实例失败:', error.message);
    res.status(500).json({ message: '创建 Harbor 实例失败', error: error.message });
  }
});

/**
 * 测试 Harbor 连接
 * POST /api/harbor/registries/:id/test
 *
 * 注意：此路由必须在 /:id 路由之前定义，否则 Express 会将 'test' 当作 id 参数
 */
router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const cloudId = req.body?.cloudId || req.query?.cloudId;
    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }
    const registry = await findHarborRegistryForCloud(id, String(cloudId));

    if (!registry) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    // 解密密码进行测试
    const { password: testPassword } = req.body;
    let passwordToUse = decryptPassword(registry.password);

    // 如果前端传了新密码（测试未保存的配置）
    if (testPassword?.trim()) {
      passwordToUse = testPassword;
    }

    harborLog.info(`测试 Harbor 连接: ${registry.url}, username=${registry.username}`);

    // 创建临时配置进行测试
    const tempRegistry = {
      ...registry,
      password: passwordToUse,
    };

    const proxy = HarborProxyService.getInstance(tempRegistry as HarborRegistry);
    const result = await proxy.testConnection();

    harborLog.info(`测试结果: ${result.success}, message=${result.message}`);

    // 更新状态
    registry.status = result.success ? HarborStatus.HEALTHY : HarborStatus.UNHEALTHY;
    registry.lastTestAt = new Date();
    if (result.version) {
      registry.version = result.version;
    }
    const repo = AppDataSource.getRepository(HarborRegistry);
    await repo.save(registry);

    // 如果是临时密码测试，清除缓存
    if (testPassword?.trim()) {
      HarborProxyService.clearInstance(id);
    }

    res.json({
      message: result.success ? '连接成功' : '连接失败',
      data: result,
    });
  } catch (error: any) {
    harborLog.error('测试 Harbor 连接失败:', error.message);
    res.status(500).json({ message: '测试连接失败', error: error.message });
  }
});

/**
 * 获取 Harbor 系统信息
 * GET /api/harbor/registries/:id/systeminfo
 */
router.get('/:id/systeminfo', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const cloudId = req.query?.cloudId;
    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }
    const registry = await findHarborRegistryForCloud(id, String(cloudId));

    if (!registry) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const proxy = HarborProxyService.getInstance(registry);
    const systemInfo = await proxy.getSystemInfo();

    res.json({ message: '查询成功', data: systemInfo });
  } catch (error: any) {
    harborLog.error('获取 Harbor 系统信息失败:', error.message);
    res.status(500).json({ message: '获取系统信息失败', error: error.message });
  }
});

/**
 * 手动同步 Harbor 项目
 * POST /api/harbor/registries/:id/sync-projects
 */
router.post('/:id/sync-projects', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const cloudId = req.body?.cloudId || req.query?.cloudId;
    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }
    const registry = await findHarborRegistryForCloud(id, String(cloudId));
    if (!registry) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harborProjectSyncService } =
      await import('../../services/harbor/HarborProjectSyncService');
    const result = await harborProjectSyncService.refreshHarborProjects(id);

    res.json({
      message: '项目同步成功',
      data: result,
    });
  } catch (error: any) {
    harborLog.error('手动同步项目失败:', error.message);
    res.status(500).json({ message: '项目同步失败', error: error.message });
  }
});

/**
 * 获取 Harbor 实例详情
 * GET /api/harbor/registries/:id
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const cloudId = req.query?.cloudId;
    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }
    const registry = await findHarborRegistryForCloud(id, String(cloudId));
    if (!registry) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    // 获取关联的项目数量
    const projectRepo = AppDataSource.getRepository(HarborProject);
    const projectCount = await projectRepo.count({ where: { harborId: id } });

    res.json({
      message: '查询成功',
      data: {
        ...registry,
        password: undefined,
        projectCount,
      },
    });
  } catch (error: any) {
    harborLog.error('获取 Harbor 详情失败:', error.message);
    res.status(500).json({ message: '获取 Harbor 详情失败', error: error.message });
  }
});

/**
 * 更新 Harbor 实例
 * PUT /api/harbor/registries/:id
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!canManageHarborRegistry(perms, 'update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { name, url, username, password, insecure, metadata, cloudId } = req.body;

    const repo = AppDataSource.getRepository(HarborRegistry);
    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }
    const registry = await findHarborRegistryForCloud(id, String(cloudId));

    if (!registry) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    // 名称唯一性检查（同资源池内）
    if (name && name !== registry.name) {
      const existing = await repo.findOne({
        where: { name, cloudId: registry.cloudId },
      });
      if (existing && existing.id !== id) {
        return res.status(400).json({ message: '当前资源池内 Harbor 实例名称已存在' });
      }
      registry.name = name;
    }

    if (url) {
      // 处理 URL：确保有协议前缀
      let finalUrl = url.trim().replace(/\/$/, '');
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        const useInsecure = insecure !== undefined ? insecure : registry.insecure;
        finalUrl = useInsecure ? `http://${finalUrl}` : `https://${finalUrl}`;
      }
      const serverConflict = await findRegistryServerConflict(finalUrl, {
        harborId: id,
        cloudId: registry.cloudId,
      });
      if (serverConflict) {
        return res.status(400).json({ message: formatRegistryServerConflictMessage(serverConflict) });
      }
      registry.url = finalUrl;
    }
    const credentialChanged = Boolean(username || password?.trim() || url);

    if (username) registry.username = username;
    if (password?.trim()) {
      registry.password = encryptPassword(password);
    }
    if (insecure !== undefined) registry.insecure = insecure;
    if (metadata !== undefined) registry.metadata = metadata;

    // 清除缓存的代理实例
    HarborProxyService.clearInstance(id);

    const saved = await repo.save(registry);

    harborLog.info(`更新 Harbor 实例: ${saved.name} (${id})`);

    let secretSync: Awaited<ReturnType<typeof refreshManagedHarborPullSecrets>> | undefined;
    if (credentialChanged && cloudId) {
      try {
        secretSync = await refreshManagedHarborPullSecrets(saved, { cloudId: String(cloudId) });
        if (secretSync.updated > 0) {
          harborLog.info(
            `Harbor 凭证变更后自动更新 ${secretSync.updated} 个 K8s 拉取 Secret（cloud=${cloudId}）`,
          );
        } else if (secretSync.failed === 0) {
          harborLog.info(
            `Harbor 凭证已变更，但资源池 ${cloudId} 内未找到可自动更新的 K8s 拉取 Secret（harbor=${id}）`,
          );
        }
      } catch (syncError: any) {
        harborLog.warn(`Harbor 凭证自动同步到 K8s Secret 失败: ${syncError.message}`);
        secretSync = { updated: 0, failed: 0, details: [] };
      }
    } else if (credentialChanged && !cloudId) {
      harborLog.info(`Harbor 凭证已变更，未提供 cloudId，跳过 K8s Secret 同步（harbor=${id}）`);
    }

    res.json({
      message: '更新成功',
      data: {
        ...saved,
        password: undefined,
        secretSync,
      },
    });
  } catch (error: any) {
    harborLog.error('更新 Harbor 实例失败:', error.message);
    res.status(500).json({ message: '更新 Harbor 实例失败', error: error.message });
  }
});

/**
 * 删除 Harbor 实例
 * DELETE /api/harbor/registries/:id
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!canManageHarborRegistry(perms, 'delete')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const cloudId = req.body?.cloudId || req.query?.cloudId;
    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }
    const repo = AppDataSource.getRepository(HarborRegistry);
    const registry = await findHarborRegistryForCloud(id, String(cloudId));

    if (!registry) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    // 检查是否为内置 Harbor
    if (registry.isBuiltIn) {
      return res.status(400).json({ message: '内置 Harbor 不允许删除' });
    }

    // 删除关联的项目缓存
    const projectRepo = AppDataSource.getRepository(HarborProject);
    await projectRepo.delete({ harborId: id });

    // 清除缓存的代理实例
    HarborProxyService.clearInstance(id);

    await repo.remove(registry);

    harborLog.info(`删除 Harbor 实例: ${registry.name} (${id})`);

    res.json({ message: '删除成功' });
  } catch (error: any) {
    harborLog.error('删除 Harbor 实例失败:', error.message);
    res.status(500).json({ message: '删除 Harbor 实例失败', error: error.message });
  }
});

export { router as registriesRoutes };
