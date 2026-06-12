/**
 * Harbor 项目管理路由
 *
 * 实现项目、仓库、制品等资源的代理 API。
 * 支持平台内置 Harbor 的用户体系对接。
 *
 * @see HarborProxyService
 * @see HarborUserService
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { HarborProject } from '../../entities/harbor/HarborProject';
import {
  HarborProjectBinding,
  HarborProjectCreatorType,
  HarborProjectVisibility,
} from '../../entities/harbor/HarborProjectBinding';
import { HarborUserMapping } from '../../entities/harbor/HarborUserMapping';
import { TenantUser } from '../../entities/TenantUser';
import { Tenant } from '../../entities/Tenant';
import { Organization } from '../../entities/Organization';
import { HarborProxyService } from '../../services/harbor/HarborProxyService';
import { HarborUserService } from '../../services/harbor/HarborUserService';
import { AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';
import {
  resolveHarborProjectRef,
  resolveHarborProjectRefAsync,
  buildHarborProjectContext,
} from './harborProjectRef';
import {
  harborRegistryCloudAccessMiddleware,
  HarborScopedRequest,
} from '../../services/harbor/harborRegistryCloudMiddleware';

const harborLog = logger.child('HarborProjects');

/** 解析创建/更新请求中的 public 字段 */
function parseHarborPublicValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'public';
  }
  return false;
}

/**
 * 检查用户是否有权访问 Harbor 资源
 * 
 * 权限规则：
 * 1. 系统管理员：检查 RBAC 权限
 * 2. 租户用户：平台内置 Harbor 允许访问，外部 Harbor 需要 RBAC 权限
 * 
 * @returns { allowed: boolean, isSystemAdmin: boolean, isTenantUser: boolean }
 */
function checkHarborAccess(
  req: AuthRequest,
  harbor: HarborRegistry,
  permission: string,
): { allowed: boolean; isSystemAdmin: boolean; isTenantUser: boolean } {
  const userRole = (req.user as any)?.role;
  const isSystemAdmin = userRole === 'super_admin' || userRole === 'admin';
  const isTenantUser = (req.user as any)?.isTenantUser || !!(req.user as any)?.tenantId;
  const isBuiltIn = (harbor as any).isBuiltIn === true;

  // 系统管理员：检查 RBAC 权限
  if (isSystemAdmin) {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    return { allowed: checkPermission(perms, permission), isSystemAdmin, isTenantUser };
  }

  // 租户用户：平台内置 Harbor 允许访问
  if (isTenantUser && isBuiltIn) {
    return { allowed: true, isSystemAdmin, isTenantUser };
  }

  // 租户用户访问外部 Harbor：检查 RBAC 权限
  if (isTenantUser) {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    return { allowed: checkPermission(perms, permission), isSystemAdmin, isTenantUser };
  }

  return { allowed: false, isSystemAdmin, isTenantUser };
}

/** 解析 Harbor 删除项目失败原因，返回可读中文提示 */
function resolveHarborDeleteProjectError(
  error: any,
  projectName: string,
): { httpStatus: number; message: string } {
  const harborStatus = Number(error?.response?.status) || 500;
  const data = error?.response?.data;
  const harborDetail =
    (Array.isArray(data?.errors) && data.errors[0]?.message) ||
    (typeof data?.message === 'string' ? data.message : '') ||
    '';

  if (harborStatus === 412) {
    const lowered = String(harborDetail).toLowerCase();
    let reason = '项目下仍有镜像仓库、Helm Chart 或其他制品';
    if (lowered.includes('helm')) {
      reason = '项目下仍有 Helm Chart';
    } else if (lowered.includes('repository') || lowered.includes('not empty') || lowered.includes('empty')) {
      reason = '项目下仍有镜像仓库';
    }
    return {
      httpStatus: 412,
      message: `无法删除项目「${projectName}」：${reason}。请先进入该项目，删除全部仓库与镜像后再试。`,
    };
  }

  if (harborStatus === 403) {
    return { httpStatus: 403, message: `无权限删除项目「${projectName}」` };
  }
  if (harborStatus === 404) {
    return { httpStatus: 404, message: `项目「${projectName}」不存在或已被删除` };
  }

  return {
    httpStatus: harborStatus >= 400 && harborStatus < 600 ? harborStatus : 500,
    message: harborDetail
      ? `删除项目「${projectName}」失败：${harborDetail}`
      : `删除项目「${projectName}」失败`,
  };
}

const router = Router();

router.use('/registries/:id', harborRegistryCloudAccessMiddleware);

/**
 * 转换 Harbor scan_overview 格式为前端期望的格式
 * Harbor API 返回格式：
 * {
 *   "application/vnd.scanner.adapter.vuln.report.harbor+json; version=1.0": {
 *     "scan_status": "Success",
 *     "severity": "High",
 *     "summary": {
 *       "total": 10,
 *       "fixable": 5,
 *       "summary": [{"severity": "Critical", "count": 2}, ...]
 *     }
 *   }
 * }
 * 前端期望格式：
 * {
 *   "total": 10,
 *   "fixable": 5,
 *   "summary": { "critical": 2, "high": 3, "medium": 3, "low": 2 }
 * }
 */
const transformScanOverview = (scanOverview: any): any => {
  if (!scanOverview) return undefined;

  const keys = Object.keys(scanOverview);
  if (keys.length === 0) return undefined;

  // 匹配多种可能的 report key 格式
  const reportKey = keys.find(
    (k) =>
      k.includes('vuln.report') ||
      k.includes('scanner.adapter') ||
      k.includes('security.vulnerability.report'),
  );

  if (!reportKey) return undefined;

  const report = scanOverview[reportKey];
  if (!report) return undefined;

  // 检查扫描状态
  if (report.scan_status && report.scan_status !== 'Success' && report.scan_status !== 'Finished') {
    return undefined;
  }

  const summaryData = report.summary;
  if (!summaryData) return undefined;

  const result: any = {
    total: summaryData.total || 0,
    fixable: summaryData.fixable || 0,
    summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  };

  // summary.summary 可能是数组或对象
  if (Array.isArray(summaryData.summary)) {
    for (const item of summaryData.summary) {
      const severity = (item.severity || '').toLowerCase();
      const count = item.count || 0;
      if (severity === 'critical') result.summary.critical = count;
      else if (severity === 'high') result.summary.high = count;
      else if (severity === 'medium') result.summary.medium = count;
      else if (severity === 'low') result.summary.low = count;
    }
  } else if (typeof summaryData.summary === 'object') {
    // 对象格式: {Critical: 2, High: 11, Medium: 7}
    for (const [severity, count] of Object.entries(summaryData.summary)) {
      const s = severity.toLowerCase();
      if (s === 'critical') result.summary.critical = count as number;
      else if (s === 'high') result.summary.high = count as number;
      else if (s === 'medium') result.summary.medium = count as number;
      else if (s === 'low') result.summary.low = count as number;
    }
  }

  return result;
};

/**
 * 获取 HarborProxyService 实例
 */
const getHarborService = (
  req: HarborScopedRequest,
): { harbor: HarborRegistry; service: HarborProxyService } | null => {
  const harbor = req.harborRegistry;
  if (!harbor) {
    return null;
  }

  const service = HarborProxyService.getInstance(harbor);
  return { harbor, service };
};

/**
 * 获取项目列表
 * GET /api/harbor/registries/:id/projects
 * 
 * 用户体系对接逻辑：
 * 1. 系统管理员 → 返回所有项目
 * 2. 租户用户 → 返回公共项目 + 本租户私有项目
 * 3. 从 HarborProjectBinding 查询租户归属信息
 * 4. 合并 Harbor API 返回的项目信息 + 本地绑定信息
 */
router.get('/registries/:id/projects', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { page, pageSize, name, public: isPublic } = req.query;

    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;
    const userRole = (req.user as any)?.role;
    const isSystemAdmin = userRole === 'super_admin' || userRole === 'admin';
    const isTenantUser = (req.user as any)?.isTenantUser || !!(req.user as any)?.tenantId;
    const isBuiltIn = (harbor as any).isBuiltIn === true;

    // 权限校验：
    // 1. 系统管理员：检查 RBAC 权限
    // 2. 租户用户：平台内置 Harbor 允许访问，外部 Harbor 需要 RBAC 权限
    if (isSystemAdmin) {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.project:read')) {
        return res.status(403).json({ message: '权限不足' });
      }
    } else if (isTenantUser) {
      // 租户用户访问外部 Harbor 需要 RBAC 权限
      if (!isBuiltIn) {
        const perms: string[] = Array.isArray((req.user as any)?.permissions)
          ? (req.user as any).permissions
          : [];
        if (!checkPermission(perms, 'harbor.project:read')) {
          return res.status(403).json({ message: '权限不足' });
        }
      }
      // 平台内置 Harbor，租户用户可以访问（项目级别隔离在后续过滤中实现）
    } else {
      harborLog.warn('[项目列表] 用户角色不明确');
      return res.status(403).json({ message: '权限不足' });
    }

    // 获取 Harbor API 项目列表
    const projects = await service.getProjects({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      name: name ? String(name) : undefined,
      public: isPublic !== undefined ? isPublic === 'true' : undefined,
    });

    // 获取所有项目的绑定信息
    const bindingRepo = AppDataSource.getRepository(HarborProjectBinding);
    const bindings = await bindingRepo.find({
      where: { harborRegistryId: harbor.id },
    });

    // 构建项目ID到绑定信息的映射
    const bindingMap = new Map<number, HarborProjectBinding>();
    for (const binding of bindings) {
      bindingMap.set(binding.projectId, binding);
    }

    // 过滤项目（仅对平台内置 Harbor）
    let filteredProjects = projects;
    if (isBuiltIn && !isSystemAdmin) {
      const tenantId = (req.user as any)?.tenantId;
      filteredProjects = projects.filter((p: any) => {
        const binding = bindingMap.get(p.project_id);
        // Harbor API 返回的公开状态可能在 p.public 或 p.metadata.public
        // metadata.public 的值是字符串 "true" 或 "false"
        const publicFromMeta = p.metadata?.public === 'true' || p.metadata?.public === true;
        const publicFromRoot = p.public === true || p.public === 1 || p.public === 'true';
        const isPublic = publicFromMeta || publicFromRoot;
        const isTenantProject = binding && binding.tenantId === tenantId;
        // 公共项目，或本租户的私有项目
        return isPublic || isTenantProject;
      });
    }

    // 查询租户名称
    const tenantIds = Array.from(new Set(bindings.map((b) => b.tenantId).filter(Boolean)));
    const tenantRepo = AppDataSource.getRepository(Tenant);
    const tenants = await tenantRepo.find({
      where: tenantIds.map((id) => ({ id })),
    });
    const tenantMap = new Map<string, string>();
    for (const tenant of tenants) {
      tenantMap.set(tenant.id, tenant.name);
    }

    // 转换字段名：snake_case -> camelCase，并附加绑定信息
    const transformedProjects = filteredProjects.map((p: any) => {
      const binding = bindingMap.get(p.project_id);
      return {
        projectId: p.project_id,
        name: p.name,
        public: p.public,
        ownerName: p.owner_name,
        repoCount: p.repo_count,
        metadata: p.metadata,
        createdAt: p.creation_time,
        updatedAt: p.update_time,
        // 直接返回租户信息（前端需要）
        tenantId: binding?.tenantId,
        tenantName: binding?.tenantId ? tenantMap.get(binding.tenantId) : undefined,
        // 判断当前用户是否为项目创建者
        isOwner: binding?.createdBy === (req.user as any)?.id,
        // 附加绑定信息
        binding: binding
          ? {
              id: binding.id,
              tenantId: binding.tenantId,
              createdBy: binding.createdBy,
              createdByType: binding.createdByType,
              visibility: binding.visibility,
            }
          : null,
      };
    });

    res.json({ message: '查询成功', data: transformedProjects });
  } catch (error: any) {
    harborLog.error('获取项目列表失败:', error.message);
    res.status(500).json({ message: '获取项目列表失败', error: error.message });
  }
});

/**
 * 创建项目
 * POST /api/harbor/registries/:id/projects
 * 
 * 用户体系对接逻辑：
 * 1. 判断 Harbor 实例是否为平台内置（harbor.isBuiltIn）
 * 2. 内置 Harbor：系统管理员可创建公共项目，租户用户只能创建私有项目
 * 3. 创建 HarborProjectBinding 记录，关联租户
 * 4. 自动添加创建者为项目管理员（role_id=4）
 * 5. 如果是组织用户创建，同时添加租户管理员为项目管理员
 */
router.post('/registries/:id/projects', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { project_name, public: isPublic, metadata } = req.body;

    if (!project_name) {
      return res.status(400).json({ message: '缺少必填字段: project_name' });
    }

    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;

    // 判断是否为平台内置 Harbor
    const isBuiltIn = (harbor as any).isBuiltIn === true;
    const userRole = (req.user as any)?.role;
    const isSystemAdmin = userRole === 'super_admin' || userRole === 'admin';
    const isTenantUser = (req.user as any)?.isTenantUser || !!(req.user as any)?.tenantId;

    // 权限校验：
    // 1. 系统管理员：检查 RBAC 权限
    // 2. 租户用户：平台内置 Harbor 允许创建，外部 Harbor 需要 RBAC 权限
    if (isSystemAdmin) {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.project:create')) {
        return res.status(403).json({ message: '权限不足' });
      }
    } else if (isTenantUser) {
      // 租户用户访问外部 Harbor 需要 RBAC 权限
      if (!isBuiltIn) {
        const perms: string[] = Array.isArray((req.user as any)?.permissions)
          ? (req.user as any).permissions
          : [];
        if (!checkPermission(perms, 'harbor.project:create')) {
          return res.status(403).json({ message: '权限不足' });
        }
      }
      // 平台内置 Harbor，租户用户可以创建项目
    } else {
      return res.status(403).json({ message: '权限不足' });
    }

    let publicValue = parseHarborPublicValue(isPublic);
    let bindingRecord: HarborProjectBinding | null = null;

    // 平台内置 Harbor：执行用户体系对接逻辑
    if (isBuiltIn) {
      // 租户用户只能创建私有项目
      if (!isSystemAdmin) {
        publicValue = false;
        harborLog.info(`[项目创建] 租户用户创建项目，强制设为私有: user=${(req.user as any)?.id}, project=${project_name}`);
      }

      // 创建项目
      const project = await service.createProject({
        project_name,
        public: publicValue,
        metadata: {
          ...metadata,
          public: publicValue ? 'true' : 'false',
        },
      });

      // Harbor API 创建项目后可能不返回完整对象，需要查询获取 project_id
      let projectId = project?.project_id || project?.projectId;
      if (!projectId) {
        // 查询刚创建的项目
        const createdProject = await service.getProject(project_name);
        projectId = createdProject?.project_id || createdProject?.projectId;
      }

      if (!projectId) {
        throw new Error('无法获取项目 ID');
      }

      // 创建绑定记录
      const bindingRepo = AppDataSource.getRepository(HarborProjectBinding);
      bindingRecord = bindingRepo.create({
        harborRegistryId: harbor.id,
        projectId: projectId,
        projectName: project_name,
        tenantId: isSystemAdmin ? undefined : (req.user as any)?.tenantId,
        createdBy: (req.user as any)?.id,
        createdByType: isSystemAdmin ? HarborProjectCreatorType.SYSTEM : HarborProjectCreatorType.TENANT,
        visibility: publicValue ? HarborProjectVisibility.PUBLIC : HarborProjectVisibility.PRIVATE,
      });
      await bindingRepo.save(bindingRecord);

      harborLog.info(
        `[项目绑定] 创建绑定记录: bindingId=${bindingRecord.id}, tenantId=${bindingRecord.tenantId}, visibility=${bindingRecord.visibility}`,
      );

      // 添加创建者为项目管理员（role_id=4）
      try {
        // 如果是租户用户，需要先获取或创建 Harbor 用户映射
        if (!isSystemAdmin) {
          const tenantUserRepo = AppDataSource.getRepository(TenantUser);
          const creator = await tenantUserRepo.findOne({
            where: { id: (req.user as any)?.id },
          });

          if (creator) {
            const mapping = await HarborUserService.getOrCreateMapping({
              harborRegistryId: harbor.id,
              tenantUser: creator,
            });

            // 添加为项目管理员（role_id=1，Harbor API 的 role_id 含义与文档相反）
            await service.addProjectMember(projectId, {
              member_name: mapping.harborUsername,
              member_group: false,
              role_id: 1, // 项目管理员（实际测试发现：发送 1 得到项目管理员，发送 5 得到受限访客）
            });

            harborLog.info(
              `[项目管理员] 添加创建者为管理员成功: project=${project_name}, harborUser=${mapping.harborUsername}`,
            );

            // 如果是组织用户创建，同时添加租户管理员为项目管理员
            if (creator.organizationId) {
              const orgRepo = AppDataSource.getRepository(Organization);
              const org = await orgRepo.findOne({
                where: { id: creator.organizationId },
              });

              if (org) {
                // 查找租户管理员（role='admin'）
                const tenantAdmins = await tenantUserRepo.find({
                  where: {
                    tenantId: creator.tenantId,
                    role: 'admin',
                    status: 'active',
                  },
                });

                for (const admin of tenantAdmins) {
                  // 跳过创建者自己
                  if (admin.id === creator.id) continue;

                  const adminMapping = await HarborUserService.getOrCreateMapping({
                    harborRegistryId: harbor.id,
                    tenantUser: admin,
                  });

                  await service.addProjectMember(projectId, {
                    member_name: adminMapping.harborUsername,
                    member_group: false,
                    role_id: 1, // 项目管理员
                  });

                  harborLog.info(
                    `[项目管理员] 添加租户管理员为管理员: project=${project_name}, admin=${admin.username}, harborUser=${adminMapping.harborUsername}`,
                  );
                }
              }
            }
          }
        } else {
          // 系统管理员创建公共项目，使用 Harbor 配置中的管理员账号（已经是项目管理员）
          harborLog.info(`[项目管理员] 系统管理员创建项目，自动成为管理员: project=${project_name}`);
        }
      } catch (adminError: any) {
        // 添加管理员失败不影响项目创建
        harborLog.error(`[项目管理员] 添加项目管理员失败: ${adminError.message}`, {
          error: adminError.message,
          projectId,
          projectName: project_name,
        });
      }

      harborLog.info(`创建项目: harbor=${id}, project=${project_name}, builtIn=true`);
      res.status(201).json({
        message: '创建成功',
        data: project,
        binding: bindingRecord,
      });
    } else {
      // 用户自建 Harbor：直接创建项目
      const project = await service.createProject({
        project_name,
        public: publicValue,
        metadata: {
          ...metadata,
          public: publicValue ? 'true' : 'false',
        },
      });

      harborLog.info(`创建项目: harbor=${id}, project=${project_name}, builtIn=false`);
      res.status(201).json({ message: '创建成功', data: project });
    }
  } catch (error: any) {
    harborLog.error('创建项目失败:', error.message);
    res.status(500).json({ message: '创建项目失败', error: error.message });
  }
});

/**
 * 获取项目详情
 * GET /api/harbor/registries/:id/projects/:name
 */
router.get('/registries/:id/projects/:name', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;
    const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:read');
    if (!allowed) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

    const project = await result.service.getProject(harborProjectRef, projectRef);

    // 获取当前用户在该项目中的角色
    let currentUserRole: number | undefined;
    try {
      const members = await service.getProjectMembers(harborProjectRef);
      const currentUserId = (req.user as any)?.id;
      const isTenantUser = (req.user as any)?.isTenantUser || !!(req.user as any)?.tenantId;

      // 如果是租户用户，查找对应的 Harbor 用户映射
      if (isTenantUser && currentUserId) {
        const mappingRepo = AppDataSource.getRepository(HarborUserMapping);
        const mapping = await mappingRepo.findOne({
          where: { harborRegistryId: harbor.id, tenantUserId: currentUserId },
        });

        if (mapping) {
          const member = members.find((m: any) => m.entity_name === mapping.harborUsername);
          if (member) {
            currentUserRole = member.role_id;
          } else {
            harborLog.warn('[项目详情] 未在成员列表中找到用户');
          }
        } else {
          harborLog.warn('[项目详情] 未找到用户映射');
        }
      } else {
        // 系统管理员，查找 admin 用户
        const member = members.find((m: any) => m.entity_name === 'admin');
        if (member) {
          currentUserRole = member.role_id;
        }
      }
    } catch (err: any) {
      harborLog.warn('[项目详情] 获取当前用户角色失败:', err?.message);

      // 临时解决方案：如果获取角色失败，从项目绑定记录中判断是否为项目创建者
      try {
        const bindingRepo = AppDataSource.getRepository(HarborProjectBinding);
        const binding = await bindingRepo.findOne({
          where: {
            harborRegistryId: harbor.id,
            projectId: project.project_id,
          },
        });

        if (binding && binding.createdBy === (req.user as any)?.id) {
          currentUserRole = 1; // 项目管理员
          harborLog.info('[项目详情] 从绑定记录推断角色: 项目创建者 = 项目管理员');
        }
      } catch (fallbackErr: any) {
        harborLog.warn('[项目详情] 回退逻辑失败:', fallbackErr?.message);
      }
    }

    // 转换字段名：snake_case -> camelCase
    const transformedProject = {
      projectId: project.project_id,
      name: project.name,
      public: project.public,
      ownerName: project.owner_name,
      repoCount: project.repo_count,
      metadata: project.metadata,
      createdAt: project.creation_time,
      updatedAt: project.update_time,
      currentUserRole,
    };

    res.json({ message: '查询成功', data: transformedProject });
  } catch (error: any) {
    const status = Number(error?.response?.status);
    if (status === 404) {
      return res.status(404).json({ message: '项目不存在或已被删除' });
    }
    harborLog.error('获取项目详情失败:', error.message);
    res.status(500).json({ message: '获取项目详情失败', error: error.message });
  }
});

/**
 * 删除项目
 * DELETE /api/harbor/registries/:id/projects/:name
 */
router.delete('/registries/:id/projects/:name', async (req: AuthRequest, res: Response) => {
  const { projectRef: pathProjectRef } = resolveHarborProjectRef(req);
  try {
    const { id } = req.params;

    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;
    const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:delete');
    if (!allowed) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

    await result.service.deleteProject(harborProjectRef);

    // 删除本地缓存（按名称或 projectId 匹配）
    const projectRepo = AppDataSource.getRepository(HarborProject);
    const localRows = await projectRepo.find({ where: { harborId: id } });
    const localMatch = localRows.find(
      (row) =>
        row.name === projectRef ||
        row.name === harborProjectRef ||
        String(row.projectId ?? '') === harborProjectRef,
    );
    if (localMatch) {
      await projectRepo.delete({ id: localMatch.id });
    } else {
      await projectRepo.delete({ harborId: id, name: projectRef });
    }

    harborLog.info(`删除项目: harbor=${id}, ref=${harborProjectRef}`);
    res.json({ message: '删除成功' });
  } catch (error: any) {
    const { httpStatus, message: userMessage } = resolveHarborDeleteProjectError(error, pathProjectRef);
    harborLog.error(`删除项目失败: ${userMessage}`, error?.response?.data ?? error.message);
    res.status(httpStatus).json({ message: userMessage, error: error.message });
  }
});

/**
 * 获取项目统计摘要
 * GET /api/harbor/registries/:id/projects/:name/summary
 */
router.get('/registries/:id/projects/:name/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;
    const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:read');
    if (!allowed) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

    const summary = await result.service.getProjectSummary(harborProjectRef);

    // Harbor summary API 不返回制品数量，需要遍历仓库计算
    let totalArtifacts = 0;
    let totalPulls = 0;
    try {
      const repositories = await result.service.getRepositories(harborProjectRef, {
        pageSize: 100,
        ...buildHarborProjectContext(projectRef, harborProjectRef),
      });
      for (const repo of repositories) {
        totalArtifacts += repo.artifact_count || 0;
        totalPulls += repo.pull_count || 0;
      }
    } catch (calcError) {
      harborLog.warn('计算制品数量失败:', calcError);
    }

    // 转换字段名：snake_case -> camelCase
    const transformedSummary = {
      projectId: summary.project_id,
      projectName: summary.project_name,
      repoCount: summary.repo_count ?? 0,
      artifactCount: totalArtifacts,
      storageSize: summary.storage_size || summary.total_storage || 0,
      pullCount: totalPulls,
    };

    res.json({ message: '查询成功', data: transformedSummary });
  } catch (error: any) {
    harborLog.error('获取项目摘要失败:', error.message);
    res.status(500).json({ message: '获取项目摘要失败', error: error.message });
  }
});

/**
 * 获取项目成员列表
 * GET /api/harbor/registries/:id/projects/:name/members
 * 
 * 用户体系对接逻辑：
 * 1. 调用 Harbor API 获取成员列表
 * 2. 关联 HarborUserMapping 获取 Tower 用户信息
 * 3. 关联 TenantUser 和 Organization 获取用户详情（真实姓名、组织等）
 * 4. 返回包含 Tower 用户信息的成员列表
 */
router.get('/registries/:id/projects/:name/members', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;
    const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:read');
    if (!allowed) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

    harborLog.info(
      `获取项目成员: harbor=${id}, project=${projectRef}, harbor_user=${harbor.username}, url=${harbor.url}, pwd_len=${harbor.password?.length}`,
    );

    // 先测试基本 API 是否正常，打印完整响应
    try {
      const axiosResponse = await service.axiosInstance.get('/api/v2.0/systeminfo');
      harborLog.info(
        `系统信息完整响应: status=${axiosResponse.status}, data_keys=${Object.keys(axiosResponse.data || {}).join(',')}`,
      );
    } catch (sysErr: any) {
      harborLog.error(`系统信息失败: ${sysErr.message}, status=${sysErr.response?.status}`);
    }

    try {
      const members = await service.getProjectMembers(harborProjectRef);

      // 判断是否为平台内置 Harbor
      const isBuiltIn = (harbor as any).isBuiltIn === true;

      // 如果是内置 Harbor，关联 Tower 用户信息
      if (isBuiltIn) {
        const mappingRepo = AppDataSource.getRepository(HarborUserMapping);
        const tenantUserRepo = AppDataSource.getRepository(TenantUser);
        const orgRepo = AppDataSource.getRepository(Organization);

        // 转换字段名并关联 Tower 用户信息
        const transformedMembers = await Promise.all(
          members.map(async (member: any) => {
            const harborUserId = member.user_id || member.id;
            const harborUsername = member.entity_name || member.username;

            // 查询用户映射
            const mapping = await mappingRepo.findOne({
              where: {
                harborRegistryId: harbor.id,
                harborUsername,
              },
            });

            let towerUserInfo = null;
            if (mapping) {
              // 查询租户用户信息
              const tenantUser = await tenantUserRepo.findOne({
                where: { id: mapping.tenantUserId },
              });

              if (tenantUser) {
                // 查询组织信息
                const organization = tenantUser.organizationId
                  ? await orgRepo.findOne({
                      where: { id: tenantUser.organizationId },
                    })
                  : null;

                towerUserInfo = {
                  id: tenantUser.id,
                  username: tenantUser.username,
                  fullName: tenantUser.fullName,
                  email: tenantUser.email,
                  role: tenantUser.role,
                  organization: organization
                    ? {
                        id: organization.id,
                        name: organization.name,
                        level: organization.level,
                      }
                    : null,
                };
              }
            }

            return {
              id: harborUserId,
              entityName: harborUsername,
              entityType: member.entity_type || 'u',
              roleName: member.role_name,
              roleId: member.role_id,
              projectName: member.project_name,
              // 附加 Tower 用户信息
              towerUser: towerUserInfo,
            };
          }),
        );

        res.json({ message: '查询成功', data: transformedMembers });
      } else {
        // 用户自建 Harbor：仅返回 Harbor 成员信息
        const transformedMembers = members.map((member: any) => ({
          id: member.user_id || member.id,
          entityName: member.entity_name || member.username,
          entityType: member.entity_type || 'u',
          roleName: member.role_name,
          roleId: member.role_id,
          projectName: member.project_name,
        }));

        res.json({ message: '查询成功', data: transformedMembers });
      }
    } catch (memberError: any) {
      harborLog.error(
        `获取项目成员失败: ${memberError.message}, status=${memberError.response?.status}, data=${JSON.stringify(memberError.response?.data)}`,
      );
      // Harbor 401/403 表示用户无权限查看该项目成员
      if (memberError.response?.status === 401 || memberError.response?.status === 403) {
        return res.json({
          message:
            '提示：当前 Harbor 用户无权限查看项目成员，可能原因：\n1. 用户密码已修改\n2. 用户权限不足\n\n请检查 Harbor 配置中的用户凭证是否正确',
          data: [],
        });
      }
      throw memberError;
    }
  } catch (error: any) {
    harborLog.error('获取项目成员失败:', error.message);
    res.status(500).json({ message: '获取项目成员失败', error: error.message });
  }
});

/**
 * 添加项目成员
 * POST /api/harbor/registries/:id/projects/:name/members
 * 
 * 用户体系对接逻辑：
 * 1. 接收 Tower 用户 ID（tenantUserId）+ Harbor 密码（首次添加时）+ 角色ID
 * 2. 校验 Harbor 实例是否为平台内置（用户自建 Harbor 返回错误提示）
 * 3. 校验当前用户是否为项目管理员
 * 4. 校验目标用户是否属于当前租户
 * 5. 调用 HarborUserService.getOrCreateMapping 获取或创建 Harbor 用户
 * 6. 调用 Harbor API 添加项目成员
 */
router.post('/registries/:id/projects/:name/members', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { tenantUserId, password, role, memberName, memberId } = req.body;

    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;
    const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:update');
    if (!allowed) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

    // 判断是否为平台内置 Harbor
    const isBuiltIn = (harbor as any).isBuiltIn === true;

    if (isBuiltIn) {
      // 平台内置 Harbor：必须使用 Tower 用户 ID
      if (!tenantUserId) {
        return res.status(400).json({
          message: '平台内置 Harbor 需要提供 tenantUserId 参数',
        });
      }

      // 获取目标用户信息
      const tenantUserRepo = AppDataSource.getRepository(TenantUser);
      const targetUser = await tenantUserRepo.findOne({
        where: { id: tenantUserId },
      });

      if (!targetUser) {
        return res.status(404).json({ message: '目标用户不存在' });
      }

      // 校验目标用户是否属于当前租户
      const userRole = (req.user as any)?.role;
      const isSystemAdmin = userRole === 'super_admin' || userRole === 'admin';
      const currentTenantId = (req.user as any)?.tenantId;

      if (!isSystemAdmin && targetUser.tenantId !== currentTenantId) {
        return res.status(403).json({ message: '无法为其他租户的用户添加项目成员' });
      }

      // 获取或创建 Harbor 用户映射
      const mapping = await HarborUserService.getOrCreateMapping({
        harborRegistryId: harbor.id,
        tenantUser: targetUser,
        password, // 首次添加时提供的密码
      });

      // 添加项目成员
      if (!role) {
        return res.status(400).json({ message: '缺少必填字段: role' });
      }

      await service.addProjectMember(harborProjectRef, {
        member_name: mapping.harborUsername,
        member_group: false,
        role_id: role,
      });

      harborLog.info(
        `[成员添加] 内置 Harbor: project=${harborProjectRef}, tenantUser=${targetUser.username}, harborUser=${mapping.harborUsername}, role=${role}`,
      );

      res.status(201).json({
        message: '添加成功',
        data: {
          harborUsername: mapping.harborUsername,
          tenantUserId: targetUser.id,
          tenantUsername: targetUser.username,
          roleId: role,
        },
      });
    } else {
      // 用户自建 Harbor：直接使用 Harbor 用户名
      if (!role) {
        return res.status(400).json({ message: '缺少必填字段: role' });
      }

      await service.addProjectMember(harborProjectRef, {
        member_name: memberName,
        member_group: false,
        role_id: role,
      });

      harborLog.info(
        `[成员添加] 自建 Harbor: project=${harborProjectRef}, member=${memberName || memberId}`,
      );
      res.status(201).json({ message: '添加成功' });
    }
  } catch (error: any) {
    harborLog.error('添加项目成员失败:', error.message);
    res.status(500).json({ message: '添加项目成员失败', error: error.message });
  }
});

/**
 * 删除项目成员
 * DELETE /api/harbor/registries/:id/projects/:name/members/:memberId
 */
router.delete(
  '/registries/:id/projects/:name/members/:memberId',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, memberId } = req.params;
      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:update');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      await result.service.deleteProjectMember(harborProjectRef, Number(memberId));

      harborLog.info(`删除项目成员: harbor=${id}, project=${projectRef}, member=${memberId}`);
      res.json({ message: '删除成功' });
    } catch (error: any) {
      harborLog.error('删除项目成员失败:', error.message);
      res.status(500).json({ message: '删除项目成员失败', error: error.message });
    }
  },
);

/**
 * 获取项目下的仓库列表
 * GET /api/harbor/registries/:id/projects/:project/repositories
 */
router.get(
  '/registries/:id/projects/:project/repositories',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { page, pageSize, q } = req.query;

      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.repository:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      const repositories = await result.service.getRepositories(harborProjectRef, {
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        q: q ? String(q) : undefined,
        ...buildHarborProjectContext(projectRef, harborProjectRef),
      });

      // 转换字段名：snake_case -> camelCase
      const transformedRepos = repositories.map((r: any) => ({
        id: r.id,
        name: r.name,
        projectId: r.project_id,
        artifactCount: r.artifact_count,
        pullCount: r.pull_count,
        createdAt: r.creation_time,
        updatedAt: r.update_time,
      }));

      res.json({ message: '查询成功', data: transformedRepos });
    } catch (error: any) {
      harborLog.error('获取仓库列表失败:', error.message);
      res.status(500).json({ message: '获取仓库列表失败', error: error.message });
    }
  },
);

/**
 * 获取单个仓库详情
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo
 */
router.get(
  '/registries/:id/projects/:project/repositories/:repo',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo } = req.params;
      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.repository:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      const repository = await result.service.getRepository(
        harborProjectRef,
        decodedRepo,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      // 转换字段名：snake_case -> camelCase
      const transformedRepo = {
        id: repository.id,
        name: repository.name,
        projectId: repository.project_id,
        artifactCount: repository.artifact_count,
        pullCount: repository.pull_count,
        createdAt: repository.creation_time,
        updatedAt: repository.update_time,
      };

      res.json({ message: '查询成功', data: transformedRepo });
    } catch (error: any) {
      harborLog.error('获取仓库详情失败:', error.message);
      res.status(500).json({ message: '获取仓库详情失败', error: error.message });
    }
  },
);

/**
 * 删除仓库
 * DELETE /api/harbor/registries/:id/projects/:project/repositories/:repo
 */
router.delete(
  '/registries/:id/projects/:project/repositories/:repo',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo } = req.params;
      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.repository:delete');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      await result.service.deleteRepository(
        harborProjectRef,
        decodedRepo,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      harborLog.info(`删除仓库: harbor=${id}, project=${projectRef}, repo=${decodedRepo}`);
      res.json({ message: '删除成功' });
    } catch (error: any) {
      harborLog.error('删除仓库失败:', error.message);
      res.status(500).json({ message: '删除仓库失败', error: error.message });
    }
  },
);

/**
 * 获取制品列表
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts
 */
router.get(
  '/registries/:id/projects/:project/repositories/:repo/artifacts',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo } = req.params;
      const { page, pageSize, q, withTag, withLabel, withScanOverview } = req.query;

      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.artifact:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      const artifacts = await result.service.getArtifacts(harborProjectRef, decodedRepo, {
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        q: q ? String(q) : undefined,
        withTag: withTag !== 'false',
        withLabel: withLabel !== 'false',
        withScanOverview: withScanOverview !== 'false',
        ...buildHarborProjectContext(projectRef, harborProjectRef),
      });

      // 转换字段名：snake_case -> camelCase
      const transformedArtifacts = artifacts.map((artifact: any) => ({
        ...artifact,
        pushTime: artifact.push_time,
        pullTime: artifact.pull_time,
        scanOverview: transformScanOverview(artifact.scan_overview),
        extraAttrs: artifact.extra_attrs,
      }));

      res.json({ message: '查询成功', data: transformedArtifacts });
    } catch (error: any) {
      harborLog.error('获取制品列表失败:', error.message);
      res.status(500).json({ message: '获取制品列表失败', error: error.message });
    }
  },
);

/**
 * 获取制品详情
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref
 */
router.get(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo, ref } = req.params;
      const {
        withTag: _withTag,
        withLabel: _withLabel,
        withScanOverview: _withScanOverview,
      } = req.query;

      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.artifact:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      const artifact = await result.service.getArtifact(
        harborProjectRef,
        decodedRepo,
        ref,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      // 转换字段名：snake_case -> camelCase
      const transformedArtifact = {
        ...artifact,
        pushTime: artifact.push_time,
        pullTime: artifact.pull_time,
        scanOverview: transformScanOverview(artifact.scan_overview),
        extraAttrs: artifact.extra_attrs,
      };

      res.json({ message: '查询成功', data: transformedArtifact });
    } catch (error: any) {
      harborLog.error('获取制品详情失败:', error.message);
      res.status(500).json({ message: '获取制品详情失败', error: error.message });
    }
  },
);

/**
 * 删除制品
 * DELETE /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref
 */
router.delete(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo, ref } = req.params;
      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.artifact:delete');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      await result.service.deleteArtifact(
        harborProjectRef,
        decodedRepo,
        ref,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      harborLog.info(`删除制品: harbor=${id}, project=${projectRef}, repo=${decodedRepo}, ref=${ref}`);
      res.json({ message: '删除成功' });
    } catch (error: any) {
      harborLog.error('删除制品失败:', error.message);
      res.status(500).json({ message: '删除制品失败', error: error.message });
    }
  },
);

/**
 * 获取制品标签列表
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags
 */
router.get(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo, ref } = req.params;
      const { page: _page, pageSize: _pageSize } = req.query;

      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.artifact:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      const tags = await result.service.getTags(
        harborProjectRef,
        decodedRepo,
        ref,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      // 转换字段名：snake_case -> camelCase
      const transformedTags = tags.map((tag: any) => ({
        id: tag.id,
        name: tag.name,
        pushTime: tag.push_time,
        pullTime: tag.pull_time,
        digest: tag.digest,
        artifactId: tag.artifact_id,
      }));

      res.json({ message: '查询成功', data: transformedTags });
    } catch (error: any) {
      harborLog.error('获取标签列表失败:', error.message);
      res.status(500).json({ message: '获取标签列表失败', error: error.message });
    }
  },
);

/**
 * 创建制品标签
 * POST /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags
 */
router.post(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo, ref } = req.params;
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ message: '缺少必填字段: name' });
      }

      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.artifact:update');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      await result.service.createTag(
        harborProjectRef,
        decodedRepo,
        ref,
        name,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      harborLog.info(
        `创建标签: harbor=${id}, project=${projectRef}, repo=${decodedRepo}, ref=${ref}, tag=${name}`,
      );
      res.status(201).json({ message: '创建成功' });
    } catch (error: any) {
      harborLog.error('创建标签失败:', error.message);
      res.status(500).json({ message: '创建标签失败', error: error.message });
    }
  },
);

/**
 * 删除制品标签
 * DELETE /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags/:tag
 */
router.delete(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags/:tag',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo, ref, tag } = req.params;
      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.artifact:update');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      await result.service.deleteTag(
        harborProjectRef,
        decodedRepo,
        ref,
        tag,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      harborLog.info(
        `删除标签: harbor=${id}, project=${projectRef}, repo=${decodedRepo}, ref=${ref}, tag=${tag}`,
      );
      res.json({ message: '删除成功' });
    } catch (error: any) {
      harborLog.error('删除标签失败:', error.message);
      res.status(500).json({ message: '删除标签失败', error: error.message });
    }
  },
);

/**
 * 获取镜像选择器项目列表（简化版）
 * GET /api/harbor/registries/:id/selector/projects
 */
router.get('/registries/:id/selector/projects', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = getHarborService(req);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor, service } = result;
    const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:read');
    if (!allowed) {
      return res.status(403).json({ message: '权限不足' });
    }

    const projects = await service.getProjects({ pageSize: 100 });

    // 简化返回格式
    const simplified = projects.map((p: any) => ({
      name: p.name,
      projectId: p.project_id,
      repoCount: p.repo_count,
    }));

    res.json({ message: '查询成功', data: simplified });
  } catch (error: any) {
    harborLog.error('获取选择器项目列表失败:', error.message);
    res.status(500).json({ message: '获取选择器项目列表失败', error: error.message });
  }
});

/**
 * 获取镜像选择器仓库列表（简化版）
 * GET /api/harbor/registries/:id/selector/projects/:project/repositories
 */
router.get(
  '/registries/:id/selector/projects/:project/repositories',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.repository:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      const repositories = await result.service.getRepositories(harborProjectRef, {
        pageSize: 100,
        ...buildHarborProjectContext(projectRef, harborProjectRef),
      });

      // 简化返回格式（移除仓库名中的项目前缀）
      const simplified = repositories.map((r: any) => {
        // Harbor 返回的仓库名格式为 "project/repository"，需要移除项目前缀
        let repoName = r.name;
        if (repoName.startsWith(`${projectRef}/`)) {
          repoName = repoName.substring(projectRef.length + 1);
        }
        return {
          name: repoName,
          artifactCount: r.artifact_count,
          pullCount: r.pull_count,
        };
      });

      res.json({ message: '查询成功', data: simplified });
    } catch (error: any) {
      harborLog.error('获取选择器仓库列表失败:', error.message);
      res.status(500).json({ message: '获取选择器仓库列表失败', error: error.message });
    }
  },
);

/**
 * 获取镜像选择器标签列表（简化版）
 * GET /api/harbor/registries/:id/selector/projects/:project/repositories/:repo/tags
 */
router.get(
  '/registries/:id/selector/projects/:project/repositories/:repo/tags',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo } = req.params;
      const result = getHarborService(req);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.artifact:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      // 解码仓库名称（可能包含斜杠）
      const decodedRepo = decodeURIComponent(repo);

      // 获取所有制品及其标签
      const artifacts = await result.service.getArtifacts(harborProjectRef, decodedRepo, {
        pageSize: 100,
        withTag: true,
        ...buildHarborProjectContext(projectRef, harborProjectRef),
      });

      // 提取所有标签
      const tags: any[] = [];
      for (const artifact of artifacts) {
        if (artifact.tags) {
          for (const tag of artifact.tags) {
            tags.push({
              name: tag.name,
              digest: artifact.digest,
              pushTime: tag.push_time,
              pullTime: tag.pull_time,
            });
          }
        }
      }

      res.json({ message: '查询成功', data: tags });
    } catch (error: any) {
      harborLog.error('获取选择器标签列表失败:', error.message);
      res.status(500).json({ message: '获取选择器标签列表失败', error: error.message });
    }
  },
);

/**
 * 更新项目成员角色
 * PUT /api/harbor/registries/:id/projects/:name/members/:memberId
 * 
 * 权限：harbor.project:update
 * 逻辑：调用 HarborProxyService.updateProjectMemberRole
 */
router.put(
  '/registries/:id/projects/:name/members/:memberId',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, memberId } = req.params;
      const { roleId } = req.body;

      if (!roleId) {
        return res.status(400).json({ message: '缺少必填字段: roleId' });
      }

      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor, service } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:update');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, service);

      await result.service.updateProjectMemberRole(harborProjectRef, Number(memberId), roleId);

      harborLog.info(
        `更新成员角色: harbor=${id}, project=${projectRef}, member=${memberId}, role=${roleId}`,
      );
      res.json({ message: '更新成功' });
    } catch (error: any) {
      harborLog.error('更新成员角色失败:', error.message);
      res.status(500).json({ message: '更新成员角色失败', error: error.message });
    }
  },
);

/**
 * 获取当前租户下所有组织成员（用于成员选择器）
 * GET /api/harbor/registries/:id/tenant-users
 * 
 * 权限：harbor.project:read
 * 逻辑：查询 TenantUser 表，关联 Organization，返回用户列表
 */
router.get('/registries/:id/tenant-users', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harbor } = result;
    const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:read');
    if (!allowed) {
      return res.status(403).json({ message: '权限不足' });
    }

    const userRole = (req.user as any)?.role;
    const isSystemAdmin = userRole === 'super_admin' || userRole === 'admin';

    const tenantUserRepo = AppDataSource.getRepository(TenantUser);
    const orgRepo = AppDataSource.getRepository(Organization);

    let users: TenantUser[];

    if (isSystemAdmin) {
      // 系统管理员可以看到所有用户
      users = await tenantUserRepo.find({
        where: { status: 'active' },
        relations: ['organization'],
      });
    } else {
      // 租户用户只能看到本租户的用户
      const tenantId = (req.user as any)?.tenantId;
      if (!tenantId) {
        return res.status(400).json({ message: '无法获取租户信息' });
      }

      users = await tenantUserRepo.find({
        where: { tenantId, status: 'active' },
        relations: ['organization'],
      });
    }

    // 查询所有组织，构建组织路径
    const allOrgs = await orgRepo.find();
    const orgMap = new Map<string, Organization>();
    for (const org of allOrgs) {
      orgMap.set(org.id, org);
    }

    // 构建组织路径（从根到当前组织）
    const buildOrgPath = (org: Organization): string[] => {
      const path: string[] = [org.name];
      let current = org;
      while (current.parentId) {
        const parent = orgMap.get(current.parentId);
        if (!parent) break;
        path.unshift(parent.name);
        current = parent;
      }
      return path;
    };

    // 转换为前端需要的格式
    const userList = users.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      organization: user.organization
        ? {
            id: user.organization.id,
            name: user.organization.name,
            level: user.organization.level,
            path: buildOrgPath(user.organization),
          }
        : null,
    }));

    res.json({ message: '查询成功', data: userList });
  } catch (error: any) {
    harborLog.error('获取租户用户列表失败:', error.message);
    res.status(500).json({ message: '获取租户用户列表失败', error: error.message });
  }
});

/**
 * 检查用户是否已有 Harbor 映射
 * GET /api/harbor/registries/:id/user-mappings/:tenantUserId
 * 
 * 权限：harbor.project:read
 * 逻辑：查询 HarborUserMapping 表
 */
router.get(
  '/registries/:id/user-mappings/:tenantUserId',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, tenantUserId } = req.params;

      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { harbor } = result;
      const { allowed } = checkHarborAccess(req, harbor, 'harbor.project:read');
      if (!allowed) {
        return res.status(403).json({ message: '权限不足' });
      }

      const mapping = await HarborUserService.getMapping({
        harborRegistryId: id,
        tenantUserId,
      });

      res.json({
        message: '查询成功',
        data: mapping
          ? {
              id: mapping.id,
              harborUsername: mapping.harborUsername,
              syncStatus: mapping.syncStatus,
              lastSyncAt: mapping.lastSyncAt,
            }
          : null,
      });
    } catch (error: any) {
      harborLog.error('检查用户映射失败:', error.message);
      res.status(500).json({ message: '检查用户映射失败', error: error.message });
    }
  },
);

export { router as projectsRoutes };
