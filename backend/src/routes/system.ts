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
import { Router } from 'express';
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

// 全局系统路由实例，后续所有 /system 相关子路径都挂在该 Router 上
const router = Router();

// 读取当前 Dify（AI 工作流）集成配置
// 用于前端系统设置页面展示当前配置，返回时会对 apiKey 进行脱敏处理
router.get('/dify-config', async (_req, res) => {
  const cfg = getDifyConfig();
  const safe = { ...cfg } as any;
  res.json({ config: { ...safe, apiKey: !!cfg.apiKey ? '****' : '' } });
});

// 更新 Dify 集成配置
// 请求体中只要带上需要修改的字段即可，底层会合并并持久化到 runtimeConfig
// 返回值同样会对 apiKey 做脱敏，避免明文泄露
router.patch('/dify-config', async (req, res) => {
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
router.get('/settings/:key', (req, res) => {
  const key = req.params.key;
  const value = getSystemSetting(key);
  res.json({ data: { key, value: value || '' } });
});

// 更新单个系统设置项
// - value 来源于请求体，内部统一转成字符串保存
// - 适合存储一些轻量级的全局配置，例如开关、字符串参数等
router.patch('/settings/:key', (req, res) => {
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

// 动态扫描系统中所有“权限原子”（action）以及对应的接口明细
// 输出内容主要用于：
// - RBAC 策略配置页面列出所有可用动作（actions）
// - 结合 details 字段，让前端展示每个动作对应了哪些具体接口（method + path）
router.get('/rbac/actions', async (_req, res) => {
  // candidates：最终去重后的动作列表，例如 'clouds.instances:read'
  const candidates: string[] = [];
  // scanned：通过静态扫描从代码中发现的原始动作字符串
  const scanned: string[] = [];
  // details：动作 -> 对应的接口列表（包含 HTTP 方法、路径、定义所在文件）
  const details: Record<string, Array<{ method: string; path: string; file: string }>> = {};
  const add = (x: string) => {
    if (x && !candidates.includes(x)) candidates.push(x);
  };
  const addScanned = (x: string) => {
    if (!x) return;
    if (!scanned.includes(x)) scanned.push(x);
    add(x);
  };
  // curated：手工维护的一批“推荐动作”列表，用于补全扫描不到或尚未完全规范化的权限原子
  // 命名约定大致为：domain.feature:verb
  const curated: string[] = [
    // 运维平台/系统与用户
    'ops.dashboard:read',
    'ops.dashboard:write',
    'users:read',
    'users:write',
    'user-spaces:read',
    'user-spaces:write',
    // 租户与租户资源
    'tenants:read',
    'tenants:write',
    // 云与资源（统一命名：domain.feature:verb）
    'clouds:read',
    'clouds:write',
    'clouds.instances:read',
    'clouds.instances:write',
    'clouds.vpcs:read',
    'clouds.vpcs:write',
    'clouds.eips:read',
    'clouds.eips:write',
    'clouds.disks:read',
    'clouds.disks:write',
    'clouds.security-groups:read',
    'clouds.security-groups:write',
    'clouds.load-balancers:read',
    'clouds.load-balancers:write',
    'clouds.images:read',
    'clouds.images:write',
    'clouds.vswitches:read',
    'clouds.vswitches:write',
    'clouds.enis:read',
    'clouds.enis:write',
    'clouds.network-acls:read',
    'clouds.network-acls:write',
    'clouds.snapshots:read',
    'clouds.snapshots:write',
    'clouds.route-entries:read',
    'clouds.route-entries:write',
    'clouds.nat-gateways:read',
    'clouds.nat-gateways:write',
    'clouds.vlans:read',
    'clouds.vlans:write',
    'clouds.ippools:read',
    'clouds.ippools:write',
    // 云主机控制台
    'clouds.console:read',
    'clouds.console:write',
    // 网络：跨地域互联与安全面
    'networks.vpcs:read',
    'networks.vpcs:write',
    'networks.cen:read',
    'networks.cen:write',
    'networks.cen.attachments:read',
    'networks.cen.attachments:write',
    'networks.security-domain:read',
    'networks.security-domain:write',
    'networks.srv6:read',
    'networks.srv6:write',
    'networks.vr-config:read',
    'networks.vr-config:write',
    'networks.route-tables:read',
    'networks.route-tables:write',
    'networks.acl:read',
    'networks.acl:write',
    'networks.vswitches:read',
    'networks.vswitches:write',
    // 安全服务与日志
    'security.services:read',
    'security.services:write',
    'security.logs:read',
    'security.logs:write',
    'security.policies:read',
    'security.policies:write',
    'security.apps:read',
    'security.apps:write',
    // 安全运营
    'secops.dashboard:read',
    'secops.dashboard:write',
    'secops.alerts:read',
    'secops.alerts:write',
    'secops.rules:read',
    'secops.rules:write',
  ];
  curated.forEach(addScanned);

  // baseMap：记录路由文件名 -> app.use 挂载前缀（base path）
  // 例如：'clouds' => '/api/clouds'
  const baseMap: Record<string, string> = {};
  const buildBaseMap = async (file: string) => {
    try {
      if (!fs.existsSync(file)) return;
      const text = await fs.promises.readFile(file, 'utf8');
      // 第一阶段：解析 index.ts 中 import ./routes/* 的路由变量名与对应文件名
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
      // 第二阶段：解析 app.use('/api/xxx', someRoutes) 来还原 base path 与路由变量之间的关系
      const useRegex = /app\.use\(\s*(["'][^"']+["'])\s*,[\s\S]*?(\w+)\s*\)/g;
      let um: RegExpExecArray | null;
      while ((um = useRegex.exec(text))) {
        const base = um[1].replace(/^["']|["']$/g, '');
        const varName = um[2];
        const u = uses.find((x) => x.var === varName);
        if (u) baseMap[u.name] = base;
      }
    } catch {}
  };
  await buildBaseMap(path.join(process.cwd(), 'src', 'index.ts'));
  await buildBaseMap(path.join(process.cwd(), 'dist', 'index.js'));

  // 将 basePath 与 router 局部 path 合并并标准化，输出统一格式的 URL
  const normalizeFullPath = (base: string, subPath: string): string => {
    let b = String(base || '');
    let s = String(subPath || '');
    let p = `${b}${s}`.replace(/\\/g, '/');
    p = p.replace(/\/ {2,}/g, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    if (!p.startsWith('/')) p = '/' + p;
    return p;
  };

  // 尝试递归扫描指定目录下的所有 js/ts 文件：
  // - 通过正则查找 perms.includes('xxx')，提取权限原子
  // - 结合同文件内的 router.get/post/… 定义，定位最近的路由（method + path）
  // - 再结合 baseMap 计算出完整 URL，用于 details 映射
  const tryScan = async (dir: string) => {
    try {
      const exists = fs.existsSync(dir);
      if (!exists) return;
      const names = await fs.promises.readdir(dir);
      for (const name of names) {
        const full = path.join(dir, name);
        const stat = await fs.promises.stat(full).catch(() => undefined as any);
        if (!stat) continue;
        if (stat.isDirectory()) {
          await tryScan(full);
        } else if (stat.isFile() && /\.(js|ts)$/.test(name)) {
          const text = await fs.promises.readFile(full, 'utf8').catch(() => '');
          // perms.includes("xxx") 是当前项目对权限原子引用的统一写法
          const regex = /perms\.includes\(["'`]([^"'`]+)["'`]\)/g;
          const routes: Array<{ idx: number; method: string; path: string }> = [];
          // routeRegexA：匹配 router.get('/path', ...) 这一类定义
          const routeRegexA = /router\.(get|post|patch|put|delete)\s*\(\s*(["'`])([^"'`]+)\2/g;
          // routeRegexB：匹配 app.get('/path', ...) 或其他对象上的 get/post 等
          const routeRegexB = /\.(get|post|patch|put|delete)\(\s*(["'`])([^"'`]+)\2/g;
          {
            let rm: RegExpExecArray | null;
            while ((rm = routeRegexA.exec(text))) {
              routes.push({ idx: rm.index, method: rm[1], path: rm[3] });
            }
            while ((rm = routeRegexB.exec(text))) {
              routes.push({ idx: rm.index, method: rm[1], path: rm[3] });
            }
            routes.sort((a, b) => a.idx - b.idx);
          }
          let m: RegExpExecArray | null;
          // 针对每一个 perms.includes('xxx')：
          // - 记录动作字符串 rawAct
          // - 找到最近的路由定义作为其“语义上的绑定接口”
          while ((m = regex.exec(text))) {
            const rawAct = m[1];
            addScanned(rawAct);
            let nearest: { idx: number; method: string; path: string } | undefined = undefined;
            for (let i = routes.length - 1; i >= 0; i--) {
              const r = routes[i];
              if (r.idx <= m.index) {
                nearest = r;
                break;
              }
            }
            if (!nearest && routes.length > 0) {
              let forward: { idx: number; method: string; path: string } | undefined = undefined;
              for (let i = 0; i < routes.length; i++) {
                const r = routes[i];
                if (r.idx >= m.index) {
                  forward = r;
                  break;
                }
              }
              nearest = forward || routes[0];
            }
            if (nearest) {
              const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
              const routeNameMatch = rel.match(/routes\/([^\/\.]+)/);
              const routeName = routeNameMatch ? routeNameMatch[1] : undefined;
              const base = routeName ? baseMap[routeName] || '' : '';
              if (!base) {
                continue;
              }
              const fullPath = normalizeFullPath(base, nearest.path || '');
              const verb = /^get|head$/i.test(nearest.method) ? 'read' : 'write';
              const baseAct = rawAct.split(':')[0];
              const act = `${baseAct}:${verb}`;
              const one = { method: nearest.method.toUpperCase(), path: fullPath, file: rel };
              const arr = details[act] || [];
              const idx = arr.findIndex((x) => x.method === one.method && x.path === one.path);
              if (idx >= 0) {
                const existing = arr[idx];
                const preferNew =
                  existing.file.startsWith('dist/') && !one.file.startsWith('dist/');
                if (preferNew) arr[idx] = one;
              } else {
                arr.push(one);
              }
              details[act] = arr;
            }
          }

          // 将某个动作与具体接口（method + path + file）做关联，用于 details 输出
          const addDetail = (act: string, method: string, fullPath: string, rel: string) => {
            const one = { method: method.toUpperCase(), path: fullPath, file: rel };
            const arr = details[act] || [];
            const idx = arr.findIndex((x) => x.method === one.method && x.path === one.path);
            if (idx >= 0) {
              const existing = arr[idx];
              const preferNew = existing.file.startsWith('dist/') && !one.file.startsWith('dist/');
              if (preferNew) arr[idx] = one;
            } else {
              arr.push(one);
            }
            details[act] = arr;
          };

          const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
          const routeNameMatch = rel.match(/routes\/([^\/\.]+)/);
          const routeName = routeNameMatch ? routeNameMatch[1] : '';
          const base = baseMap[routeName] || '';
          if (base) {
            // 针对每个发现的路由定义，根据文件名与路径推导“动作前缀”（actionBase）
            // 目前只对 clouds 路由做了较细粒度的拆分，其余可以按需要扩展
            for (const r of routes) {
              const fullPath = normalizeFullPath(base, r.path || '');
              const p = fullPath.toLowerCase();
              let actionBase = '';
              if (routeName === 'clouds') {
                if (
                  p.includes('/resources/ecs') ||
                  p.includes('/inventory/instances') ||
                  p.includes('/resources/ecs-all')
                )
                  actionBase = 'clouds.instances';
                else if (p.includes('/resources/vpcs')) actionBase = 'clouds.vpcs';
                else if (p.includes('/resources/vswitches') || p.includes('/resources/subnets'))
                  actionBase = 'clouds.vswitches';
                else if (p.includes('/resources/security-groups'))
                  actionBase = 'clouds.security-groups';
                else if (p.includes('/resources/enis')) actionBase = 'clouds.enis';
                else if (p.includes('/resources/network-acls')) actionBase = 'clouds.network-acls';
                else if (p.includes('/resources/eips')) actionBase = 'clouds.eips';
                else if (p.includes('/resources/loadbalancers'))
                  actionBase = 'clouds.load-balancers';
                else if (p.includes('/resources/nat-gateways')) actionBase = 'clouds.nat-gateways';
                else if (p.includes('/resources/route-tables')) actionBase = 'clouds.route-tables';
                else if (p.includes('/resources/route-entries'))
                  actionBase = 'clouds.route-entries';
                else if (p.includes('/resources/disks')) actionBase = 'clouds.disks';
                else if (p.includes('/resources/snapshots')) actionBase = 'clouds.snapshots';
                else actionBase = 'clouds';
              }
              if (!actionBase) continue;
              const verb = /^get|head$/i.test(r.method) ? 'read' : 'write';
              const act = `${actionBase}:${verb}`;
              add(act);
              addDetail(act, r.method, fullPath, rel);
            }
          }
        }
      }
    } catch {}
  };
  await tryScan(path.join(process.cwd(), 'src', 'routes'));
  res.json({ actions: candidates.sort(), scanned: scanned.sort(), details });
});

// RBAC 角色（策略）列表查询
// 将数据库中的 RBACRole 记录转换为前端所需的策略格式：
// - actions：权限原子数组
// - type：区分“系统策略”和“自定义策略”
// - conditions：预留条件字段，由前端/后端共同约定结构
router.get('/rbac/roles', async (req, res) => {
  try {
    const roleRepo = AppDataSource.getRepository(RBACRole);
    const roles = await roleRepo.find({
      order: { createdAt: 'DESC' }
    });
    // Transform to frontend Policy format
    const SYSTEM_ROLES = ['Super Admin', 'Tenant Admin', 'User', '三权-审计员', '三权-运维操作员', '三权-策略管理员'];
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
router.post('/rbac/roles', async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const hasPerm = Array.isArray(req.user?.permissions) && req.user.permissions.includes('system.roles:write');
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
router.put('/rbac/roles/:id', async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const hasPerm = Array.isArray(req.user?.permissions) && req.user.permissions.includes('system.roles:write');
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
router.patch('/rbac/roles/:id/permissions', async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const hasPerm = Array.isArray(req.user?.permissions) && req.user.permissions.includes('system.roles:write');
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
// - 是否仍被 RoleAssignment 引用
// - 是否仍有 TenantUser 的 role 字段指向该角色
router.delete('/rbac/roles/:id', async (req: any, res) => {
  try {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const hasPerm = Array.isArray(req.user?.permissions) && req.user.permissions.includes('system.roles:write');
    if (!isSuper && !hasPerm)
      return res.status(403).json({ message: '权限不足' });
    const { id } = req.params;
    const repo = AppDataSource.getRepository(RBACRole);
    const row = await repo.findOne({ where: { id } });
    if (!row) return res.status(404).json({ message: '角色不存在' });

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

// 为用户分配角色（仅超级管理员）
// 支持多种 userType（如 'tenant' / 'system' 等），具体含义由业务约定
router.post('/rbac/assignments', async (req: any, res) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN)
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
router.get('/rbac/assignments', async (req: any, res) => {
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

// 取消某条角色分配记录（仅超级管理员）
router.delete('/rbac/assignments/:id', async (req: any, res) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN)
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
