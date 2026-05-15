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

const harborLog = logger.child('HarborProjects');

const router = Router();

/**
 * 获取 HarborProxyService 实例
 */
const getHarborService = async (registryId: string): Promise<{ harbor: HarborRegistry; service: HarborProxyService } | null> => {
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
    
    // 转换 public 字段：数字 0/1 或字符串 'true'/'false' → 布尔值
    let publicValue = false;
    if (typeof isPublic === 'number') {
      publicValue = isPublic === 1;
    } else if (typeof isPublic === 'string') {
      publicValue = isPublic === 'true';
    } else if (typeof isPublic === 'boolean') {
      publicValue = isPublic;
    }
    
    const project = await result.service.createProject({
      project_name,
      public: publicValue,
      metadata,
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

    const { id, name } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    const project = await result.service.getProject(name);
    
    // 转换字段名：snake_case -> camelCase
    const transformedProject = {
      projectId: project.project_id,
      name: project.name,
      ownerName: project.owner_name,
      repoCount: project.repo_count,
      metadata: project.metadata,
      createdAt: project.creation_time,
      updatedAt: project.update_time,
    };
    
    res.json({ message: '查询成功', data: transformedProject });
  } catch (error: any) {
    harborLog.error('获取项目详情失败:', error.message);
    res.status(500).json({ message: '获取项目详情失败', error: error.message });
  }
});

/**
 * 删除项目
 * DELETE /api/harbor/registries/:id/projects/:name
 */
router.delete('/registries/:id/projects/:name', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:delete')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, name } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    await result.service.deleteProject(name);
    
    // 删除本地缓存
    const projectRepo = AppDataSource.getRepository(HarborProject);
    await projectRepo.delete({ harborId: id, name });
    
    harborLog.info(`删除项目: harbor=${id}, project=${name}`);
    res.json({ message: '删除成功' });
  } catch (error: any) {
    harborLog.error('删除项目失败:', error.message);
    res.status(500).json({ message: '删除项目失败', error: error.message });
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

    const { id, name } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    const summary = await result.service.getProjectSummary(name);
    
    // Harbor summary API 不返回制品数量，需要遍历仓库计算
    let totalArtifacts = 0;
    let totalPulls = 0;
    try {
      const repositories = await result.service.getRepositories(name, { pageSize: 100 });
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

    const { id, name } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    harborLog.info(`获取项目成员: harbor=${id}, project=${name}, harbor_user=${result.harbor.username}, url=${result.harbor.url}, pwd_len=${result.harbor.password?.length}`);
    
    // 先测试基本 API 是否正常，打印完整响应
    try {
      const axiosResponse = await result.service.axiosInstance.get('/api/v2.0/systeminfo');
      harborLog.info(`系统信息完整响应: status=${axiosResponse.status}, data_keys=${Object.keys(axiosResponse.data || {}).join(',')}`);
    } catch (sysErr: any) {
      harborLog.error(`系统信息失败: ${sysErr.message}, status=${sysErr.response?.status}`);
    }
    
    try {
      const members = await result.service.getProjectMembers(name);
      
      // 转换字段名：snake_case -> camelCase
      const transformedMembers = members.map((member: any) => ({
        id: member.user_id || member.id,
        entityName: member.entity_name || member.username,
        entityType: member.entity_type || 'u',  // u=用户, g=用户组
        roleName: member.role_name,
        roleId: member.role_id,
        projectName: member.project_name,
      }));
      
      res.json({ message: '查询成功', data: transformedMembers });
    } catch (memberError: any) {
      harborLog.error(`获取项目成员失败: ${memberError.message}, status=${memberError.response?.status}, data=${JSON.stringify(memberError.response?.data)}`);
      // Harbor 401/403 表示用户无权限查看该项目成员
      if (memberError.response?.status === 401 || memberError.response?.status === 403) {
        return res.json({ 
          message: '提示：当前 Harbor 用户无权限查看项目成员，可能原因：\n1. 用户密码已修改\n2. 用户权限不足\n\n请检查 Harbor 配置中的用户凭证是否正确', 
          data: [] 
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

    const { id, name } = req.params;
    const { memberName, memberId, role } = req.body;
    
    if (!role) {
      return res.status(400).json({ message: '缺少必填字段: role' });
    }
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    await result.service.addProjectMember(name, {
      member_name: memberName,
      member_group: false,
      role_id: role,
    });
    
    harborLog.info(`添加项目成员: harbor=${id}, project=${name}, member=${memberName || memberId}`);
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
router.delete('/registries/:id/projects/:name/members/:memberId', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.project:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, name, memberId } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    await result.service.deleteProjectMember(name, Number(memberId));
    
    harborLog.info(`删除项目成员: harbor=${id}, project=${name}, member=${memberId}`);
    res.json({ message: '删除成功' });
  } catch (error: any) {
    harborLog.error('删除项目成员失败:', error.message);
    res.status(500).json({ message: '删除项目成员失败', error: error.message });
  }
});

/**
 * 获取项目下的仓库列表
 * GET /api/harbor/registries/:id/projects/:project/repositories
 */
router.get('/registries/:id/projects/:project/repositories', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.repository:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project } = req.params;
    const { page, pageSize, q } = req.query;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    const repositories = await result.service.getRepositories(project, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      q: q ? String(q) : undefined,
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
});

/**
 * 获取单个仓库详情
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo
 */
router.get('/registries/:id/projects/:project/repositories/:repo', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.repository:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    const repository = await result.service.getRepository(project, decodedRepo);
    
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
});

/**
 * 删除仓库
 * DELETE /api/harbor/registries/:id/projects/:project/repositories/:repo
 */
router.delete('/registries/:id/projects/:project/repositories/:repo', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.repository:delete')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    // Harbor 删除仓库需要通过删除所有制品实现
    await result.service.request({
      method: 'DELETE',
      url: `/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${encodeURIComponent(decodedRepo)}`,
    });
    
    harborLog.info(`删除仓库: harbor=${id}, project=${project}, repo=${decodedRepo}`);
    res.json({ message: '删除成功' });
  } catch (error: any) {
    harborLog.error('删除仓库失败:', error.message);
    res.status(500).json({ message: '删除仓库失败', error: error.message });
  }
});

/**
 * 获取制品列表
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts
 */
router.get('/registries/:id/projects/:project/repositories/:repo/artifacts', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.artifact:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo } = req.params;
    const { page, pageSize, q, withTag, withLabel, withScanOverview } = req.query;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    const artifacts = await result.service.getArtifacts(project, decodedRepo, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      q: q ? String(q) : undefined,
      withTag: withTag !== 'false',
      withLabel: withLabel !== 'false',
      withScanOverview: withScanOverview !== 'false',
    });
    
    // 转换字段名：snake_case -> camelCase
    const transformedArtifacts = artifacts.map((artifact: any) => ({
      ...artifact,
      pushTime: artifact.push_time,
      pullTime: artifact.pull_time,
      scanOverview: artifact.scan_overview,
      extraAttrs: artifact.extra_attrs,
    }));
    
    res.json({ message: '查询成功', data: transformedArtifacts });
  } catch (error: any) {
    harborLog.error('获取制品列表失败:', error.message);
    res.status(500).json({ message: '获取制品列表失败', error: error.message });
  }
});

/**
 * 获取制品详情
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref
 */
router.get('/registries/:id/projects/:project/repositories/:repo/artifacts/:ref', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.artifact:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo, ref } = req.params;
    const { withTag, withLabel, withScanOverview } = req.query;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    const artifact = await result.service.getArtifact(project, decodedRepo, ref);
    
    // 转换字段名：snake_case -> camelCase
    const transformedArtifact = {
      ...artifact,
      pushTime: artifact.push_time,
      pullTime: artifact.pull_time,
      scanOverview: artifact.scan_overview,
      extraAttrs: artifact.extra_attrs,
    };
    
    res.json({ message: '查询成功', data: transformedArtifact });
  } catch (error: any) {
    harborLog.error('获取制品详情失败:', error.message);
    res.status(500).json({ message: '获取制品详情失败', error: error.message });
  }
});

/**
 * 删除制品
 * DELETE /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref
 */
router.delete('/registries/:id/projects/:project/repositories/:repo/artifacts/:ref', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.artifact:delete')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo, ref } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    await result.service.deleteArtifact(project, decodedRepo, ref);
    
    harborLog.info(`删除制品: harbor=${id}, project=${project}, repo=${decodedRepo}, ref=${ref}`);
    res.json({ message: '删除成功' });
  } catch (error: any) {
    harborLog.error('删除制品失败:', error.message);
    res.status(500).json({ message: '删除制品失败', error: error.message });
  }
});

/**
 * 获取制品标签列表
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags
 */
router.get('/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.artifact:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo, ref } = req.params;
    const { page, pageSize } = req.query;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    const tags = await result.service.getTags(project, decodedRepo, ref);
    
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
});

/**
 * 创建制品标签
 * POST /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags
 */
router.post('/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.artifact:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo, ref } = req.params;
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ message: '缺少必填字段: name' });
    }
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    await result.service.createTag(project, decodedRepo, ref, name);
    
    harborLog.info(`创建标签: harbor=${id}, project=${project}, repo=${decodedRepo}, ref=${ref}, tag=${name}`);
    res.status(201).json({ message: '创建成功' });
  } catch (error: any) {
    harborLog.error('创建标签失败:', error.message);
    res.status(500).json({ message: '创建标签失败', error: error.message });
  }
});

/**
 * 删除制品标签
 * DELETE /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags/:tag
 */
router.delete('/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/tags/:tag', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.artifact:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo, ref, tag } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    await result.service.deleteTag(project, decodedRepo, ref, tag);
    
    harborLog.info(`删除标签: harbor=${id}, project=${project}, repo=${decodedRepo}, ref=${ref}, tag=${tag}`);
    res.json({ message: '删除成功' });
  } catch (error: any) {
    harborLog.error('删除标签失败:', error.message);
    res.status(500).json({ message: '删除标签失败', error: error.message });
  }
});

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
router.get('/registries/:id/selector/projects/:project/repositories', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.repository:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    const repositories = await result.service.getRepositories(project, { pageSize: 100 });
    
    // 简化返回格式（移除仓库名中的项目前缀）
    const simplified = repositories.map((r: any) => {
      // Harbor 返回的仓库名格式为 "project/repository"，需要移除项目前缀
      let repoName = r.name;
      if (repoName.startsWith(`${project}/`)) {
        repoName = repoName.substring(project.length + 1);
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
});

/**
 * 获取镜像选择器标签列表（简化版）
 * GET /api/harbor/registries/:id/selector/projects/:project/repositories/:repo/tags
 */
router.get('/registries/:id/selector/projects/:project/repositories/:repo/tags', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.artifact:read')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id, project, repo } = req.params;
    
    const result = await getHarborService(id);
    if (!result) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    
    // 解码仓库名称（可能包含斜杠）
    const decodedRepo = decodeURIComponent(repo);
    
    // 获取所有制品及其标签
    const artifacts = await result.service.getArtifacts(project, decodedRepo, { 
      pageSize: 100,
      withTag: true 
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
});

export { router as projectsRoutes };
