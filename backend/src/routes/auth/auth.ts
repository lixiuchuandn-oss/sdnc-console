import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../config/database';
import { User, UserRole } from '../../entities/User';
import { TenantUser } from '../../entities/TenantUser';
import { RBACRole } from '../../entities/RBACRole';
import { RoleAssignment } from '../../entities/RoleAssignment';
import { In } from 'typeorm';
import { logger } from '../../utils/logger';
import { adminMustChangePassword } from '../../services/adminPasswordPolicy';
import {
  checkLoginLockout,
  clearLoginFailures,
  recordLoginFailure,
} from '../../services/loginLockoutService';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { resolveAdminDefaultHome } from '../../services/AdminDefaultHomeService';
import { stripTenantConsoleUmbrellaPermissions } from '../../constants/tenantConsolePermissionLegacy';
import {
  getLoginPublicKey,
  resolvePasswordFromLoginBody,
} from '../../services/loginPasswordCipher';

const authLog = logger.child('Auth');

const router = Router();

/** 登录 RSA 公钥（匿名可读；未配置密钥时 503） */
router.get('/login-public-key', (_req: Request, res: Response) => {
  const info = getLoginPublicKey();
  if (!info) {
    return res.status(503).json({ message: '登录加密未配置', code: 'LOGIN_CIPHER_NOT_CONFIGURED' });
  }
  return res.json(info);
});

// 用户注册
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password, fullName, role = UserRole.TENANT } = req.body;

    const userRepository = AppDataSource.getRepository(User);

    // 检查用户是否已存在
    const existingUser = await userRepository.findOne({
      where: [{ username }, { email }],
    });

    if (existingUser) {
      return res.status(400).json({ message: '用户名或邮箱已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户
    const user = userRepository.create({
      username,
      email,
      password: hashedPassword,
      fullName,
      role,
    });

    await userRepository.save(user);

    // 生成JWT令牌
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' },
    );

    res.status(201).json({
      message: '用户注册成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: '注册失败', error: error.message });
  }
});

// 用户登录
router.post('/login', async (req: Request, res: Response) => {
  try {
    let { username } = req.body;
    username = String(username || '').trim();

    const resolved = resolvePasswordFromLoginBody(req.body);
    if (!resolved.ok) {
      return res.status(resolved.status).json({
        message: resolved.message,
        ...(resolved.code ? { code: resolved.code } : {}),
      });
    }
    const password = resolved.password;

    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }

    const lockBefore = checkLoginLockout(username);
    if (lockBefore.locked) {
      return res.status(401).json({
        message: lockBefore.message,
        code: 'LOGIN_LOCKED',
        lockedUntil: lockBefore.lockedUntil,
        retryAfterSeconds: lockBefore.retryAfterSeconds,
      });
    }

    const userRepository = AppDataSource.getRepository(User);
    const tenantRepo = AppDataSource.getRepository(TenantUser);

    const adminCandidate = await userRepository.findOne({
      where: [{ username }, { email: username }],
    });
    const tenantCandidate: any = await tenantRepo.findOne({
      where: [{ username }, { email: username }],
    });

    let loginUser: any = null;
    let role: string = '';

    // 1) 如果管理员表存在且密码匹配 → 认为是管理员/超级管理员
    if (adminCandidate) {
      const passwordMatch = await bcrypt.compare(password, adminCandidate.password);
      if (process.env.NODE_ENV === 'development') {
        authLog.debug('管理员密码验证:', {
          username: adminCandidate.username,
          match: passwordMatch,
        });
      }
      if (passwordMatch) {
        loginUser = adminCandidate;
        role = adminCandidate.role;
      }
    }

    // 2) 否则尝试租户表
    if (
      !loginUser &&
      tenantCandidate &&
      (await bcrypt.compare(password, tenantCandidate.password))
    ) {
      loginUser = tenantCandidate;
      role = 'tenant';
    }

    if (!loginUser) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Login] 登录失败: 用户名或密码错误', {
          username,
          hasAdmin: !!adminCandidate,
          hasTenant: !!tenantCandidate,
        });
      }
      const failResult = recordLoginFailure(username);
      if (failResult.locked) {
        return res.status(401).json({
          message: failResult.message,
          code: 'LOGIN_LOCKED',
          lockedUntil: failResult.lockedUntil,
          retryAfterSeconds: failResult.retryAfterSeconds,
        });
      }
      const remain = failResult.remainingAttempts;
      const failMsg = remain > 0 ? `用户名或密码错误，还可尝试 ${remain} 次` : '用户名或密码错误';
      return res.status(401).json({
        message: failMsg,
        remainingAttempts: remain,
      });
    }

    clearLoginFailures(username);

    // 状态检查（与「用户名或密码错误」区分开，前端将原样展示 message）
    if (loginUser.status && loginUser.status !== 'active') {
      const st = String(loginUser.status).toLowerCase();
      let lockedMessage: string;
      if (st === 'suspended') {
        lockedMessage =
          role === 'tenant'
            ? '该账号已被锁定，暂时无法登录。如需解禁请联系租户管理员。'
            : '该账号已被锁定，暂时无法登录。如需解禁请联系系统管理员。';
      } else {
        lockedMessage =
          role === 'tenant'
            ? '该账号已被停用，暂时无法登录。如需解禁请联系租户管理员。'
            : '该账号已被停用，暂时无法登录。如需解禁请联系系统管理员。';
      }
      return res.status(401).json({
        message: lockedMessage,
        code: 'USER_NOT_ACTIVE',
        status: st,
      });
    }

    // 更新最后登录
    (loginUser as any).lastLoginAt = new Date();

    let permissions: string[] = [];

    // 如果是超级管理员，直接赋予所有权限
    if (role === 'super_admin') {
      permissions = ['*'];
    } else {
      // Fetch permissions for both tenant and system users（完全由 RoleAssignment 计算）
      try {
        const assignRepo = AppDataSource.getRepository(RoleAssignment);
        const roleRepo = AppDataSource.getRepository(RBACRole);
        const userType = role === 'tenant' ? 'tenant' : 'system';

        // 权限完全由 RoleAssignment 计算
        const assigns = await assignRepo.find({
          where: { userType, userId: loginUser.id },
        });
        const roleIds = assigns.map((a) => a.roleId);

        // Fetch all roles and merge permissions
        if (roleIds.length > 0) {
          const roles = await roleRepo.find({ where: { id: In(roleIds) } });
          for (const r of roles) {
            // 只聚合活跃角色的权限，过滤掉禁用角色
            if (r.status !== 'active') {
              continue;
            }
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

        // 租户控制台入口改由账号类型判定；不再默认注入 clouds.console:read
        // Deduplicate
        permissions = Array.from(new Set(permissions));
        if (role === 'tenant') {
          permissions = stripTenantConsoleUmbrellaPermissions(permissions);
        }
      } catch (e) {
        authLog.warn(
          `Failed to fetch permissions for ${role} user`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // 保存用户（更新最后登录时间）
    try {
      if (role === 'tenant') {
        await tenantRepo.save(loginUser);
      } else {
        await userRepository.save(loginUser);
      }
    } catch (saveError: any) {
      authLog.warn('保存用户信息失败（不影响登录）:', saveError?.message ?? String(saveError));
      // 保存失败不影响登录，继续执行
    }

    const token = jwt.sign(
      { userId: loginUser.id, role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' },
    );

    // 租户用户：补充租户/组织 ID 与名称，以便前端右上角登录后立即显示；用 null 占位保证 JSON 中一定带这四键（undefined 会被 JSON.stringify 省略）
    let tenantId: string | null = null;
    let organizationId: string | null = null;
    let tenantName: string | null = null;
    let organizationName: string | null = null;
    if (role === 'tenant') {
      const tu = loginUser as TenantUser;
      tenantId = tu.tenantId ?? null;
      organizationId = tu.organizationId ?? null;
      try {
        const fullUser = await tenantRepo.findOne({
          where: { id: loginUser.id },
          relations: ['tenant', 'organization'],
        });
        if (fullUser?.tenant?.name) tenantName = fullUser.tenant.name;
        if (fullUser?.organization?.name) organizationName = fullUser.organization.name;
      } catch (e) {
        authLog.warn(
          'Failed to fetch tenant/org names for login response',
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const userPayload: Record<string, any> = {
      id: loginUser.id,
      username: loginUser.username,
      email: loginUser.email,
      fullName: loginUser.fullName,
      role,
      accountType: role === 'tenant' ? 'tenant' : 'system',
      tenantRole: role === 'tenant' ? (loginUser as TenantUser).role : undefined,
      permissions,
    };
    if (role === 'tenant') {
      userPayload.tenantId = tenantId;
      userPayload.organizationId = organizationId;
      userPayload.tenantName = tenantName;
      userPayload.organizationName = organizationName;
    } else {
      userPayload.mustChangePassword = adminMustChangePassword(loginUser as User);
    }

    const adminDefaultHome =
      role === 'sase_device' ? undefined : await resolveAdminDefaultHome(permissions, role);

    if (role === 'tenant') {
      userPayload.defaultPath = adminDefaultHome?.defaultPath ?? '/console';
    }

    res.json({
      message: '登录成功',
      token,
      user: userPayload,
      adminDefaultHome,
      defaultPath: adminDefaultHome?.defaultPath,
    });
  } catch (error: any) {
    res.status(500).json({ message: '登录失败', error: error.message });
  }
});

/**
 * 当前令牌下的默认管理端首页路径及顺位过程（`resolveAdminDefaultHome`）。
 * 需在请求头携带 `Authorization: Bearer <token>`。
 */
router.get('/admin-default-home', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const u = req.user as any;
    if (!u) {
      return res.status(401).json({ message: '未认证' });
    }
    if ((u as any).role === 'sase_device') {
      return res.status(400).json({ message: '当前身份不适用默认管理端首页' });
    }
    const role = u.isTenantUser ? 'tenant' : String(u.role || '').toLowerCase();
    const permissions = Array.isArray(u.permissions) ? u.permissions : [];
    const adminDefaultHome = await resolveAdminDefaultHome(permissions, role);
    return res.json(adminDefaultHome);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || '解析失败' });
  }
});

export { router as authRoutes };
