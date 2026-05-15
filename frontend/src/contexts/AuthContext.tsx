import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from '../services/api';
import { getToken, setToken as saveToken, removeToken } from '../utils/tokenStorage';

/**
 * 用户对象
 * - permissions 为派生属性：登录后通过角色→权限计算得到的权限原子集合（去重）
 */
interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'tenant';
  tenantRole?: string;
  status: 'active' | 'inactive' | 'suspended';
  permissions?: string[];
  tenantName?: string;
  organizationName?: string;
  tenantId?: string; // 租户ID（租户用户才有）
  organizationId?: string; // 组织ID（组织级用户才有）
  /** 平台管理员密码已过期，需先改密（租户无此字段） */
  mustChangePassword?: boolean;
}

/**
 * 认证上下文
 * - user: 当前登录用户（含权限）
 * - token: 访问后端的 Bearer Token（存储于 localStorage）
 * - login/logout: 登录/退出
 * - loading: 初始化阶段或登录过程中的加载态
 */
interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  loading: boolean;
  /** 重新拉取 /api/users/me（改密成功后刷新 mustChangePassword 等） */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * 获取认证上下文的 Hook
 * 使用前需确保组件树外层包裹了 <AuthProvider>
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * 认证提供者
 * - 启动时从 localStorage 读取 token 并校验
 * - 若 token 有效，拉取用户信息并按“角色→权限”计算出 permissions
 * - 注意：将 token 存于 localStorage 在存在 XSS 时可能被窃取，请确保前端安全基线
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getToken());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = getToken();
      if (storedToken) {
        try {
          // 1) 验证 token 有效性，并获取基础用户信息
          const response = await fetch(`${API_BASE_URL}/api/users/me`, {
            headers: {
              'Authorization': `Bearer ${storedToken}`
            }
          });
          
          if (response.ok) {
            const userData = await response.json();
            
            // 优先使用后端返回的计算好的权限
            if (Array.isArray(userData.permissions) && userData.permissions.length > 0) {
              setUser(userData);
              setToken(storedToken);
              setLoading(false);
              return;
            }

            try {
              // 2) 如果是超级管理员，直接赋予所有权限
              if (userData.role === 'super_admin') {
                setUser({ ...userData, permissions: ['*'] });
                setToken(storedToken);
                setLoading(false);
                return;
              }

              // 3) 根据用户类型（tenant/system）拉取角色分配
              const userType = userData.role === 'tenant' ? 'tenant' : 'system';
              const assignRes = await fetch(`${API_BASE_URL}/api/system/rbac/assignments?userType=${encodeURIComponent(userType)}&userId=${encodeURIComponent(userData.id)}`, {
                headers: { 'Authorization': `Bearer ${storedToken}` }
              });
              let perms: string[] = [];
              if (assignRes.ok) {
                const assignsJson = await assignRes.json();
                const roleIds: string[] = Array.isArray(assignsJson?.assignments) ? assignsJson.assignments.map((a: any) => a.roleId) : [];
                // 如果是租户用户且携带了 tenantRole，也将其视为角色 ID
                if (userData.tenantRole && !roleIds.includes(userData.tenantRole)) {
                  roleIds.push(userData.tenantRole);
                }
                if (roleIds.length) {
                  // 3) 拉取全量角色列表，在本地筛出用户的角色，聚合权限
                  const rolesRes = await fetch(`${API_BASE_URL}/api/system/rbac/roles`, { headers: { 'Authorization': `Bearer ${storedToken}` } });
                  if (rolesRes.ok) {
                    const rolesJson = await rolesRes.json();
                    const roles = Array.isArray(rolesJson?.roles) ? rolesJson.roles : [];
                    const myRoles = roles.filter((r: any) => roleIds.includes(r.id));
                    for (const r of myRoles) {
                      try {
                        // 后端角色的 permissions 字段为 JSON 字符串，需安全解析
                        const arr = JSON.parse(String(r.permissions || '[]')) || [];
                        if (Array.isArray(arr)) perms = perms.concat(arr);
                      } catch {}
                    }
                  }
                }
              }
              // 4) 去重汇总后的权限集合，挂载回 user
              setUser({ ...userData, permissions: Array.from(new Set(perms)) });
            } catch {
              // 若权限汇总失败，不影响基础登录态
              setUser(userData);
            }
            setToken(storedToken);
          } else {
            // token 失效：清理本地态
            removeToken();
            setToken(null);
          }
        } catch (error) {
          // 网络或解析异常：同样清理本地态
          removeToken();
          setToken(null);
        }
      }
      // 初始化流程结束
      setLoading(false);
    };

    initAuth();
  }, []);

/**
 * 登录
 * - 成功后写入 token 到 localStorage
 * - 同步执行与 initAuth 相同的“角色→权限”汇总逻辑，返回带 permissions 的用户对象
 */
  const refreshUser = async () => {
    const storedToken = getToken();
    if (!storedToken) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (!response.ok) return;
      const userData = await response.json();
      if (userData.role === 'super_admin' && (!Array.isArray(userData.permissions) || userData.permissions.length === 0)) {
        setUser({ ...userData, permissions: ['*'] });
        return;
      }
      setUser(userData);
    } catch {
      /* ignore */
    }
  };

  const login = async (username: string, password: string): Promise<User> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        let errMsg = '登录失败';
        try {
          const errJson = await response.json();
          if (typeof errJson?.message === 'string' && errJson.message.trim()) {
            errMsg = errJson.message.trim();
          }
        } catch {
          if (response.status === 401) {
            errMsg = '用户名或密码错误';
          }
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      saveToken(data.token);
      setToken(data.token);

      // 优先使用后端返回的计算好的权限
      if (Array.isArray(data.user.permissions) && data.user.permissions.length > 0) {
        setUser(data.user);
        return data.user;
      }

      // 如果是超级管理员，直接赋予所有权限
      if (data.user.role === 'super_admin') {
        const withPerms = { ...data.user, permissions: ['*'] };
        setUser(withPerms);
        return withPerms;
      }

      try {
        // 与初始化相同：基于分配关系聚合角色权限
        const userType = data.user.role === 'tenant' ? 'tenant' : 'system';
        const assignRes = await fetch(`${API_BASE_URL}/api/system/rbac/assignments?userType=${encodeURIComponent(userType)}&userId=${encodeURIComponent(data.user.id)}`, {
          headers: { 'Authorization': `Bearer ${data.token}` }
        });
        let perms: string[] = [];
        if (assignRes.ok) {
          const assignsJson = await assignRes.json();
          const roleIds: string[] = Array.isArray(assignsJson?.assignments) ? assignsJson.assignments.map((a: any) => a.roleId) : [];
          // 如果是租户用户且携带了 tenantRole，也将其视为角色 ID
          if (data.user.tenantRole && !roleIds.includes(data.user.tenantRole)) {
            roleIds.push(data.user.tenantRole);
          }
          if (roleIds.length) {
            const rolesRes = await fetch(`${API_BASE_URL}/api/system/rbac/roles`, { headers: { 'Authorization': `Bearer ${data.token}` } });
            if (rolesRes.ok) {
              const rolesJson = await rolesRes.json();
              const roles = Array.isArray(rolesJson?.roles) ? rolesJson.roles : [];
              const myRoles = roles.filter((r: any) => roleIds.includes(r.id));
              for (const r of myRoles) {
                try {
                  const arr = JSON.parse(String(r.permissions || '[]')) || [];
                  if (Array.isArray(arr)) perms = perms.concat(arr);
                } catch {}
              }
            }
          }
        }
        const withPerms = { ...data.user, permissions: Array.from(new Set(perms)) };
        setUser(withPerms);
        return withPerms;
      } catch {
        // 权限聚合失败不阻塞登录
        setUser(data.user);
        return data.user;
      }
    } catch (error) {
      throw error;
    }
  };

/**
 * 退出登录
 * - 清空内存态与 localStorage 中的 token
 */
  const logout = () => {
    setUser(null);
    setToken(null);
    removeToken();
  };

  const value = {
    user,
    token,
    login,
    logout,
    loading,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
