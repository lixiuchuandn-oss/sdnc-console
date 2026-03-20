// 系统级管理与配置相关路由：
// - Dify（AI 工作流）集成配置读取与更新
// - 简单的 Key-Value 形式系统设置读写
// - RBAC 权限原子扫描与动作列表输出
// - RBAC 角色（策略）增删改查与角色分配关系管理
// - 安全告警日志文件（CSV/Excel）批量上传与列出
//
// 注意：
// 1. 这里的接口一般挂载在 /api/system 前缀下，由后端入口统一加上鉴权中间件；
// 2. RBAC 相关接口依赖数据库中的 RBACRole、RoleAssignment、TenantUser 等实体；
// 3. 文件扫描与日志上传相关逻辑依赖后端运行目录（process.cwd()）以及 runtimeConfig 中的目录配置。
import { Router, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getDifyConfig, setDifyConfig } from '../config/runtimeConfig';
import { getSystemSetting, setSystemSetting } from '../config/systemSettings';
import { AppDataSource } from '../config/database';
import { RBACRole } from '../entities/RBACRole';
import { RoleAssignment } from '../entities/RoleAssignment';
import { TenantUser } from '../entities/TenantUser';
import { User, UserRole } from '../entities/User';
import { RecycleBinShutdownRecord } from '../entities/harvester/RecycleBinShutdownRecord';
import { RecycleBinTaskService } from '../services/clouds/harvester/RecycleBinTaskService';
import { AuthRequest } from '../middleware/auth';
import { ALL_PERMISSIONS } from '../constants/permissions';
// 新权限体系
import { createApiPermissionMiddleware, requirePermission, checkPermission, PERMISSION_DEFINITIONS, resolvePermissionFromApi } from '../permissions';

// 全局系统路由实例，后续所有 /system 相关子路径都挂在该 Router 上
const router = Router();

// 权限检查中间件：检查权限管理相关权限（已迁移到新权限体系）
// - 读操作（GET/HEAD）需要 system.rbac:read 或 system.roles:read 权限
// - 写操作（POST/PUT/PATCH/DELETE）需要 system.rbac:write 或 system.roles:write 权限
const checkRbacPermission = createApiPermissionMiddleware({
  allowSuperAdmin: true,
});

// 权限检查中间件：检查系统设置权限（已迁移到新权限体系）
const checkSettingsPermission = createApiPermissionMiddleware({
  allowSuperAdmin: true,
});

// 权限检查中间件：检查高级集成权限（已迁移到新权限体系）
const checkIntegrationPermission = createApiPermissionMiddleware({
  allowSuperAdmin: true,
  customResolver: (req) => {
    // 明确指定高级集成权限
    const method = req.method.toUpperCase();
    const isRead = method === 'GET' || method === 'HEAD';
    return isRead ? 'system.integration:read' : 'system.integration:write';
  },
});

// 读取当前 Dify（AI 工作流）集成配置
// 用于前端系统设置页面展示当前配置，返回时会对 apiKey 进行脱敏处理
router.get('/dify-config', checkIntegrationPermission, async (_req, res) => {
  const cfg = getDifyConfig();
  const safe = { ...cfg } as any;
  res.json({ config: { ...safe, apiKey: !!cfg.apiKey ? '****' : '' } });
});

// 更新 Dify 集成配置
// 请求体中只要带上需要修改的字段即可，底层会合并并持久化到 runtimeConfig
// 返回值同样会对 apiKey 做脱敏，避免明文泄露
router.patch('/dify-config', checkIntegrationPermission, async (req, res) => {
  const { baseUrl, apiKey, workflowId, logsDir, reportsDir, mode, fileVarName } = req.body as any;
  const next = setDifyConfig({
    baseUrl,
    apiKey,
    workflowId,
    logsDir,
    reportsDir,
    mode,
    fileVarName,
  });
  const safe = { ...next } as any;
  res.json({ config: { ...safe, apiKey: !!next.apiKey ? '****' : '' } });
});

// 读取单个系统设置项（简单的 KV 配置）
// - key 从 URL 路径中获取
// - value 如果不存在则返回空字符串，方便前端统一处理
router.get('/settings/:key', checkSettingsPermission, (req, res) => {
  const key = req.params.key;
  const value = getSystemSetting(key);
  res.json({ data: { key, value: value || '' } });
});

// 更新单个系统设置项
// - value 来源于请求体，内部统一转成字符串保存
// - 适合存储一些轻量级的全局配置，例如开关、字符串参数等
router.patch('/settings/:key', checkSettingsPermission, (req, res) => {
  const key = req.params.key;
  const { value } = req.body;
  
  try {
    setSystemSetting(key, String(value || ''));

    // 如果更新的是回收站任务相关配置，重新调度任务
    if (key === 'harvester.recycle_bin.shutdown_interval_hours') {
      try {
        RecycleBinTaskService.getInstance().rescheduleShutdownTask();
        console.log('[System] 回收站关机任务间隔已更新，已重新调度任务');
      } catch (e: any) {
        console.error('[System] 重新调度回收站任务失败:', e);
        // 不阻止设置更新，只记录错误
      }
    }

    res.json({ data: { key, value: String(value || '') } });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to update setting' });
  }
});

// 查询回收站自动关机记录
// - 支持分页、筛选（云平台、状态、时间范围）
router.get('/recycle-bin/shutdown-records', async (req, res) => {
  try {
    const { 
      cloudId, 
      status, 
      startTime, 
      endTime, 
      page = '1', 
      pageSize = '20' 
    } = req.query;

    const recordRepo = AppDataSource.getRepository(RecycleBinShutdownRecord);
    const queryBuilder = recordRepo.createQueryBuilder('record');

    // 筛选条件
    if (cloudId) {
      queryBuilder.andWhere('record.cloudId = :cloudId', { cloudId });
    }
    if (status) {
      queryBuilder.andWhere('record.status = :status', { status });
    }
    if (startTime) {
      queryBuilder.andWhere('record.shutdownAt >= :startTime', { startTime });
    }
    if (endTime) {
      queryBuilder.andWhere('record.shutdownAt <= :endTime', { endTime });
    }

    // 排序：按关机时间倒序
    queryBuilder.orderBy('record.shutdownAt', 'DESC');

    // 分页
    const pageNum = parseInt(String(page), 10) || 1;
    const size = parseInt(String(pageSize), 10) || 20;
    const skip = (pageNum - 1) * size;

    queryBuilder.skip(skip).take(size);

    const [records, total] = await queryBuilder.getManyAndCount();

    res.json({
      data: {
        records,
        pagination: {
          page: pageNum,
          pageSize: size,
          total,
          totalPages: Math.ceil(total / size),
        },
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '查询关机记录失败' });
  }
});

// 获取系统中所有"权限原子"（action）列表
// 输出内容主要用于：
// - RBAC 策略配置页面列出所有可用动作（actions）
// - 前端权限管理页面的展示
router.get('/rbac/actions', checkRbacPermission, async (_req, res) => {
  // 预定义的权限原子列表，来自 constants/permissions.ts
  // 这些是系统中所有可用的权限原子
  const actions: string[] = [...ALL_PERMISSIONS].sort();

  // 注意：分组、平台等元数据由后端权限体系提供（/rbac/permissions）
  res.json({ 
    actions,
  });
});

// 获取所有权限定义（包含平台、分组等元数据）
// 前端可以使用此 API 获取权限定义，避免重复推断平台和分组
// 后端权限体系（backend/src/permissions/）是权限元数据的单一数据源
router.get('/rbac/permissions', checkRbacPermission, async (_req, res) => {
  try {
    // 返回所有权限定义，包含完整的元数据（platform, group, name, description 等）
    res.json({
      permissions: PERMISSION_DEFINITIONS.map(def => ({
        id: def.id,
        name: def.name,
        description: def.description,
        platform: def.platform,
        group: def.group,
        category: def.category,
        verb: def.verb,
        inherits: def.inherits,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: '获取权限定义失败', error });
  }
});

// RBAC 角色（策略）列表查询
// 将数据库中的 RBACRole 记录转换为前端所需的策略格式：
// - actions：权限原子数组
// - type：区分"系统策略"和"自定义策略"
// - conditions：预留条件字段，由前端/后端共同约定结构
router.get('/rbac/roles', checkRbacPermission, async (req, res) => {
  try {
    const roleRepo = AppDataSource.getRepository(RBACRole);
    const roles = await roleRepo.find({
      order: { createdAt: 'DESC' }
    });
    // Transform to frontend Policy format
    const SYSTEM_ROLES = ['Super Admin', '云租户根用户', '三权-审计管理员', '三权-安全管理员', '三权-系统管理员'];
    const list = roles.map(r => {
      let actions: string[] = [];
      let conditions: any = undefined;
      try {
        if (r.permissions) {
           const parsed = JSON.parse(r.permissions);
           if (Array.isArray(parsed)) {
             actions = parsed;
           } else {
             actions = parsed.actions || [];
             conditions = parsed.conditions;
           }
        }
      } catch (e) {
        actions = [];
      }
      return {
        id: r.id,
        name: r.name,
        type: SYSTEM_ROLES.includes(r.name) ? '系统策略' : '自定义策略',
        description: r.description,
        scope: r.scope,
        status: r.status,
        permissions: r.permissions,
        actions: Array.isArray(actions) ? actions : [],
        groups: [], // Calculated on frontend
        conditions,
        createdAt: r.createdAt,
        updatedAt: (r as any).updatedAt
      };
    });
    res.json(list);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch roles', error });
  }
});

// 创建角色（仅超级管理员或拥有 system.roles:write 权限）
// - name：角色名称（唯一）
// - description：说明文本
// - scope：作用域（默认为 'system'，可根据业务扩展）
// - permissions：权限原子数组，将以 JSON 字符串形式存入数据库
router.post('/rbac/roles', checkRbacPermission, async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const perms: string[] = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const hasPerm = checkPermission(perms, 'system.roles:write') || checkPermission(perms, 'system.rbac:write');
    if (!isSuper && !hasPerm)
      return res.status(403).json({ message: '权限不足' });
    const { name, description, scope = 'system', permissions = [] } = req.body as any;
    if (!name?.trim()) return res.status(400).json({ message: '角色名称不能为空' });
    const repo = AppDataSource.getRepository(RBACRole);
    const existed = await repo.findOne({ where: { name } });
    if (existed) return res.status(400).json({ message: '角色名称已存在' });
    const row = repo.create({
      name,
      description,
      scope,
      permissions: JSON.stringify(permissions),
      status: 'active',
    });
    const saved = await repo.save(row);
    res.status(201).json(saved);
  } catch (e: any) {
    res.status(500).json({ message: '创建角色失败', error: String(e) });
  }
});

// 更新角色（仅超级管理员或拥有 system.roles:write 权限）
// 支持增量更新 name/description/scope/status/permissions
router.put('/rbac/roles/:id', checkRbacPermission, async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const perms: string[] = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const hasPerm = checkPermission(perms, 'system.roles:write') || checkPermission(perms, 'system.rbac:write');
    if (!isSuper && !hasPerm)
      return res.status(403).json({ message: '权限不足' });
    const { id } = req.params;
    const { name, description, scope, permissions, status } = req.body as any;
    const repo = AppDataSource.getRepository(RBACRole);
    const row = await repo.findOne({ where: { id } });
    if (!row) return res.status(404).json({ message: '角色不存在' });
    row.name = name ?? row.name;
    row.description = description ?? row.description;
    row.scope = scope ?? row.scope;
    row.status = status ?? row.status;
    if (permissions) {
      try {
        row.permissions = JSON.stringify(permissions);
      } catch {}
    }
    const saved = await repo.save(row);
    res.json(saved);
  } catch (e: any) {
    res.status(500).json({ message: '更新角色失败', error: String(e) });
  }
});

// 更新角色权限（仅超级管理员或拥有 system.roles:write 权限）
// 专门用于更新角色的权限列表，接收 permissions 数组
router.patch('/rbac/roles/:id/permissions', checkRbacPermission, async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const perms: string[] = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const hasPerm = checkPermission(perms, 'system.roles:write') || checkPermission(perms, 'system.rbac:write');
    if (!isSuper && !hasPerm)
      return res.status(403).json({ message: '权限不足' });
    const { id } = req.params;
    const { permissions } = req.body as any;
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ message: 'permissions 必须是数组' });
    }
    const repo = AppDataSource.getRepository(RBACRole);
    const row = await repo.findOne({ where: { id } });
    if (!row) return res.status(404).json({ message: '角色不存在' });
    try {
      row.permissions = JSON.stringify(permissions);
      const saved = await repo.save(row);
      res.json(saved);
    } catch (e: any) {
      res.status(500).json({ message: '更新权限失败', error: String(e) });
    }
  } catch (e: any) {
    res.status(500).json({ message: '更新权限失败', error: String(e) });
  }
});

// 删除角色（仅超级管理员或拥有 system.roles:write 权限）
// 删除前会做安全检查：
// - 是否为系统预置角色（通过名称判断）
// - 是否仍被 RoleAssignment 引用
// - 是否仍有 TenantUser 的 role 字段指向该角色
router.delete('/rbac/roles/:id', checkRbacPermission, async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const perms: string[] = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const hasPerm = checkPermission(perms, 'system.roles:write') || checkPermission(perms, 'system.rbac:write');
    if (!isSuper && !hasPerm)
      return res.status(403).json({ message: '权限不足' });
    const { id } = req.params;
    const repo = AppDataSource.getRepository(RBACRole);
    const row = await repo.findOne({ where: { id } });
    if (!row) return res.status(404).json({ message: '角色不存在' });

    // 检查是否为系统预置角色（通过名称判断）
    const SYSTEM_ROLES = ['Super Admin', '云租户根用户', '三权-审计管理员', '三权-安全管理员', '三权-系统管理员'];
    if (SYSTEM_ROLES.includes(row.name)) {
      return res.status(400).json({ message: '系统预置角色不允许删除' });
    }

    // 检查是否有用户关联
    const assignRepo = AppDataSource.getRepository(RoleAssignment);
    const assignmentCount = await assignRepo.count({ where: { roleId: id } });
    if (assignmentCount > 0) {
      return res.status(400).json({ message: '该角色已关联用户，无法删除' });
    }

    const tenantUserRepo = AppDataSource.getRepository(TenantUser);
    const tenantUserCount = await tenantUserRepo.count({ where: { role: id } });
    if (tenantUserCount > 0) {
      return res.status(400).json({ message: '该角色已关联租户用户，无法删除' });
    }

    await repo.remove(row);
    res.json({ deleted: 1 });
  } catch (e: any) {
    res.status(500).json({ message: '删除角色失败', error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// API 盘点：静态扫描后端 routes，列出所有对外 API（仅用于运维观察）
// ---------------------------------------------------------------------------
router.get('/rbac/api-inventory', checkRbacPermission, async (_req, res) => {
  try {
    type ApiItem = { method: string; path: string; file: string };
    const apis: ApiItem[] = [];

    // 1. 从 index.ts / dist index.js 中构建 routes -> basePath 映射
    const baseMap: Record<string, string> = {};
    const buildBaseMap = async (file: string) => {
      try {
        if (!fs.existsSync(file)) return;
        const text = await fs.promises.readFile(file, 'utf8');
        const importRegexDefault = /import\s+(\w+)\s+from\s+["']\.\/routes\/([^"']+)["']/g;
        const importRegexNamed = /import\s+\{\s*([^}]+)\s*\}\s+from\s+["']\.\/routes\/([^"']+)["']/g;
        const uses: Array<{ var: string; name: string }> = [];
        {
          let m: RegExpExecArray | null;
          while ((m = importRegexDefault.exec(text))) {
            uses.push({ var: m[1], name: m[2] });
          }
        }
        {
          let m2: RegExpExecArray | null;
          while ((m2 = importRegexNamed.exec(text))) {
            const namesRaw = String(m2[1] || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            const fileName = m2[2];
            namesRaw.forEach((n) => {
              const alias = n.includes(' as ') ? n.split(' as ')[1].trim() : n.split(/\s+/)[0].trim();
              if (alias) uses.push({ var: alias, name: fileName });
            });
          }
        }
        const useRegex = /app\.use\(\s*(["'][^"']+["'])\s*,[\s\S]*?(\w+)\s*\)/g;
        let um: RegExpExecArray | null;
        while ((um = useRegex.exec(text))) {
          const base = um[1].replace(/^["']|["']$/g, '');
          const varName = um[2];
          const u = uses.find((x) => x.var === varName);
          if (u) baseMap[u.name] = base;
        }
      } catch {
        // ignore
      }
    };
    await buildBaseMap(path.join(process.cwd(), 'src', 'index.ts'));
    await buildBaseMap(path.join(process.cwd(), 'dist', 'index.js'));

    const normalizeFullPath = (base: string, subPath: string): string => {
      let b = String(base || '');
      let s = String(subPath || '');
      let p = `${b}${s}`.replace(/\\/g, '/');
      p = p.replace(/\/ {2,}/g, '/');
      if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
      if (!p.startsWith('/')) p = '/' + p;
      return p;
    };

    const seen = new Set<string>();

    const scanRoutesFile = async (absoluteFilePath: string, basePath: string, depth: number = 0) => {
      if (!fs.existsSync(absoluteFilePath)) return;

      const text = await fs.promises.readFile(absoluteFilePath, 'utf8');
      // 尽量匹配各种 Router 变量名，如 router / vrConfigRoutes / cloudRoutes 等
      const routeRegex = /\b(\w+)\.(get|post|put|delete|patch|head)\s*\(\s*['"]([^'"]+)['"]/g;
      let rm: RegExpExecArray | null;
      while ((rm = routeRegex.exec(text))) {
        const method = rm[2].toUpperCase();
        const subPath = rm[3];
        const fullPath = normalizeFullPath(basePath, subPath);
        const key = `${method} ${fullPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const relFile = path
          .relative(path.join(process.cwd(), 'src'), absoluteFilePath)
          .replace(/\\/g, '/');
        apis.push({
          method,
          path: fullPath,
          file: relFile || absoluteFilePath,
        });
      }

      // 递归扫描子路由文件，例如：
      // import { registerHarvesterRoutes } from './clouds/harvester';
      if (depth < 3) {
        const importSubRoutesRegex = /from\s+['"]\.\/([^'"]+)['"]/g;
        let im: RegExpExecArray | null;
        while ((im = importSubRoutesRegex.exec(text))) {
          const subName = im[1];
          const dir = path.dirname(absoluteFilePath);
          const candidates = [
            path.join(dir, `${subName}.ts`),
            path.join(dir, `${subName}.js`),
            path.join(dir, subName, 'index.ts'),
            path.join(dir, subName, 'index.js'),
            path.join(dir, `${subName}.routes.ts`),
            path.join(dir, `${subName}.routes.js`),
          ];
          const subPathToRead = candidates.find((p) => fs.existsSync(p));
          if (!subPathToRead) continue;

          await scanRoutesFile(subPathToRead, basePath, depth + 1);
        }
      }
    };

    // 按 baseMap 扫描所有挂载到 /api 下的 routes
    for (const [routesFile, basePath] of Object.entries(baseMap)) {
      const fullFilePathTs = path.join(process.cwd(), 'src', 'routes', `${routesFile}.ts`);
      const fullFilePathJs = path.join(process.cwd(), 'dist', 'routes', `${routesFile}.js`);
      const filePathToRead = fs.existsSync(fullFilePathTs)
        ? fullFilePathTs
        : fs.existsSync(fullFilePathJs)
        ? fullFilePathJs
        : '';
      if (!filePathToRead) continue;
      await scanRoutesFile(filePathToRead, basePath, 0);
    }

    // 排序输出：先按 path，再按 method
    apis.sort((a, b) => {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });

    res.json({ apis });
  } catch (e: any) {
    res.status(500).json({ message: '扫描 API 列表失败', error: String(e?.message || e) });
  }
});

// 为用户分配角色（仅超级管理员或拥有 system.roles.assignments:write 权限）
// 支持多种 userType（如 'tenant' / 'system' 等），具体含义由业务约定
router.post('/rbac/assignments', checkRbacPermission, async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const perms: string[] = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const hasPerm = checkPermission(perms, 'system.roles.assignments:write') || checkPermission(perms, 'system.rbac:write');
    if (!isSuper && !hasPerm)
      return res.status(403).json({ message: '权限不足' });
    const { roleId, userType, userId } = req.body as any;
    if (!roleId || !userType || !userId) return res.status(400).json({ message: '缺少必要参数' });

    // 验证用户类型
    if (userType !== 'system' && userType !== 'tenant') {
      return res.status(400).json({ message: '无效的用户类型，必须是 system 或 tenant' });
    }

    // 验证角色存在
    const roleRepo = AppDataSource.getRepository(RBACRole);
    const role = await roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      return res.status(404).json({ message: '角色不存在' });
    }

    // 验证角色作用域是否与用户类型匹配
    if (role.scope !== userType) {
      return res.status(400).json({ 
        message: `角色作用域不匹配：角色作用域为 ${role.scope}，用户类型为 ${userType}` 
      });
    }

    // 验证角色状态
    if (role.status !== 'active') {
      return res.status(400).json({ message: '无法分配非活跃状态的角色' });
    }

    // 验证用户存在
    const userRepo = userType === 'tenant' 
      ? AppDataSource.getRepository(TenantUser)
      : AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 验证用户状态
    if (user.status && user.status !== 'active') {
      return res.status(400).json({ message: '无法为非活跃用户分配角色' });
    }

    // 检查是否已存在分配
    const assignRepo = AppDataSource.getRepository(RoleAssignment);
    const existed = await assignRepo.findOne({ where: { roleId, userType, userId } });
    if (existed) return res.status(200).json(existed);

    // 创建分配
    const row = assignRepo.create({ roleId, userType, userId });
    const saved = await assignRepo.save(row);
    res.status(201).json(saved);
  } catch (e: any) {
    res.status(500).json({ message: '分配角色失败', error: String(e) });
  }
});

// 查询某个用户的角色分配列表
// - 通过 query.userType + query.userId 来限定查询范围
router.get('/rbac/assignments', checkRbacPermission, async (req: any, res) => {
  try {
    const { userType, userId } = req.query as any;
    if (!userType || !userId) {
      console.log(`[GetAssignments] 缺少必要参数: userType=${userType}, userId=${userId}`);
      return res.status(400).json({ message: '缺少必要参数' });
    }
    console.log(`[GetAssignments] 查询角色分配: userType=${userType}, userId=${userId}`);
    const assignRepo = AppDataSource.getRepository(RoleAssignment);
    const rows = await assignRepo.find({ where: { userType, userId } });
    console.log(`[GetAssignments] 查询结果: 找到 ${rows.length} 条记录`);
    res.json({ assignments: rows });
  } catch (e: any) {
    console.error(`[GetAssignments] 查询失败:`, e);
    res.status(500).json({ message: '查询分配失败', error: String(e) });
  }
});

// 取消某条角色分配记录（仅超级管理员或拥有 system.roles.assignments:write 权限）
router.delete('/rbac/assignments/:id', checkRbacPermission, async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const perms: string[] = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const hasPerm = checkPermission(perms, 'system.roles.assignments:write') || checkPermission(perms, 'system.rbac:write');
    if (!isSuper && !hasPerm)
      return res.status(403).json({ message: '权限不足' });
    const { id } = req.params;
    const assignRepo = AppDataSource.getRepository(RoleAssignment);
    const row = await assignRepo.findOne({ where: { id } });
    if (!row) return res.status(404).json({ message: '分配记录不存在' });
    await assignRepo.remove(row);
    res.json({ deleted: 1 });
  } catch (e: any) {
    res.status(500).json({ message: '取消分配失败', error: String(e) });
  }
});

// 清理角色中的已废弃原子（仅超级管理员）
// 说明：该功能目前仅预留注释位，具体实现需要结合业务场景，
// 例如：对比 actions 列表与 /rbac/actions 扫描结果，移除已经不存在的动作。
export default router;

// 批量上传告警日志（csv/xls/xlsx）
// - 使用 Multer 将前端上传的文件先保存到临时目录 temp_uploads
// - 再根据 Dify 配置中的 logsDir 或默认路径 data/security-logs 移动到目标目录
// - 原始文件名会做简单的字符过滤，避免特殊字符导致的路径问题
const tempUploadsDir = path.join(process.cwd(), 'temp_uploads');
if (!fs.existsSync(tempUploadsDir)) fs.mkdirSync(tempUploadsDir, { recursive: true });
const upload = multer({ dest: tempUploadsDir });

// 上传接口：
// - 表单字段名为 files，最多一次上传 50 个文件
// - 返回成功保存的文件名、大小以及最终目标路径
router.post('/upload-security-logs', upload.array('files', 50), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ message: '未接收到文件' });
    const cfg = getDifyConfig();
    const logsDir = cfg.logsDir || path.join(process.cwd(), 'data', 'security-logs');
    await fs.promises.mkdir(logsDir, { recursive: true });
    const saved: { fileName: string; size: number; target: string }[] = [];

    // 对文件名做简单的安全过滤，去除在 Windows / POSIX 下不合法的字符
    const sanitize = (name: string) => name.replace(/[<>:"/\\|?*]+/g, '_');
    // 兼容部分浏览器/代理上报的 latin1 文件名，这里尝试解码为 UTF-8，失败则按原始字符串处理
    const decodeName = (name: string) => {
      try {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        return sanitize(decoded);
      } catch {
        return sanitize(name);
      }
    };

    for (const f of files) {
      const base = decodeName(path.basename(f.originalname));
      const target = path.join(logsDir, base);
      // 先尝试通过 rename 在同一磁盘上“移动”文件（原子操作且效率高）
      // 若因跨磁盘（EXDEV）导致失败，则退化为 copy + unlink 的方式
      try {
        await fs.promises.rename(f.path, target);
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          await fs.promises.copyFile(f.path, target);
          await fs.promises.unlink(f.path);
        } else {
          throw err;
        }
      }
      saved.push({ fileName: base, size: f.size, target });
    }
    res.json({ ok: true, count: saved.length, files: saved });
  } catch (e: any) {
    // 出错时清理所有临时文件，避免磁盘空间泄漏
    const files = (req.files as Express.Multer.File[]) || [];
    for (const f of files) {
      if (f.path) await fs.promises.unlink(f.path).catch(() => {});
    }
    console.error('Upload failed:', e);
    res.status(500).json({ message: '保存日志文件失败', error: String(e) });
  }
});

// 列出告警日志文件
// - 自动创建日志目录（若不存在）
// - 只返回扩展名为 .csv/.xls/.xlsx 的文件
// - 携带文件大小与最近修改时间戳，方便前端排序与展示
router.get('/security-logs', async (_req, res) => {
  try {
    const cfg = getDifyConfig();
    const logsDir = cfg.logsDir || path.join(process.cwd(), 'data', 'security-logs');
    await fs.promises.mkdir(logsDir, { recursive: true }).catch(() => {});
    const names = await fs.promises.readdir(logsDir).catch(() => [] as string[]);
    const entries = await Promise.all(
      names.map(async (name) => {
        const full = path.join(logsDir, name);
        const stat = await fs.promises.stat(full).catch(() => undefined as any);
        if (!stat || !stat.isFile()) return undefined as any;
        const ext = path.extname(name).toLowerCase();
        if (!['.csv', '.xls', '.xlsx'].includes(ext)) return undefined as any;
        return { fileName: name, sizeBytes: stat.size, modifiedAt: stat.mtimeMs, ext };
      }),
    );
    res.json({ logs: entries.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ message: '读取失败', error: String(err) });
  }
});
