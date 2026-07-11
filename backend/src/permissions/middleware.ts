/**
 * SDNC 权限检查中间件
 */

import { Request, Response, NextFunction } from 'express';
import { permissionRegistry, permissionChecker, resolvePermissionFromApi } from './index';
import { logger } from '../utils/logger';

const permLog = logger.child('Permission');

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    permissions?: string[];
  };
}

export type PermissionResolver = (req: AuthRequest) => string | string[] | null;

export function createPermissionMiddleware(
  permissionResolver: PermissionResolver,
  options?: {
    allowSuperAdmin?: boolean;
    errorMessage?: (required: string | string[]) => string;
  },
) {
  const { allowSuperAdmin = true, errorMessage } = options || {};

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: '未认证' });
      }

      if (allowSuperAdmin && user.role === 'super_admin') {
        return next();
      }

      const required = permissionResolver(req);
      if (!required) {
        return res.status(403).json({ message: '无法解析所需权限' });
      }

      const permissions = Array.isArray(user.permissions) ? user.permissions : [];
      const hasPermission = Array.isArray(required)
        ? permissionChecker.checkAny(permissions, required)
        : permissionChecker.check(permissions, required);

      if (!hasPermission) {
        const permId = Array.isArray(required) ? required[0] : required;
        const permDef = permissionRegistry.get(permId);
        const message = errorMessage
          ? errorMessage(required)
          : `权限不足：需要 ${permDef?.name || permId}`;
        return res.status(403).json({ message });
      }

      next();
    } catch (error) {
      permLog.error('Error:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ message: '权限检查失败' });
    }
  };
}

export function createApiPermissionMiddleware(options?: {
  allowSuperAdmin?: boolean;
  customResolver?: (req: AuthRequest) => string | null;
}) {
  const { allowSuperAdmin = true, customResolver } = options || {};

  return createPermissionMiddleware(
    (req) => {
      if (customResolver) {
        const custom = customResolver(req);
        if (custom) return custom;
      }

      const method = req.method.toUpperCase();
      const fullPath = (req.baseUrl || '') + (req.path || '');
      const permissionId = resolvePermissionFromApi(method, fullPath);
      if (!permissionId) {
        return null;
      }

      const actionBase = permissionId.split(':')[0];
      const isRead = method === 'GET' || method === 'HEAD';
      return isRead ? `${actionBase}:read` : `${actionBase}:write`;
    },
    { allowSuperAdmin },
  );
}

export function requirePermission(
  required: string | string[],
  options?: { allowSuperAdmin?: boolean },
) {
  return createPermissionMiddleware(() => required, options);
}
