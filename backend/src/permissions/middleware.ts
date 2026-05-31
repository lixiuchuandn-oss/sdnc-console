/**
 * 权限检查中间件
 *
 * 提供统一的权限检查中间件，用于 Express 路由
 */

import { Request, Response, NextFunction } from 'express';
import { permissionRegistry, permissionChecker, resolvePermissionFromApi } from './index';
import {
  resolveHarvesterContainerProxyPermissionFromBody,
  resolveHarvesterContainerUrlPermission,
} from './registry';
import { logger } from '../utils/logger';
import {
  cbrBackupScheduleReadAlternates,
  cbrBackupScheduleWriteAlternates,
  cbrVmBackupListReadAlternates,
  cbrVmBackupListWriteAlternates,
  CBR_BACKUP_SCHEDULES_BASE,
  CBR_VM_BACKUPS_BASE,
} from '../constants/cbrPermissionBases';

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

/** Harvester 容器通用代理 CRUD：真实资源类型在 body.apiPath */
function resolveHarvesterContainerProxyPermission(req: AuthRequest): string | null {
  const fullPath = (req.baseUrl || '') + (req.path || '');
  const apiPath = String((req.body as { apiPath?: unknown })?.apiPath ?? '');
  return resolveHarvesterContainerProxyPermissionFromBody(req.method, fullPath, apiPath);
}

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
  },
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

  return createPermissionMiddleware(
    (req) => {
      // 使用自定义解析器（如果提供）
      if (customResolver) {
        const custom = customResolver(req);
        if (custom) return custom;
      }

      const proxyPerm = resolveHarvesterContainerProxyPermission(req);
      if (proxyPerm) {
        return proxyPerm;
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
        (path.includes('/resources/ecs') &&
          (path.includes('/vnc') || path.includes('/console') || path.includes('/ssh')));

      let actionBase: string;
      if (isConsolePath) {
        actionBase = 'clouds.ecs';
      } else {
        // 从新权限注册表解析；失败时用容器子路径兜底（如 containerd-registry/insecure）
        const permissionId =
          resolvePermissionFromApi(method, fullPath) ||
          resolveHarvesterContainerUrlPermission(method, fullPath);

        if (!permissionId) {
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

      // GET /clouds 列表：主权限为资源池页；兼容全量 clouds:read 与 ECS（创建向导等依赖拉取云列表）
      if (actionBase === 'clouds.resource-pools' && isRead) {
        return ['clouds.resource-pools:read', 'clouds:read', 'clouds.ecs:read'];
      }

      // 云主机 API：云数据库 / 虚拟路由器页复用 harvester/vms，允许对应独立原子
      if (actionBase === 'clouds.ecs') {
        return isRead
          ? ['clouds.ecs:read', 'clouds.paas-databases:read', 'clouds.vne:read']
          : ['clouds.ecs:write', 'clouds.paas-databases:write', 'clouds.vne:write'];
      }

      // 子网：父级 clouds.subnets + 按 tower.io/subnet-type 拆分
      // - 读：允许 clouds.vpcs:read（VPC 页展开子网仅查看，与写解耦）
      // - 写：不含 clouds.vpcs:write（VPC 写 ≠ 子网写）
      if (actionBase === 'clouds.subnets') {
        return isRead
          ? [
              'clouds.subnets:read',
              'clouds.subnets.vpc:read',
              'clouds.subnets.flat:read',
              'clouds.subnets.public:read',
              'clouds.vpcs:read',
            ]
          : [
              'clouds.subnets:write',
              'clouds.subnets.vpc:write',
              'clouds.subnets.flat:write',
              'clouds.subnets.public:write',
            ];
      }

      // 内置 VPC ovn-internal 写：与公共子网 external 保存联动（enableExternal / nextHopIP），权限与公共子网写对齐，不单绑 clouds.vpcs:write
      if (
        actionBase === 'clouds.vpcs' &&
        !isRead &&
        path.includes('/resources/vpcs/ovn-internal')
      ) {
        return [
          'clouds.vpcs:write',
          'clouds.subnets.public:write',
          'clouds.subnets:write',
          'clouds:write',
        ];
      }

      // VLAN 列表：扁平/公共子网创建/编辑需下拉选 VLAN；持对应子网权限但无 clouds.vlans:read 时仍允许 GET 列表（不写 VLAN 管理）
      // 注意：勿加入 clouds.subnets:read —— checker 会把它与 clouds.subnets.vpc:read 等同，会过度放行仅 VPC 子网读的角色
      if (actionBase === 'clouds.vlans' && isRead) {
        return [
          'clouds.vlans:read',
          'clouds.subnets.flat:read',
          'clouds.subnets.flat:write',
          'clouds.subnets.public:read',
          'clouds.subnets.public:write',
        ];
      }

      // 安全组（registry 映射为 .vpc 或 .flat）
      if (actionBase === 'clouds.security-groups.vpc') {
        return isRead
          ? ['clouds.security-groups.vpc:read', 'clouds.vpcs:read']
          : ['clouds.security-groups.vpc:write', 'clouds.vpcs:write'];
      }
      if (actionBase === 'clouds.security-groups.flat') {
        return isRead
          ? ['clouds.security-groups.flat:read', 'clouds.vpcs:read']
          : ['clouds.security-groups.flat:write', 'clouds.vpcs:write'];
      }

      // 扁平分域 OVN EIP/SNAT/DNAT（actionBase 为 *.flat；路径已统一为 /resources/ovn*）
      if (actionBase === 'clouds.eips.flat') {
        return isRead
          ? ['clouds.eips.flat:read', 'clouds:read']
          : ['clouds.eips.flat:write', 'clouds:write'];
      }
      if (actionBase === 'clouds.snat.flat') {
        return isRead
          ? ['clouds.snat.flat:read', 'clouds:read']
          : ['clouds.snat.flat:write', 'clouds:write'];
      }
      if (actionBase === 'clouds.dnat.flat') {
        return isRead
          ? ['clouds.dnat.flat:read', 'clouds:read']
          : ['clouds.dnat.flat:write', 'clouds:write'];
      }

      const ovnNs = String((req as any).query?.ovnNetworkScope ?? '')
        .trim()
        .toLowerCase();

      // EIP：按 ovnNetworkScope=vpc 仅 VPC 原子；underlay/all 为扁平或全量
      if (actionBase === 'clouds.eips.vpc') {
        const scopedVpc = ovnNs === 'vpc';
        if (scopedVpc) {
          return isRead
            ? ['clouds.eips.vpc:read', 'clouds:read']
            : ['clouds.eips.vpc:write', 'clouds:write'];
        }
        return isRead
          ? ['clouds.eips.vpc:read', 'clouds.eips.flat:read', 'clouds.vpcs:read']
          : ['clouds.eips.vpc:write', 'clouds.eips.flat:write', 'clouds.vpcs:write'];
      }
      // SNAT
      if (actionBase === 'clouds.snat.vpc') {
        const scopedVpc = ovnNs === 'vpc';
        if (scopedVpc) {
          return isRead
            ? ['clouds.snat.vpc:read', 'clouds:read']
            : ['clouds.snat.vpc:write', 'clouds:write'];
        }
        return isRead
          ? ['clouds.snat.vpc:read', 'clouds.snat.flat:read', 'clouds.vpcs:read']
          : ['clouds.snat.vpc:write', 'clouds.snat.flat:write', 'clouds.vpcs:write'];
      }

      // 流量镜像（registry 默认映射到 .vpc）
      if (actionBase === 'clouds.traffic-mirroring.vpc') {
        return isRead
          ? [
              'clouds.traffic-mirroring.vpc:read',
              'clouds.traffic-mirroring.flat:read',
              'clouds.vpcs:read',
            ]
          : [
              'clouds.traffic-mirroring.vpc:write',
              'clouds.traffic-mirroring.flat:write',
              'clouds.vpcs:write',
            ];
      }

      // 云备份：列表 API 供备份/快照两页共用；历史 clouds.backups 总权覆盖快照（不含定时策略）
      if (actionBase === CBR_VM_BACKUPS_BASE) {
        return isRead ? cbrVmBackupListReadAlternates() : cbrVmBackupListWriteAlternates();
      }
      if (actionBase === CBR_BACKUP_SCHEDULES_BASE) {
        return isRead ? cbrBackupScheduleReadAlternates() : cbrBackupScheduleWriteAlternates();
      }

      // DNAT
      if (actionBase === 'clouds.dnat.vpc') {
        const scopedVpc = ovnNs === 'vpc';
        if (scopedVpc) {
          return isRead
            ? ['clouds.dnat.vpc:read', 'clouds:read']
            : ['clouds.dnat.vpc:write', 'clouds:write'];
        }
        return isRead
          ? [
              'clouds.dnat.vpc:read',
              'clouds.snat.vpc:read',
              'clouds.dnat.flat:read',
              'clouds.snat.flat:read',
              'clouds.vpcs:read',
            ]
          : [
              'clouds.dnat.vpc:write',
              'clouds.snat.vpc:write',
              'clouds.dnat.flat:write',
              'clouds.snat.flat:write',
              'clouds.vpcs:write',
            ];
      }

      return isRead ? `${actionBase}:read` : `${actionBase}:write`;
    },
    { allowSuperAdmin },
  );
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
  },
) {
  return createPermissionMiddleware(() => required, options);
}
