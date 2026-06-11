/**
 * Harbor 项目管理路由
 *
 * 实现项目、仓库、制品等资源的代理 API。
 *
 * @see HarborProxyService
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { HarborProject } from '../../entities/harbor/HarborProject';
import { HarborProxyService } from '../../services/harbor/HarborProxyService';
import { AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';
import {
  resolveHarborProjectRef,
  resolveHarborProjectRefAsync,
  buildHarborProjectContext,
} from './harborProjectRef';

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
const getHarborService = async (
  registryId: string,
): Promise<{ harbor: HarborRegistry; service: HarborProxyService } | null> => {
  const harborRepo = AppDataSource.getRepository(HarborRegistry);
  const harbor = await harborRepo.findOne({ where: { id: registryId } });

  if (!harbor) {
    return null;
  }

  const service = HarborProxyService.getInstance(harbor);

  return { harbor, service };
};

/**
 * 获取项目列表
 * GET /api/harbor/registries/:id/projects
 */
router.get('/registries/:id/projects', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { page, pageSize, name, public: isPublic } = req.query;

    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const projects = await result.service.getProjects({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      name: name ? String(name) : undefined,
      public: isPublic !== undefined ? isPublic === 'true' : undefined,
    });

    // 转换字段名：snake_case -> camelCase
    const transformedProjects = projects.map((p: any) => ({
      projectId: p.project_id,
      name: p.name,
      public: p.public,
      ownerName: p.owner_name,
      repoCount: p.repo_count,
      metadata: p.metadata,
      createdAt: p.creation_time,
      updatedAt: p.update_time,
    }));

    res.json({ message: '查询成功', data: transformedProjects });
  } catch (error: any) {
    harborLog.error('获取项目列表失败:', error.message);
    res.status(500).json({ message: '获取项目列表失败', error: error.message });
  }
});

/**
 * 创建项目
 * POST /api/harbor/registries/:id/projects
 */
router.post('/registries/:id/projects', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:create')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { project_name, public: isPublic, metadata } = req.body;

    if (!project_name) {
      return res.status(400).json({ message: '缺少必填字段: project_name' });
    }

    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const publicValue = parseHarborPublicValue(isPublic);

    const project = await result.service.createProject({
      project_name,
      public: publicValue,
      metadata: {
        ...metadata,
        public: publicValue ? 'true' : 'false',
      },
    });

    harborLog.info(`创建项目: harbor=${id}, project=${project_name}`);
    res.status(201).json({ message: '创建成功', data: project });
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
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

    const project = await result.service.getProject(harborProjectRef, projectRef);

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
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:delete')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;

    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
 */
router.get('/registries/:id/projects/:name/members', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

    harborLog.info(
      `获取项目成员: harbor=${id}, project=${projectRef}, harbor_user=${result.harbor.username}, url=${result.harbor.url}, pwd_len=${result.harbor.password?.length}`,
    );

    // 先测试基本 API 是否正常，打印完整响应
    try {
      const axiosResponse = await result.service.axiosInstance.get('/api/v2.0/systeminfo');
      harborLog.info(
        `系统信息完整响应: status=${axiosResponse.status}, data_keys=${Object.keys(axiosResponse.data || {}).join(',')}`,
      );
    } catch (sysErr: any) {
      harborLog.error(`系统信息失败: ${sysErr.message}, status=${sysErr.response?.status}`);
    }

    try {
      const members = await result.service.getProjectMembers(harborProjectRef);

      // 转换字段名：snake_case -> camelCase
      const transformedMembers = members.map((member: any) => ({
        id: member.user_id || member.id,
        entityName: member.entity_name || member.username,
        entityType: member.entity_type || 'u', // u=用户, g=用户组
        roleName: member.role_name,
        roleId: member.role_id,
        projectName: member.project_name,
      }));

      res.json({ message: '查询成功', data: transformedMembers });
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
 */
router.post('/registries/:id/projects/:name/members', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { memberName, memberId, role } = req.body;

    if (!role) {
      return res.status(400).json({ message: '缺少必填字段: role' });
    }

    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

    await result.service.addProjectMember(harborProjectRef, {
      member_name: memberName,
      member_group: false,
      role_id: role,
    });

    harborLog.info(
      `添加项目成员: harbor=${id}, project=${harborProjectRef}, member=${memberName || memberId}`,
    );
    res.status(201).json({ message: '添加成功' });
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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.project:update')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, memberId } = req.params;
      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.repository:read')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id } = req.params;
      const { page, pageSize, q } = req.query;

      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.repository:read')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo } = req.params;
      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.repository:delete')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo } = req.params;
      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.artifact:read')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo } = req.params;
      const { page, pageSize, q, withTag, withLabel, withScanOverview } = req.query;

      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.artifact:read')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo, ref } = req.params;
      const {
        withTag: _withTag,
        withLabel: _withLabel,
        withScanOverview: _withScanOverview,
      } = req.query;

      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.artifact:delete')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo, ref } = req.params;
      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.artifact:read')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo, ref } = req.params;
      const { page: _page, pageSize: _pageSize } = req.query;

      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.artifact:update')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo, ref } = req.params;
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ message: '缺少必填字段: name' });
      }

      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.artifact:update')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo, ref, tag } = req.params;
      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;

    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const projects = await result.service.getProjects({ pageSize: 100 });

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.repository:read')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id } = req.params;
      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.artifact:read')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, repo } = req.params;
      const result = await getHarborService(id);
      if (!result) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, result.service);

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

export { router as projectsRoutes };
