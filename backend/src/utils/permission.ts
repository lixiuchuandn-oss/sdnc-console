/**
 * 权限检查工具函数
 * 提供统一的权限检查逻辑，支持通配符匹配
 */

/**
 * 检查用户权限列表中是否包含指定权限
 * 支持通配符匹配：
 * - '*' 表示所有权限
 * - 'clouds:*' 表示所有clouds相关权限
 * - 'clouds.instances:*' 表示所有instances相关权限
 * 
 * @param perms 用户权限列表
 * @param action 需要检查的权限，格式：'domain.feature:verb'
 * @returns 是否有权限
 */
export const checkPermission = (perms: string[], action: string): boolean => {
  if (!perms || !Array.isArray(perms) || perms.length === 0) {
    return false;
  }

  // 超级管理员权限
  if (perms.includes('*')) {
    return true;
  }

  // 精确匹配
  if (perms.includes(action)) {
    return true;
  }

  // 通配符匹配
  const [base, verb] = action.split(':');
  if (!base || !verb) {
    return false;
  }

  const segments = base.split('.');
  
  // 检查 clouds:read 是否包含 clouds.instances:read
  // 即：如果用户有 clouds:read，则自动拥有 clouds.instances:read
  if (segments.length >= 1) {
    const domain = segments[0];
    // 检查 domain:verb 或 domain:*
    if (perms.includes(`${domain}:${verb}`) || perms.includes(`${domain}:*`)) {
      return true;
    }
  }

  // 检查 clouds.instances:read 是否包含 clouds.instances.vms:read
  // 即：如果用户有 clouds.instances:read，则自动拥有 clouds.instances.vms:read
  if (segments.length >= 2) {
    const domainFeature = `${segments[0]}.${segments[1]}`;
    if (perms.includes(`${domainFeature}:${verb}`) || perms.includes(`${domainFeature}:*`)) {
      return true;
    }
  }

  // 检查 write 权限是否包含 read 权限（拥有写权限则自动拥有读权限）
  if (verb === 'read') {
    const writeAction = action.replace(':read', ':write');
    if (checkPermission(perms, writeAction)) {
      return true;
    }
  }

  return false;
};

/**
 * 检查用户是否拥有任一指定权限
 * 
 * @param perms 用户权限列表
 * @param actions 需要检查的权限列表
 * @returns 是否拥有任一权限
 */
export const hasAnyPermission = (perms: string[], actions: string[]): boolean => {
  return actions.some(action => checkPermission(perms, action));
};

/**
 * 检查用户是否拥有所有指定权限
 * 
 * @param perms 用户权限列表
 * @param actions 需要检查的权限列表
 * @returns 是否拥有所有权限
 */
export const hasAllPermissions = (perms: string[], actions: string[]): boolean => {
  return actions.every(action => checkPermission(perms, action));
};
