import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User';
import { TenantUser } from '../entities/TenantUser';
import { RoleAssignment } from '../entities/RoleAssignment';
import { RBACRole } from '../entities/RBACRole';

export interface AuthRequest extends Request {
  user?: User;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const token = headerToken || queryToken;
    
    if (!token) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as any;

    let user: any = null;

    if (decoded.role === 'tenant') {
      const tenantRepo = AppDataSource.getRepository(TenantUser);
      user = await tenantRepo.findOne({ where: { id: decoded.userId } });
    } else {
      const userRepository = AppDataSource.getRepository(User);
      user = await userRepository.findOne({ where: { id: decoded.userId } });
    }

    if (!user) {
      return res.status(401).json({ message: '用户不存在' });
    }

    if (user.status && user.status !== 'active') {
      return res.status(401).json({ message: '用户账户已被禁用' });
    }

    // attach permissions from RBAC roles
    try {
      const assignRepo = AppDataSource.getRepository(RoleAssignment);
      const roleRepo = AppDataSource.getRepository(RBACRole);
      const isTenant = decoded.role === 'tenant';
      const assigns = await assignRepo.find({ where: { userType: isTenant ? 'tenant' : 'system', userId: user.id } });
      const roleIds = assigns.map(a => a.roleId);
      let perms: string[] = [];
      if (roleIds.length) {
        const roles = await roleRepo.findByIds(roleIds as any);
        for (const r of roles) {
          try {
            const arr = JSON.parse(String(r.permissions || '[]')) as string[];
            perms = perms.concat(Array.isArray(arr) ? arr : []);
          } catch {}
        }
      }
      // 默认权限补充：租户允许访问控制台Pro（只读）
      try {
        if (decoded.role === 'tenant') {
          perms = perms.concat(['clouds.console:read']);
        }
      } catch {}
      (user as any).permissions = Array.from(new Set(perms));
    } catch {}

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: '无效的认证令牌' });
  }
};
