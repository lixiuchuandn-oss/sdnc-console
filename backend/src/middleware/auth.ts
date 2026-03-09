import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User';
import { TenantUser } from '../entities/TenantUser';
import { RoleAssignment } from '../entities/RoleAssignment';
import { RBACRole } from '../entities/RBACRole';
import { In } from 'typeorm';

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

    if (decoded.role === 'sase_device') {
      (req as any).user = {
        id: decoded.userId || decoded.deviceFingerprint || 'sase_device',
        role: 'sase_device',
        tenantId: decoded.tenantId,
        organizationId: decoded.organizationId,
        deviceFingerprint: decoded.deviceFingerprint,
        vmId: decoded.vmId,
      };
      return next();
    }

    let user: any = null;

    if (decoded.role === 'tenant') {
      const tenantRepo = AppDataSource.getRepository(TenantUser);
      user = await tenantRepo.findOne({ where: { id: decoded.userId } });
      if (user) {
        (user as any).isTenantUser = true;
      }
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
      const assigns = await assignRepo.find({
        where: { userType: isTenant ? 'tenant' : 'system', userId: user.id },
      });
      const roleIds = assigns.map((a) => a.roleId);

      // If tenant user has a custom role (UUID), include it
      if (isTenant && user.role && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.role)) {
        if (!roleIds.includes(user.role)) {
          roleIds.push(user.role);
        }
      }

      let perms: string[] = [];
      if (roleIds.length) {
        // console.log('[AuthMiddleware] Fetching roles:', roleIds);
        const roles = await roleRepo.find({ where: { id: In(roleIds) } });
        for (const r of roles) {
          // 只聚合活跃角色的权限，过滤掉禁用角色
          if (r.status !== 'active') {
            continue;
          }
          try {
            const arr = JSON.parse(String(r.permissions || '[]')) as string[];
            // console.log(`[AuthMiddleware] Role ${r.name} permissions:`, arr);
            perms = perms.concat(Array.isArray(arr) ? arr : []);
          } catch {}
        }
      }
      try {
        if (decoded.role === 'tenant') {
          perms = perms.concat(['clouds.console:read']);
        }
        if ((user as any).role === 'super_admin') {
          perms = ['*'];
        }
      } catch {}
      (user as any).permissions = Array.from(new Set(perms));
      // console.log('[AuthMiddleware] Final permissions for user:', user.username, (user as any).permissions);
    } catch {}

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: '无效的认证令牌' });
  }
};
