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
import { UserRole } from '../entities/User';

const router = Router();

router.get('/dify-config', async (_req, res) => {
  const cfg = getDifyConfig();
  const safe = { ...cfg } as any;
  res.json({ config: { ...safe, apiKey: !!cfg.apiKey ? '****' : '' } });
});

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

router.get('/settings/:key', (req, res) => {
  const key = req.params.key;
  const value = getSystemSetting(key);
  res.json({ data: { key, value: value || '' } });
});

router.patch('/settings/:key', (req, res) => {
  const key = req.params.key;
  const { value } = req.body;
  setSystemSetting(key, String(value || ''));
  res.json({ data: { key, value: String(value || '') } });
});

router.get('/rbac/actions', async (_req, res) => {
  const candidates: string[] = [];
  const scanned: string[] = [];
  const details: Record<string, Array<{ method: string; path: string; file: string }>> = {};
  const add = (x: string) => {
    if (x && !candidates.includes(x)) candidates.push(x);
  };
  const addScanned = (x: string) => {
    if (!x) return;
    if (!scanned.includes(x)) scanned.push(x);
    add(x);
  };
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
    'tenants.leased-lines.list:read',
    'tenants.leased-lines.manage:write',
    'tenants.leased-lines.reports:read',
    'tenants.leased-lines.reports:write',
    'tenants.leased-lines.alert-logs:read',
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
    // 可信数据空间
    'trust.spaces:read',
    'trust.spaces:write',
    'trust.datasets:read',
    'trust.datasets:write',
  ];
  curated.forEach(addScanned);

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
    } catch {}
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
          const regex = /perms\.includes\(["'`]([^"'`]+)["'`]\)/g;
          const routes: Array<{ idx: number; method: string; path: string }> = [];
          const routeRegexA = /router\.(get|post|patch|put|delete)\s*\(\s*(["'`])([^"'`]+)\2/g;
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

// RBAC Roles (Policies) API
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
        actions: Array.isArray(actions) ? actions : [],
        groups: [], // Calculated on frontend
        conditions,
        createdAt: r.createdAt
      };
    });
    res.json(list);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch roles', error });
  }
});

// 创建角色（仅超级管理员或拥有 system.roles:write 权限）
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

// 删除角色（仅超级管理员或拥有 system.roles:write 权限）
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
router.post('/rbac/assignments', async (req: any, res) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN)
      return res.status(403).json({ message: '权限不足' });
    const { roleId, userType, userId } = req.body as any;
    if (!roleId || !userType || !userId) return res.status(400).json({ message: '缺少必要参数' });
    const assignRepo = AppDataSource.getRepository(RoleAssignment);
    const existed = await assignRepo.findOne({ where: { roleId, userType, userId } });
    if (existed) return res.status(200).json(existed);
    const row = assignRepo.create({ roleId, userType, userId });
    const saved = await assignRepo.save(row);
    res.status(201).json(saved);
  } catch (e: any) {
    res.status(500).json({ message: '分配角色失败', error: String(e) });
  }
});

// 查询用户的角色分配
router.get('/rbac/assignments', async (req: any, res) => {
  try {
    const { userType, userId } = req.query as any;
    if (!userType || !userId) return res.status(400).json({ message: '缺少必要参数' });
    const assignRepo = AppDataSource.getRepository(RoleAssignment);
    const rows = await assignRepo.find({ where: { userType, userId } });
    res.json({ assignments: rows });
  } catch (e: any) {
    res.status(500).json({ message: '查询分配失败', error: String(e) });
  }
});

// 取消分配角色（仅超级管理员）
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

export default router;

// 批量上传告警日志（csv/xls/xlsx）
const tempUploadsDir = path.join(process.cwd(), 'temp_uploads');
if (!fs.existsSync(tempUploadsDir)) fs.mkdirSync(tempUploadsDir, { recursive: true });
const upload = multer({ dest: tempUploadsDir });

router.post('/upload-security-logs', upload.array('files', 50), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ message: '未接收到文件' });
    const cfg = getDifyConfig();
    const logsDir = cfg.logsDir || path.join(process.cwd(), 'data', 'security-logs');
    await fs.promises.mkdir(logsDir, { recursive: true });
    const saved: { fileName: string; size: number; target: string }[] = [];

    const sanitize = (name: string) => name.replace(/[<>:"/\\|?*]+/g, '_');
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
      // Move from temp to target (rename is atomic on same volume, fast)
      // If rename fails (cross-device), copy and unlink
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
    // Cleanup temp files on error
    const files = (req.files as Express.Multer.File[]) || [];
    for (const f of files) {
      if (f.path) await fs.promises.unlink(f.path).catch(() => {});
    }
    console.error('Upload failed:', e);
    res.status(500).json({ message: '保存日志文件失败', error: String(e) });
  }
});

// 列出告警日志文件
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
