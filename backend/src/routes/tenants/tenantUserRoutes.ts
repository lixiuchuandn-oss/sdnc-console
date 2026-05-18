import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../config/database';
import { RBACRole } from '../../entities/RBACRole';
import { RoleAssignment } from '../../entities/RoleAssignment';
import { TenantUser } from '../../entities/TenantUser';
import { tenantLog } from './tenantRouteLogger';

export function registerTenantUserRoutes(router: Router): void {
  router.get('/:tenantId/users', async (req, res) => {
    try {
      const userRepository = AppDataSource.getRepository(TenantUser);
      const users = await userRepository.find({
        where: {
          tenantId: req.params.tenantId,
        },
        order: { createdAt: 'DESC' },
      });

      res.json(users);
    } catch (error) {
      tenantLog.error('获取租户用户列表失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '获取租户用户列表失败' });
    }
  });

  router.get('/:tenantId/organizations/:orgId/users', async (req, res) => {
    try {
      const userRepository = AppDataSource.getRepository(TenantUser);
      const users = await userRepository.find({
        where: {
          organizationId: req.params.orgId,
          tenantId: req.params.tenantId,
        },
        order: { createdAt: 'DESC' },
      });

      res.json(users);
    } catch (error) {
      tenantLog.error('获取用户列表失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '获取用户列表失败' });
    }
  });

  router.post('/:tenantId/organizations/:orgId/users', async (req, res) => {
    try {
      const { username, email, fullName, password, role } = req.body;
      const { tenantId, orgId } = req.params;

      if (!username?.trim() || !email?.trim() || !fullName?.trim() || !password?.trim()) {
        return res.status(400).json({ message: '用户名、邮箱、姓名和密码不能为空' });
      }

      const userRepository = AppDataSource.getRepository(TenantUser);

      const existingUser = await userRepository.findOne({
        where: [{ username }, { email }],
      });

      if (existingUser) {
        return res.status(400).json({ message: '用户名或邮箱已存在' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = userRepository.create({
        username,
        email,
        fullName,
        password: hashedPassword,
        role: 'user',
        organizationId: orgId,
        tenantId,
        status: 'active',
      });

      const savedUser = await userRepository.save(user);

      const roleId = typeof role === 'string' ? role.trim() : '';
      if (roleId) {
        try {
          const roleRepo = AppDataSource.getRepository(RBACRole);
          const rbacRole = await roleRepo.findOne({ where: { id: roleId } });
          if (rbacRole && rbacRole.scope === 'tenant' && rbacRole.status === 'active') {
            const assignRepo = AppDataSource.getRepository(RoleAssignment);
            const existed = await assignRepo.findOne({
              where: { roleId: roleId, userType: 'tenant', userId: savedUser.id },
            });
            if (!existed) {
              const row = assignRepo.create({
                roleId: roleId,
                userType: 'tenant',
                userId: savedUser.id,
              });
              await assignRepo.save(row);
            }
          }
        } catch (e) {
          tenantLog.error(
            '创建用户时写入 RBAC 分配失败（不影响用户创建）:',
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      const { password: _, ...userWithoutPassword } = savedUser;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      tenantLog.error('创建用户失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '创建用户失败' });
    }
  });

  router.put('/:tenantId/organizations/:orgId/users/:userId', async (req, res) => {
    try {
      const { tenantId, orgId, userId } = req.params;
      const { email, fullName, password, status } = req.body;

      const userRepository = AppDataSource.getRepository(TenantUser);
      const tenantUser = await userRepository.findOne({
        where: {
          id: userId,
          organizationId: orgId,
          tenantId: tenantId,
        },
      });

      if (!tenantUser) {
        return res.status(404).json({ message: '用户不存在' });
      }

      if (email && email !== tenantUser.email) {
        const existingUser = await userRepository.findOne({ where: { email } });
        if (existingUser) {
          return res.status(400).json({ message: '邮箱已存在' });
        }
        tenantUser.email = email;
      }

      if (fullName) tenantUser.fullName = fullName;
      if (password) {
        tenantUser.password = await bcrypt.hash(password, 10);
      }
      if (status) tenantUser.status = status;

      const updatedUser = await userRepository.save(tenantUser);

      const { password: _, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error) {
      tenantLog.error('更新用户失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '更新用户失败' });
    }
  });

  router.delete('/:tenantId/organizations/:orgId/users/:userId', async (req, res) => {
    try {
      const { tenantId, orgId, userId } = req.params;

      const userRepository = AppDataSource.getRepository(TenantUser);
      const user = await userRepository.findOne({
        where: {
          id: userId,
          organizationId: orgId,
          tenantId: tenantId,
        },
      });

      if (!user) {
        return res.status(404).json({ message: '用户不存在' });
      }

      const rbacAssignRepo = AppDataSource.getRepository(RoleAssignment);
      await rbacAssignRepo.delete({ userType: 'tenant', userId: userId });
      await userRepository.remove(user);

      res.json({ message: '用户删除成功' });
    } catch (error) {
      tenantLog.error('删除用户失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '删除用户失败' });
    }
  });
}
