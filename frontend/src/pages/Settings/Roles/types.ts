export type RBACRole = {
  id: string;
  name: string;
  description?: string;
  scope: 'system' | 'tenant';
  permissions?: string;
  actions?: string[];
  type?: '系统策略' | '自定义策略';
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
  grantedUserCount?: number;
};

export type SysUser = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'tenant';
  status: 'active' | 'inactive' | 'suspended';
  createdAt?: string;
  builtIn?: boolean;
};

export type Assignment = {
  id: string;
  roleId: string;
  userType: 'system' | 'tenant';
  userId: string;
  createdAt: string;
};
