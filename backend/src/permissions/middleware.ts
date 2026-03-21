/**
 * 权限检查中间件
 * 
 * 提供统一的权限检查中间件，用于 Express 路由
 */

import { Request, Response, NextFunction } from 'express';
import { permissionRegistry, permissionChecker, resolvePermissionFromApi } from './index';
import { logger } from '../utils/logger';

const permLog = logger.child('Permission');

/**
 * 认证请求接口（扩展 Express Request）
 */
export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    permissions?: string[];
  };
}

/**
 * 权限解析器函数类型
 */
export type PermissionResolver = (req: AuthRequest) => string | string[] | null;

/**
 * 创建权限检查中间件
 * 
 * @param permissionResolver 权限解析器函数，从请求中解析出需要的权限
 * @param options 选项
 * @returns Express 中间件函数
 */
export function createPermissionMiddleware(
  permissionResolver: PermissionResolver,
  options?: {
    /** 是否允许超级管理员跳过检查（默认：true） */
    allowSuperAdmin?: boolean;
    /** 自定义错误消息 */
    errorMessage?: (required: string | string[]) => string;
  }
) {
  const { allowSuperAdmin = true, errorMessage } = options || {};

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: '未认证' });
      }

      // 超级管理员跳过检查
      if (allowSuperAdmin && user.role === 'super_admin') {
        return next();
      }

      // 解析所需权限
      const required = permissionResolver(req);
      if (!required) {
        return res.status(403).json({ message: '无法解析所需权限' });
      }

      // 获取用户权限
      const permissions = Array.isArray(user.permissions) ? user.permissions : [];

      // 检查权限
      const hasPermission = Array.isArray(required)
        ? permissionChecker.checkAny(permissions, required)
        : permissionChecker.check(permissions, required);

      if (!hasPermission) {
        // 生成错误消息
        let message: string;
        if (errorMessage) {
          message = errorMessage(required);
        } else {
          const permId = Array.isArray(required) ? required[0] : required;
          const permDef = permissionRegistry.get(permId);
          message = `权限不足：需要 ${permDef?.name || permId}`;
        }

        return res.status(403).json({ message });
      }

      next();
    } catch (error) {
      permLog.error('Error:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ message: '权限检查失败' });
    }
  };
}

/**
 * 从 API 路径自动解析权限的中间件
 * 
 * 根据 HTTP 方法和路径自动解析所需权限：
 * - GET/HEAD 方法需要 {permission}:read
 * - 其他方法需要 {permission}:write
 * 
 * @param options 选项
 * @returns Express 中间件函数
 */
export function createApiPermissionMiddleware(options?: {
  /** 是否允许超级管理员跳过检查（默认：true） */
  allowSuperAdmin?: boolean;
  /** 自定义权限解析逻辑 */
  customResolver?: (req: AuthRequest) => string | null;
}) {
  const { allowSuperAdmin = true, customResolver } = options || {};

  return createPermissionMiddleware((req) => {
    // 使用自定义解析器（如果提供）
    if (customResolver) {
      const custom = customResolver(req);
      if (custom) return custom;
    }

    // 从 API 路径解析权限
    const method = req.method.toUpperCase();
    const fullPath = (req.baseUrl || '') + (req.path || '');
    const path = fullPath.toLowerCase();
    
    // 特殊处理：控制台/VNC 访问路径（优先检查）
    const isConsolePath =
      path.includes('/csm/security/domain/attach/callonsso') ||
      (path.includes('/csm/security/virtual-elements') && path.endsWith('/console')) ||
      path.endsWith('/vnc-url') ||
      path.includes('/vnc-url') ||
      (path.includes('/resources/ecs') && (path.includes('/vnc') || path.includes('/console') || path.includes('/ssh')));
    
    let actionBase: string;
    if (isConsolePath) {
      actionBase = 'clouds.console';
    } else {
      // 从新权限注册表解析
      const permissionId = resolvePermissionFromApi(method, fullPath);
      
      if (!permissionId) {
        // 如果无法解析，返回 null 触发错误
        return null;
      }
      
      // 从权限ID中提取基础名称（去掉 :read/:write 后缀）
      actionBase = permissionId.split(':')[0];
    }

    // 判断是读操作还是写操作
    const isRead = method === 'GET' || method === 'HEAD';
    
    // 控制台路径需要 write 权限
    if (isConsolePath) {
      return `${actionBase}:write`;
    }

    // 特殊场景：GET /clouds 列表接口，如果用户有 clouds.console:read 或 clouds.ecs:read 也允许访问
    if (actionBase === 'clouds' && isRead) {
      return ['clouds:read', 'clouds.console:read', 'clouds.ecs:read'];
    }

    return isRead ? `${actionBase}:read` : `${actionBase}:write`;
  }, { allowSuperAdmin });
}

/**
 * 检查指定权限的中间件（简化版）
 * 
 * @param required 需要的权限ID或权限ID数组
 * @param options 选项
 * @returns Express 中间件函数
 */
export function requirePermission(
  required: string | string[],
  options?: {
    allowSuperAdmin?: boolean;
  }
) {
  return createPermissionMiddleware(() => required, options);
}
