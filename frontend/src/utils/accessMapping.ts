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
      // 1. 不是废弃的路由
      // 2. 有 requiredActions.page 配置
      // 注意：隐藏路由（hidden: true）也需要权限检查，只是不在菜单中显示
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

// 开发环境调试：打印生成的映射表（已禁用）
// if (process.env.NODE_ENV === 'development') {
//   console.log('[accessMapping] Generated mappings:', PATH_PERMISSION_MAPPING);
// }

export const getRequiredActionForPath = (path: string): string | null => {
  const purePath = String(path || '').split('?')[0];
  for (const mapping of PATH_PERMISSION_MAPPING) {
    if (purePath.startsWith(mapping.path)) {
      // 开发环境调试（已禁用）
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[accessMapping] Path "${purePath}" matched mapping:`, mapping);
      // }
      return mapping.action;
    }
  }
  // 开发环境调试（已禁用）
  // if (process.env.NODE_ENV === 'development') {
  //   console.warn(`[accessMapping] No mapping found for path: "${purePath}"`);
  // }
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
  // 注意：顶层 clouds:read 不是 clouds.* 前缀，由下方单独规则扩展为全部 clouds.*:read
  if (base.startsWith('clouds.') && act.endsWith(':read')) {
    if (permsArray.includes('clouds.console:read') || permsArray.includes('clouds.console:write')) {
      return true;
    }
  }

  // 特殊规则：clouds.console:write 包含所有 clouds.*:write（与只读继承对称）
  if (base.startsWith('clouds.') && act.endsWith(':write')) {
    if (permsArray.includes('clouds.console:write')) {
      return true;
    }
  }

  // clouds:write 包含所有 clouds.*:write（与 clouds:read 对读权限的对称）
  if (base.startsWith('clouds.') && act.endsWith(':write')) {
    if (permsArray.includes('clouds:write')) {
      return true;
    }
  }
  
  // clouds:read 包含所有 clouds.*:read（含 clouds.resource-pools、资源总览路由仍用独立原子）
  // 注意：clouds:read 本身不会被 clouds.console:read 继承（格式为 clouds:read vs clouds.*:read）
  if (base.startsWith('clouds.') && act.endsWith(':read')) {
    if (permsArray.includes('clouds:read') || permsArray.includes('clouds:write')) {
      return true;
    }
  }
  
  return false;
};

/**
 * 获取默认首页路径
 * 
 * 【逻辑说明】
 * 1. 从 RouteSpec 中筛选出所有设置了 homePagePriority 的路由
 * 2. 按 homePagePriority 升序排序（数值越小优先级越高）
 * 3. 依次检查每个候选路由的权限和授权
 * 4. 返回第一个通过检查的路由路径
 * 
 * 【优势】
 * - 无需硬编码路径列表，所有配置集中在 RouteSpec
 * - 新增首页候选只需在 RouteSpec 中添加 homePagePriority 字段
 * - 符合 DRY 原则，单点维护
 * 
 * @param perms - 用户权限列表
 * @param hasFeature - 授权检查函数（可选）
 * @returns 默认首页路径，如果没有可访问的页面则返回 '/admin/coming-soon'
 */
export const getDefaultAdminPath = (perms: string[] = [], hasFeature?: (feature: string) => boolean): string => {
  // 从 RouteSpec 中筛选出所有设置了 homePagePriority 的路由
  // 过滤条件：
  // 1. 不是废弃的路由
  // 2. 不是隐藏的路由
  // 3. 设置了 homePagePriority 字段
  // 4. 有 requiredActions.page 配置（需要权限检查）
  const candidates = routeSpecs
    .filter(spec => 
      !spec.deprecated && 
      !spec.hidden && 
      spec.homePagePriority !== undefined &&
      spec.requiredActions?.page
    )
    // 按 homePagePriority 升序排序（数值越小优先级越高）
    .sort((a, b) => (a.homePagePriority || 999) - (b.homePagePriority || 999));

  // 依次检查每个候选路由
  for (const spec of candidates) {
    const act = getRequiredActionForPath(spec.path);
    // 权限检查
    if (!hasPermissionForAction(perms, act)) continue;
    
    // 授权检查（如果提供了 hasFeature 函数）
    if (hasFeature) {
      if (spec.requiredFeature && !hasFeature(spec.requiredFeature)) {
        continue; // 跳过没有 feature 的页面
      }
    }
    
    return spec.path;
  }
  
  // 如果没有可访问的页面，返回默认页面
  return '/admin/coming-soon';
};
