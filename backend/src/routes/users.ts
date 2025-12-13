import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User, UserRole } from '../entities/User';
import { TenantUser } from '../entities/TenantUser';
import { Organization } from '../entities/Organization';
import { Tenant } from '../entities/Tenant';
import { AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const router = Router();

// 获取系统用户列表
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const users = (await userRepository.find()).map((u: any) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      builtIn: u.username === 'admin'
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
      order: { createdAt: 'DESC' }
    });

    // 获取所有组织和租户信息
    const organizations = await organizationRepository.find();
    const tenants = await tenantRepository.find();

    // 构建映射关系
    const orgMap = new Map();
    const tenantMap = new Map();
    
    organizations.forEach(org => {
      orgMap.set(org.id, org);
    });
    
    tenants.forEach(tenant => {
      tenantMap.set(tenant.id, tenant);
    });

    // 组装用户信息
    const enrichedUsers = tenantUsers.map(user => {
      const organization = orgMap.get(user.organizationId);
      const tenant = tenantMap.get(user.tenantId);
      
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        tenant: tenant ? {
          id: tenant.id,
          name: tenant.name,
          description: tenant.description
        } : null,
        organization: organization ? {
          id: organization.id,
          name: organization.name,
          level: organization.level
        } : null
      };
    });

    res.json(enrichedUsers);
  } catch (error) {
    console.error('获取租户用户列表失败:', error);
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
    if ((req.user as any).role === 'tenant') {
      // tenant user already populated in authMiddleware
      const tu = req.user as any;
      resp = {
        id: tu.id,
        username: tu.username,
        email: tu.email,
        fullName: tu.fullName,
        role: 'tenant',
        status: tu.status,
        createdAt: tu.createdAt,
        lastLoginAt: tu.lastLoginAt
      };
    } else {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: req.user.id },
        relations: ['accessibleClouds']
      });
      if (!user) return res.status(404).json({ message: '用户不存在' });
      resp = {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        accessibleClouds: user.accessibleClouds,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
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

// 超级管理员：更新用户状态
router.put('/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { status } = req.body;

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id } });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    user.status = status;
    await userRepository.save(user);

    res.json({ message: '用户状态更新成功', user });
  } catch (error) {
    res.status(500).json({ message: '更新用户状态失败' });
  }
});

export { router as userRoutes };

// 创建系统用户（仅超级管理员）
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ message: '权限不足' });
    }
    const { username, email, password, fullName, role = UserRole.LEASED_LINES_ADMIN } = req.body;
    if (!username?.trim() || !email?.trim() || !password?.trim() || !fullName?.trim()) {
      return res.status(400).json({ message: '缺少必填字段：username/email/password/fullName' });
    }
    const userRepository = AppDataSource.getRepository(User);
    const existed = await userRepository.findOne({ where: [{ username }, { email }] });
    if (existed) return res.status(400).json({ message: '用户名或邮箱已存在' });
    const hashed = await bcrypt.hash(password, 10);
    const user = userRepository.create({ username, email, password: hashed, fullName, role });
    const saved = await userRepository.save(user);
    res.status(201).json({ id: saved.id, username: saved.username, email: saved.email, fullName: saved.fullName, role: saved.role });
  } catch (e: any) {
    res.status(500).json({ message: '创建用户失败', error: String(e) });
  }
});

// 超级管理员：删除系统用户
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ message: '权限不足' });
    }
    const { id } = req.params;
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    if (req.user.id === user.id) {
      return res.status(400).json({ message: '不能删除当前登录的账户' });
    }
    if (user.username === 'admin') {
      return res.status(400).json({ message: '内置用户不允许删除' });
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      const count = await userRepository.count({ where: { role: UserRole.SUPER_ADMIN } });
      if (count <= 1) {
        return res.status(400).json({ message: '不能删除最后一个超级管理员' });
      }
    }
    await userRepository.remove(user);
    res.json({ message: '用户删除成功' });
  } catch (error) {
    res.status(500).json({ message: '删除用户失败' });
  }
});

// 超级管理员：编辑系统用户（支持更新基础信息与密码）
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ message: '权限不足' });
    }
    const { id } = req.params;
    const { username, email, fullName, role, status, password } = req.body as any;
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id } });
    if (!user) return res.status(404).json({ message: '用户不存在' });

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
      user.password = await bcrypt.hash(String(password).trim(), 10);
    }

    const saved = await userRepository.save(user);
    res.json({ id: saved.id, username: saved.username, email: saved.email, fullName: saved.fullName, role: saved.role, status: saved.status, password: saved.password });
  } catch (e: any) {
    res.status(500).json({ message: '更新用户失败', error: String(e) });
  }
});