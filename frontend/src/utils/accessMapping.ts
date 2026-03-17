import { routeSpecs } from '../routes/RouteSpec';

/**
 * 从 RouteSpec 自动生成路径权限映射
 * 
 * 【单点生效机制】
 * - 只需在 RouteSpec 中修改 requiredActions.page，accessMapping 会自动更新
 * - 修改一个路由的权限，不会影响其他路由
 * - 符合 DRY 原则（Don't Repeat Yourself）
 */
const generateMappingFromRouteSpecs = (): Array<{ path: string; action: string }> => {
  return routeSpecs
    .filter(spec => 
      // 过滤条件：
      // 1. 不是隐藏的路由
      // 2. 不是废弃的路由
      // 3. 有 requiredActions.page 配置
      !spec.hidden && 
      !spec.deprecated && 
      spec.requiredActions?.page
    )
    .map(spec => ({
      path: spec.path,
      action: spec.requiredActions!.page
    }))
    // 按路径长度降序排序，确保更具体的路径优先匹配（如 /admin/clouds/console 在 /admin/clouds 之前）
    .sort((a, b) => b.path.length - a.path.length);
};

/**
 * 手动补充的特殊映射（用于没有 requiredActions 的路由或特殊路径）
 * 
 * 【使用场景】
 * - 路径前缀匹配（如 /admin/clouds 匹配所有 /admin/clouds/* 的子路径）
 * - 没有在 RouteSpec 中定义的路由
 * - 需要特殊权限逻辑的路径
 * 
 * 【注意】
 * - 资源池管理（/admin/clouds）现在已在 RouteSpec 中配置 requiredActions，无需手动映射
 */
const MANUAL_MAPPINGS: Array<{ path: string; action: string }> = [
  // 租户专线管理功能已迁移到 AISOC 平台，相关权限映射已移除
  // 资源池管理（/admin/clouds）现在从 RouteSpec 自动生成，无需手动映射
];

/**
 * 路径权限映射表
 * 
 * 【数据来源】
 * - 主要来源：从 RouteSpec 自动生成（单点生效）
 * - 补充来源：手动映射（特殊情况）
 * 
 * 【修改方式】
 * - ✅ 推荐：在 RouteSpec 中修改 requiredActions.page
 * - ⚠️ 特殊：在 MANUAL_MAPPINGS 中添加手动映射
 */
export const PATH_PERMISSION_MAPPING: Array<{ path: string; action: string }> = [
  ...generateMappingFromRouteSpecs(),
  ...MANUAL_MAPPINGS,
];

// 开发环境调试：打印生成的映射表
if (process.env.NODE_ENV === 'development') {
  console.log('[accessMapping] Generated mappings:', PATH_PERMISSION_MAPPING);
}

export const getRequiredActionForPath = (path: string): string | null => {
  const purePath = String(path || '').split('?')[0];
  for (const mapping of PATH_PERMISSION_MAPPING) {
    if (purePath.startsWith(mapping.path)) {
      // 开发环境调试
      if (process.env.NODE_ENV === 'development') {
        console.log(`[accessMapping] Path "${purePath}" matched mapping:`, mapping);
      }
      return mapping.action;
    }
  }
  // 开发环境调试
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[accessMapping] No mapping found for path: "${purePath}"`);
  }
  return null;
};

export const hasPermissionForAction = (perms: string[], act: string | null): boolean => {
  if (!act) return false; // 未映射的路径默认拒绝访问
  const permsArray = perms || [];
  const base = act.split(':')[0];
  const segments = base.split('.');
  const hasDomainPrefix = segments.length >= 2 ? `${segments[0]}.${segments[1]}` : null;
  
  // 精确匹配
  if (permsArray.includes(act)) return true;
  
  // 超级管理员权限
  if (permsArray.includes('*')) return true;
  
  // write 权限包含 read 权限
  if (permsArray.includes(act.replace(':read', ':write'))) return true;
  
  // 通配符匹配：base:* 或 domain.feature:*
  if (permsArray.includes(`${base}:*`)) return true;
  if (!!hasDomainPrefix && permsArray.includes(`${hasDomainPrefix}:*`)) return true;
  
  // 特殊规则：clouds.console:read 权限包含所有 clouds.*:read 权限（资源控制台下的所有功能）
  // 这是为了支持"资源控制台所有权限"的场景
  if (base.startsWith('clouds.') && act.endsWith(':read')) {
    if (permsArray.includes('clouds.console:read') || permsArray.includes('clouds.console:write')) {
      return true;
    }
  }
  
  // clouds:read 包含所有 clouds.*:read
  if (base.startsWith('clouds.') && act.endsWith(':read')) {
    if (permsArray.includes('clouds:read') || permsArray.includes('clouds:write')) {
      return true;
    }
  }
  
  return false;
};

export const getDefaultAdminPath = (perms: string[] = []): string => {
  const candidates = [
    '/admin/dashboard',        // 优先级1：资源总览
    '/admin/clouds',           // 优先级2：资源池管理
    '/admin/clouds/console',   // 优先级3：云主机控制台
    '/admin/tenants',          // 优先级4：租户管理
    '/admin/tenants/users',    // 优先级5：子用户管理
  ];
  for (const p of candidates) {
    const act = getRequiredActionForPath(p);
    if (hasPermissionForAction(perms, act)) return p;
  }
  return '/admin/coming-soon';
};
