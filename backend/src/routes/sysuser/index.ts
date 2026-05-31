import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { User, UserRole } from '../../entities/User';
import { TenantUser } from '../../entities/TenantUser';
import { Organization } from '../../entities/Organization';
import { Tenant } from '../../entities/Tenant';
import { RBACRole } from '../../entities/RBACRole';
import { RoleAssignment } from '../../entities/RoleAssignment';
import { In } from 'typeorm';
import { AuthRequest } from '../../middleware/auth';
import bcrypt from 'bcryptjs';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';
import { isBuiltInSystemUser } from '../../constants/systemBuiltInUsers';
import {
  getAdminPasswordPolicy,
  validatePasswordAgainstPolicy,
  adminMustChangePassword,
} from '../../services/adminPasswordPolicy';

const sysUserLog = logger.child('Sysuser');

const router = Router();

// 获取系统用户列表
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const users = (await userRepository.find({ order: { createdAt: 'DESC' } })).map((u: any) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      builtIn: isBuiltInSystemUser(u.username),
    }));

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: '获取用户列表失败' });
  }
});

// 获取所有租户用户列表（用于用户管理页面）
router.get('/tenant-users', async (req: AuthRequest, res: Response) => {
  try {
    const tenantUserRepository = AppDataSource.getRepository(TenantUser);
    const organizationRepository = AppDataSource.getRepository(Organization);
    const tenantRepository = AppDataSource.getRepository(Tenant);

    // 获取所有租户用户
    const tenantUsers = await tenantUserRepository.find({
      order: { createdAt: 'DESC' },
    });

    const userIds = tenantUsers.map((u) => u.id).filter(Boolean);
    const assignmentRepository = AppDataSource.getRepository(RoleAssignment);
    const rbacRoleRepository = AppDataSource.getRepository(RBACRole);

    /** userId -> 该用户在 rbac 中的角色（真实权限来源，TenantUser.role 字段仅为占位） */
    const assignmentsByUser = new Map<string, RoleAssignment[]>();
    let rbacRoleMap = new Map<string, RBACRole>();
    if (userIds.length > 0) {
      const assignments = await assignmentRepository.find({
        where: { userType: 'tenant', userId: In(userIds) },
      });
      for (const a of assignments) {
        const list = assignmentsByUser.get(a.userId);
        if (list) list.push(a);
        else assignmentsByUser.set(a.userId, [a]);
      }
      const roleIds = [...new Set(assignments.map((a) => a.roleId))];
      if (roleIds.length > 0) {
        const rbacRows = await rbacRoleRepository.find({ where: { id: In(roleIds) } });
        rbacRoleMap = new Map(rbacRows.map((r) => [r.id, r]));
      }
    }

    // 获取所有组织和租户信息
    const organizations = await organizationRepository.find();
    const tenants = await tenantRepository.find();

    // 构建映射关系
    const orgMap = new Map();
    const tenantMap = new Map();

    organizations.forEach((org) => {
      orgMap.set(org.id, org);
    });

    tenants.forEach((tenant) => {
      tenantMap.set(tenant.id, tenant);
    });

    // 组装用户信息（列表「角色」以 RBAC 分配为准，TenantUser.role 不作为展示依据）
    const enrichedUsers = tenantUsers.map((user) => {
      const organization = orgMap.get(user.organizationId);
      const tenant = tenantMap.get(user.tenantId);

      const assigns = assignmentsByUser.get(user.id) || [];
      const rbacRoles = assigns
        .map((a) => rbacRoleMap.get(a.roleId))
        .filter((r): r is RBACRole => !!r && String(r.status || 'active') === 'active')
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .map((r) => ({
          id: r.id,
          name: r.name,
          scope: r.scope,
        }));

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        /** 历史占位字段（创建后恒多为 `user`），勿用于列表筛选；请用 rbacRoles */
        role: user.role,
        rbacRoles,
        status: user.status,
        createdAt: user.createdAt,
        tenant: tenant
          ? {
              id: tenant.id,
              name: tenant.name,
              description: tenant.description,
            }
          : null,
        organization: organization
          ? {
              id: organization.id,
              name: organization.name,
              level: organization.level,
            }
          : null,
      };
    });

    res.json(enrichedUsers);
  } catch (error) {
    sysUserLog.error(
      '获取租户用户列表失败:',
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ message: '获取租户用户列表失败' });
  }
});

// 获取当前用户信息
router.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: '未授权' });
    }

    let resp: any = null;
    // Check if user is a tenant user (via isTenantUser flag from authMiddleware, or fallback to role check)
    if ((req.user as any).isTenantUser || (req.user as any).role === 'tenant') {
      // tenant user already populated in authMiddleware
      const tu = req.user as any;

      // Fetch full tenant/org info
      let tenantName = undefined;
      let organizationName = undefined;
      try {
        const tenantRepo = AppDataSource.getRepository(TenantUser);
        const fullUser = await tenantRepo.findOne({
          where: { id: tu.id },
          relations: ['tenant', 'organization'],
        });
        tenantName = fullUser?.tenant?.name;
        organizationName = fullUser?.organization?.name;
      } catch (e) {
        sysUserLog.warn(
          'Failed to fetch tenant/org info',
          e instanceof Error ? e.message : String(e),
        );
      }

      let permissions: string[] = [];
      try {
        const trId = tu.role;
        const assignRepo = AppDataSource.getRepository(RoleAssignment);
        const roleRepo = AppDataSource.getRepository(RBACRole);

        // 1. Get explicit assignments
        const assigns = await assignRepo.find({
          where: { userType: 'tenant', userId: tu.id },
        });
        const roleIds = assigns.map((a) => a.roleId);

        // 2. Include primary role if it's a UUID (custom role)
        if (trId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trId)) {
          if (!roleIds.includes(trId)) {
            roleIds.push(trId);
          }
        }

        // 3. Fetch all roles and merge permissions
        if (roleIds.length > 0) {
          const roles = await roleRepo.find({ where: { id: In(roleIds) } });
          for (const r of roles) {
            if (r.permissions) {
              try {
                const raw = JSON.parse(r.permissions);
                if (Array.isArray(raw)) {
                  permissions = permissions.concat(raw);
                }
              } catch {}
            }
          }
        }

        // Deduplicate
        permissions = Array.from(new Set(permissions));
      } catch (e) {
        sysUserLog.warn(
          'Failed to fetch permissions for tenant user',
          e instanceof Error ? e.message : String(e),
        );
      }

      resp = {
        id: tu.id,
        username: tu.username,
        email: tu.email,
        fullName: tu.fullName,
        role: 'tenant',
        tenantRole: tu.role,
        permissions,
        status: tu.status,
        createdAt: tu.createdAt,
        lastLoginAt: tu.lastLoginAt,
        tenantName,
        organizationName,
        tenantId: tu.tenantId, // 租户ID
        organizationId: tu.organizationId, // 组织ID
      };
    } else {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: req.user.id },
        relations: ['accessibleClouds'],
      });
      if (!user) return res.status(404).json({ message: '用户不存在' });
      // 使用 authMiddleware 已经计算好的 permissions（包含 super_admin 的 ['*']）
      const permissions = Array.isArray((req.user as any).permissions)
        ? (req.user as any).permissions
        : [];
      resp = {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        accessibleClouds: user.accessibleClouds,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        permissions, // 返回权限列表
        mustChangePassword: adminMustChangePassword(user),
      };
    }

    res.json(resp);
  } catch (error) {
    res.status(500).json({ message: '获取用户信息失败' });
  }
});

// 更新用户信息
router.put('/me', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: '未授权' });
    }

    const { fullName, phone, company, description } = req.body;
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    user.fullName = fullName || user.fullName;
    user.phone = phone || user.phone;
    user.company = company || user.company;
    user.description = description || user.description;

    await userRepository.save(user);

    res.json({ message: '用户信息更新成功', user });
  } catch (error) {
    res.status(500).json({ message: '更新用户信息失败' });
  }
});

router.post('/me/password', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: '未授权' });
    }

    const { oldPassword, newPassword } = req.body || {};
    const oldPwd = String(oldPassword || '').trim();
    const newPwd = String(newPassword || '').trim();

    if (!oldPwd || !newPwd) {
      return res.status(400).json({ message: '缺少 oldPassword 或 newPassword' });
    }
    const policy = getAdminPasswordPolicy();
    const v = validatePasswordAgainstPolicy(newPwd, policy, { username: req.user?.username });
    if (!v.ok) {
      return res.status(400).json({ message: v.message });
    }

    if ((req.user as any).isTenantUser || (req.user as any).role === 'tenant') {
      const tenantRepo = AppDataSource.getRepository(TenantUser);
      const tu = await tenantRepo.findOne({ where: { id: req.user.id } });
      if (!tu) {
        return res.status(404).json({ message: '用户不存在' });
      }
      const tenantOk = await bcrypt.compare(oldPwd, tu.password);
      if (!tenantOk) {
        return res.status(400).json({ message: '原密码错误' });
      }
      tu.password = await bcrypt.hash(newPwd, 10);
      await tenantRepo.save(tu);
      return res.json({ message: '密码修改成功' });
    }

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const ok = await bcrypt.compare(oldPwd, user.password);
    if (!ok) {
      return res.status(400).json({ message: '原密码错误' });
    }

    user.password = await bcrypt.hash(newPwd, 10);
    user.passwordChangedAt = new Date();
    await userRepository.save(user);

    res.json({ message: '密码修改成功' });
  } catch (error) {
    res.status(500).json({ message: '修改密码失败' });
  }
});

// 超级管理员：更新用户状态
router.put('/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: '未授权' });
    const perms: string[] = Array.isArray((req.user as any).permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'users:write'))
      return res.status(403).json({ message: '权限不足' });

    const { id } = req.params;
    const { status } = req.body;

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id } });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    if (String(req.user.id) === String(id)) {
      return res.status(400).json({ message: '不能修改当前登录账户的状态' });
    }

    user.status = status;
    await userRepository.save(user);

    res.json({ message: '用户状态更新成功', user });
  } catch (error) {
    res.status(500).json({ message: '更新用户状态失败' });
  }
});

// 创建系统用户（仅超级管理员）
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: '未授权' });
    const perms: string[] = Array.isArray((req.user as any).permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'users:write'))
      return res.status(403).json({ message: '权限不足' });
    const { username, email, password, fullName, role } = req.body;
    if (!username?.trim() || !email?.trim() || !password?.trim() || !fullName?.trim()) {
      return res.status(400).json({ message: '缺少必填字段：username/email/password/fullName' });
    }
    if (role && String(role) !== UserRole.ADMIN) {
      return res
        .status(400)
        .json({ message: '创建系统用户时不允许指定为超级管理员，请先创建管理员后再按需赋权' });
    }
    const userRepository = AppDataSource.getRepository(User);
    const existed = await userRepository.findOne({ where: [{ username }, { email }] });
    if (existed) return res.status(400).json({ message: '用户名或邮箱已存在' });
    const policy = getAdminPasswordPolicy();
    const pv = validatePasswordAgainstPolicy(String(password), policy, {
      username: String(username),
    });
    if (!pv.ok) {
      return res.status(400).json({ message: pv.message });
    }
    const hashed = await bcrypt.hash(password, 10);
    const now = new Date();
    const user = userRepository.create({
      username,
      email,
      password: hashed,
      fullName,
      role: UserRole.ADMIN,
      passwordChangedAt: policy.requirePasswordChangeOnFirstLogin ? null : now,
    });
    const saved = await userRepository.save(user);
    res.status(201).json({
      id: saved.id,
      username: saved.username,
      email: saved.email,
      fullName: saved.fullName,
      role: saved.role,
    });
  } catch (e: any) {
    res.status(500).json({ message: '创建用户失败', error: String(e) });
  }
});

// 超级管理员：删除系统用户
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: '未授权' });
    const perms: string[] = Array.isArray((req.user as any).permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'users:write'))
      return res.status(403).json({ message: '权限不足' });
    const { id } = req.params;
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    if (req.user.id === user.id) {
      return res.status(400).json({ message: '不能删除当前登录的账户' });
    }
    if (isBuiltInSystemUser(user.username)) {
      return res.status(400).json({ message: '内置用户不允许删除' });
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      const count = await userRepository.count({ where: { role: UserRole.SUPER_ADMIN } });
      if (count <= 1) {
        return res.status(400).json({ message: '不能删除最后一个超级管理员' });
      }
    }
    const assignRepo = AppDataSource.getRepository(RoleAssignment);
    await assignRepo.delete({ userType: 'system', userId: id });
    await userRepository.remove(user);
    res.json({ message: '用户删除成功' });
  } catch (error) {
    res.status(500).json({ message: '删除用户失败' });
  }
});

// 编辑系统用户的处理函数（PUT 和 PATCH 共用）
const updateUserHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: '未授权' });
    const perms: string[] = Array.isArray((req.user as any).permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'users:write'))
      return res.status(403).json({ message: '权限不足' });
    const { id } = req.params;
    const { username, email, fullName, role, status, password } = req.body as any;
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id } });
    if (!user) return res.status(404).json({ message: '用户不存在' });

    if (status && String(status) !== String(user.status) && String(req.user.id) === String(id)) {
      return res.status(400).json({ message: '不能修改当前登录账户的状态' });
    }

    // 唯一性检查
    if (username && username !== user.username) {
      const existed = await userRepository.findOne({ where: { username } });
      if (existed) return res.status(400).json({ message: '用户名已存在' });
      user.username = username;
    }
    if (email && email !== user.email) {
      const existed = await userRepository.findOne({ where: { email } });
      if (existed) return res.status(400).json({ message: '邮箱已存在' });
      user.email = email;
    }
    if (fullName) user.fullName = fullName;
    if (role) user.role = role;
    if (status) user.status = status;
    if (password && String(password).trim()) {
      const policy = getAdminPasswordPolicy();
      const pv = validatePasswordAgainstPolicy(String(password).trim(), policy, {
        username: user.username,
      });
      if (!pv.ok) {
        return res.status(400).json({ message: pv.message });
      }
      user.password = await bcrypt.hash(String(password).trim(), 10);
      user.passwordChangedAt = new Date();
    }

    const saved = await userRepository.save(user);
    res.json({
      id: saved.id,
      username: saved.username,
      email: saved.email,
      fullName: saved.fullName,
      role: saved.role,
      status: saved.status,
      password: saved.password,
    });
  } catch (e: any) {
    res.status(500).json({ message: '更新用户失败', error: String(e) });
  }
};

// 超级管理员：编辑系统用户（支持更新基础信息与密码）
router.put('/:id', updateUserHandler);
router.patch('/:id', updateUserHandler);

export { router as userRoutes };
