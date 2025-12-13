export interface Tenant {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  updatedAt: string;
  rootOrganizationId?: string;
}

export interface Organization {
  id: string;
  name: string;
  description?: string;
  level: 1 | 2 | 3 | 4;
  parentId?: string;
  tenantId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  children?: Organization[];
  userCount?: number;
  resourcePoolCount?: number;
}

export interface TenantUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'admin' | 'user' | 'viewer';
  organizationId: string;
  tenantId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  organization?: Organization;
}

export interface ResourcePoolAssignment {
  id: string;
  organizationId: string;
  resourcePoolId: string;
  assignedAt: string;
  assignedBy: string;
  permissions: string[];
  cloudId?: string;
  cloud?: {
    id: string;
    name: string;
    description: string;
    type: 'central' | 'edge' | 'hybrid';
    status: 'online' | 'offline' | 'maintenance';
    region: string;
    endpoint: string;
    accessKey?: string;
    secretKey?: string;
    config?: any;
    totalCpu: number;
    totalMemory: number;
    totalStorage: number;
    usedCpu: number;
    usedMemory: number;
    usedStorage: number;
    createdAt: string;
    updatedAt: string;
  };
}

export interface CreateTenantRequest {
  name: string;
  description?: string;
}

export interface CreateOrganizationRequest {
  name: string;
  description?: string;
  parentId?: string;
  tenantId: string;
}

export interface CreateTenantUserRequest {
  username: string;
  email: string;
  fullName: string;
  password: string;
  role: 'admin' | 'user' | 'viewer';
  organizationId: string;
}

export interface AssignResourcePoolRequest {
  organizationId: string;
  resourcePoolIds: string[];
  permissions: string[];
} 
