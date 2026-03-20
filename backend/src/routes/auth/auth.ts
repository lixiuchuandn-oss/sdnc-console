import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../config/database';
import { User, UserRole } from '../../entities/User';
import { TenantUser } from '../../entities/TenantUser';
import { RBACRole } from '../../entities/RBACRole';
import { RoleAssignment } from '../../entities/RoleAssignment';
import { In } from 'typeorm';

const router = Router();

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
    let { username, password } = req.body;
    
    // 清理用户名和密码（去除首尾空格）
    username = String(username || '').trim();
    password = String(password || '').trim();

    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
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
        console.log('[Login] 管理员密码验证:', { username: adminCandidate.username, match: passwordMatch });
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
        console.log('[Login] 登录失败: 用户名或密码错误', { username, hasAdmin: !!adminCandidate, hasTenant: !!tenantCandidate });
      }
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 状态检查
    if (loginUser.status && loginUser.status !== 'active') {
      return res.status(401).json({ message: '账户已被禁用' });
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
        
        // 租户用户额外添加默认权限
        if (role === 'tenant') {
          permissions = permissions.concat(['clouds.console:read']);
        }
        
        // Deduplicate
        permissions = Array.from(new Set(permissions));
      } catch (e) {
        console.warn(`Failed to fetch permissions for ${role} user`, e);
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
      console.warn('[Login] 保存用户信息失败（不影响登录）:', saveError?.message || saveError);
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
        console.warn('Failed to fetch tenant/org names for login response', e);
      }
    }

    const userPayload: Record<string, any> = {
      id: loginUser.id,
      username: loginUser.username,
      email: loginUser.email,
      fullName: loginUser.fullName,
      role,
      tenantRole: role === 'tenant' ? (loginUser as TenantUser).role : undefined,
      permissions,
    };
    if (role === 'tenant') {
      userPayload.tenantId = tenantId;
      userPayload.organizationId = organizationId;
      userPayload.tenantName = tenantName;
      userPayload.organizationName = organizationName;
    }

    res.json({
      message: '登录成功',
      token,
      user: userPayload,
    });
  } catch (error: any) {
    res.status(500).json({ message: '登录失败', error: error.message });
  }
});

export { router as authRoutes };
