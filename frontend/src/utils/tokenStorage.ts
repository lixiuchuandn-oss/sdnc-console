/**
 * Token 存储工具
 * 统一管理 token 的存储和读取，便于后续迁移到其他方案（sessionStorage 或 httpOnly Cookie）
 * 
 * @module tokenStorage
 */

const TOKEN_KEY = 'token';

/**
 * 存储类型配置
 * 可选值: 'localStorage' | 'sessionStorage'
 * 默认使用 localStorage，后续可迁移到 sessionStorage
 * 修改此值即可切换存储方式
 */
const USE_SESSION_STORAGE = false;

/**
 * 获取存储对象
 * @returns Storage 对象（localStorage 或 sessionStorage）
 */
const getStorage = (): Storage => {
  try {
    return USE_SESSION_STORAGE ? sessionStorage : localStorage;
  } catch (error) {
    // 某些浏览器在隐私模式下可能禁用 storage，降级到 localStorage
    console.warn('Failed to access storage, falling back to localStorage:', error);
    return localStorage;
  }
};

/**
 * 保存 token
 * @param token - 要保存的 token 字符串
 * @throws 如果存储失败会抛出错误（但会被捕获并记录）
 */
export const setToken = (token: string): void => {
  if (!token || typeof token !== 'string') {
    console.warn('setToken: Invalid token provided');
    return;
  }

  try {
    const storage = getStorage();
    storage.setItem(TOKEN_KEY, token);
  } catch (error) {
    console.error('Failed to save token:', error);
    // 在某些浏览器隐私模式下，storage 可能被禁用
    // 这里不抛出错误，避免影响应用运行
  }
};

/**
 * 获取 token
 * @returns token 字符串，如果不存在则返回 null
 */
export const getToken = (): string | null => {
  try {
    const storage = getStorage();
    return storage.getItem(TOKEN_KEY);
  } catch (error) {
    console.error('Failed to get token:', error);
    return null;
  }
};

/**
 * 删除 token
 */
export const removeToken = (): void => {
  try {
    const storage = getStorage();
    storage.removeItem(TOKEN_KEY);
  } catch (error) {
    console.error('Failed to remove token:', error);
  }
};

/**
 * 检查 token 是否存在
 * @returns 如果 token 存在返回 true，否则返回 false
 */
export const hasToken = (): boolean => {
  return getToken() !== null;
};

/**
 * 清除所有 token 相关的存储
 * 用于登出时彻底清理
 */
export const clearToken = (): void => {
  try {
    // 同时清除 localStorage 和 sessionStorage 中的 token
    // 确保无论之前使用哪种存储方式都能清除
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    console.error('Failed to clear token:', error);
  }
};

/**
 * 迁移 token（从 localStorage 迁移到 sessionStorage 或反之）
 * 用于存储方式切换时的数据迁移
 * @param from - 源存储类型
 * @param to - 目标存储类型
 * @returns 是否迁移成功
 */
export const migrateToken = (
  from: 'localStorage' | 'sessionStorage',
  to: 'localStorage' | 'sessionStorage'
): boolean => {
  try {
    const fromStorage = from === 'sessionStorage' ? sessionStorage : localStorage;
    const toStorage = to === 'sessionStorage' ? sessionStorage : localStorage;
    
    const token = fromStorage.getItem(TOKEN_KEY);
    if (token) {
      toStorage.setItem(TOKEN_KEY, token);
      fromStorage.removeItem(TOKEN_KEY);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to migrate token:', error);
    return false;
  }
};
