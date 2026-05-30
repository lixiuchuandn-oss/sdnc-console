import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User';
import { TenantUser } from '../entities/TenantUser';
import { RoleAssignment } from '../entities/RoleAssignment';
import { RBACRole } from '../entities/RBACRole';
import { In } from 'typeorm';
import { adminMustChangePassword } from '../services/adminPasswordPolicy';
import { stripTenantConsoleUmbrellaPermissions } from '../constants/tenantConsolePermissionLegacy';

function pathnameOnly(url: string): string {
  const p = (url || '').split('?')[0];
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

/** 管理员密码已过期时仍允许访问的接口（改密、拉取自身信息与 RBAC 只读） */
function isMustChangePasswordAllowedRoute(req: Request): boolean {
  const pathname = pathnameOnly(req.originalUrl || req.url || '');
  const method = req.method;
  if (pathname === '/api/users/me' && (method === 'GET' || method === 'PUT')) return true;
  if (pathname === '/api/users/me/password' && method === 'POST') return true;
  /** 登录后默认首页顺位（`GET /api/auth/admin-default-home`）；改密闸门期间仍允许只读拉取 */
  if (
    (pathname === '/api/auth/admin-default-home' || pathname === '/auth/admin-default-home') &&
    method === 'GET'
  ) {
    return true;
  }
  if (method === 'GET' && (pathname === '/api/system/rbac/roles' || pathname.startsWith('/api/system/rbac/assignments'))) {
    return true;
  }
  return false;
}

export interface AuthRequest extends Request {
  // 运行时由 authMiddleware 在 User 实体上附加：RBAC 聚合后的权限列表与租户用户标记
  user?: User & { permissions?: string[]; isTenantUser?: boolean };
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
      // 权限完全由 RoleAssignment 计算，不再使用 TenantUser.role 参与权限

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
        if ((user as any).role === 'super_admin') {
          perms = ['*'];
        }
      } catch {}
      perms = stripTenantConsoleUmbrellaPermissions(perms);
      (user as any).permissions = Array.from(new Set(perms));
      // console.log('[AuthMiddleware] Final permissions for user:', user.username, (user as any).permissions);
    } catch {}

    if (
      decoded.role !== 'tenant' &&
      decoded.role !== 'sase_device' &&
      user &&
      !(user as any).isTenantUser &&
      adminMustChangePassword(user as User)
    ) {
      if (!isMustChangePasswordAllowedRoute(req)) {
        return res.status(403).json({
          message: '请先修改密码后再访问',
          code: 'MUST_CHANGE_PASSWORD',
        });
      }
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: '无效的认证令牌' });
  }
};
