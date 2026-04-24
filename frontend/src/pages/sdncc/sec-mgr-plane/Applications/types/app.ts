/** 安全与管理中心 · 应用（服务）列表实体 */
export interface AppItem {
  id: string;
  name: string;
  domainId: string;
  domainName?: string;
  type: 'vm' | 'container' | 'mixed' | 'service_address';
  instanceCount: number;
  status: 'running' | 'stopped' | 'degraded';
  strategies: Array<'RBAC' | 'ABAC'>;
  instances?: string[];
  serviceAddresses?: Array<{ protocol: string; ip: string; port: string }>;
  servicePorts?: Array<{ protocol: string; port: string }>;
  description?: string;
  owner?: string;
  version?: string;
  policyIds?: string[];
}
