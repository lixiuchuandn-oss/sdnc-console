import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from '../services/api';

interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'tenant' | 'leased_lines_admin';
  status: 'active' | 'inactive' | 'suspended';
  permissions?: string[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        try {
          // 验证token有效性
          const response = await fetch(`${API_BASE_URL}/api/users/me`, {
            headers: {
              'Authorization': `Bearer ${storedToken}`
            }
          });
          
          if (response.ok) {
            const userData = await response.json();
            try {
              const userType = userData.role === 'tenant' ? 'tenant' : 'system';
              const assignRes = await fetch(`${API_BASE_URL}/api/system/rbac/assignments?userType=${encodeURIComponent(userType)}&userId=${encodeURIComponent(userData.id)}`, {
                headers: { 'Authorization': `Bearer ${storedToken}` }
              });
              let perms: string[] = [];
              if (assignRes.ok) {
                const assignsJson = await assignRes.json();
                const roleIds: string[] = Array.isArray(assignsJson?.assignments) ? assignsJson.assignments.map((a: any) => a.roleId) : [];
                if (roleIds.length) {
                  const rolesRes = await fetch(`${API_BASE_URL}/api/system/rbac/roles`, { headers: { 'Authorization': `Bearer ${storedToken}` } });
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
              setUser({ ...userData, permissions: Array.from(new Set(perms)) });
            } catch {
              setUser(userData);
            }
            setToken(storedToken);
          } else {
            localStorage.removeItem('token');
            setToken(null);
          }
        } catch (error) {
          localStorage.removeItem('token');
          setToken(null);
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

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
        throw new Error('登录失败');
      }

      const data = await response.json();
      localStorage.setItem('token', data.token);
      setToken(data.token);
      try {
        const userType = data.user.role === 'tenant' ? 'tenant' : 'system';
        const assignRes = await fetch(`${API_BASE_URL}/api/system/rbac/assignments?userType=${encodeURIComponent(userType)}&userId=${encodeURIComponent(data.user.id)}`, {
          headers: { 'Authorization': `Bearer ${data.token}` }
        });
        let perms: string[] = [];
        if (assignRes.ok) {
          const assignsJson = await assignRes.json();
          const roleIds: string[] = Array.isArray(assignsJson?.assignments) ? assignsJson.assignments.map((a: any) => a.roleId) : [];
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
        setUser(data.user);
        return data.user;
      }
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
  };

  const value = {
    user,
    token,
    login,
    logout,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};