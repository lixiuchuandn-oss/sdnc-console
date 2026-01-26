import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { User, UserRole } from '../entities/User';
import { TenantUser } from '../entities/TenantUser';

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
    const { username, password } = req.body;

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
    if (adminCandidate && (await bcrypt.compare(password, adminCandidate.password))) {
      loginUser = adminCandidate;
      role = adminCandidate.role;
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
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 状态检查（租户用户有 status 字段，管理员用户字段名可能不同）
    if (
      (loginUser.status && loginUser.status !== 'active') ||
      (loginUser.status && loginUser.status !== 'active')
    ) {
      return res.status(401).json({ message: '账户已被禁用' });
    }

    // 更新最后登录
    (loginUser as any).lastLoginAt = new Date();
    if (role === 'tenant') {
      await tenantRepo.save(loginUser);
    } else {
      await userRepository.save(loginUser);
    }

    const token = jwt.sign(
      { userId: loginUser.id, role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' },
    );

    res.json({
      message: '登录成功',
      token,
      user: {
        id: loginUser.id,
        username: loginUser.username,
        email: loginUser.email,
        fullName: loginUser.fullName,
        role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: '登录失败', error: error.message });
  }
});

export { router as authRoutes };
