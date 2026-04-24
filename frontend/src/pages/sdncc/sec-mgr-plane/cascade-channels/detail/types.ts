export interface Cen {
  id: string;
  name: string;
  description?: string;
  strategy?: string;
  topology?: string;
  hubId?: string;
  status: 'creating' | 'available';
  createdAt: string;
  tenantId: string;
  attachCount: number;
  loss?: number;
  latency?: number;
  sla?: number;
  accessIp?: string;
  publicIp?: string;
  privateIp?: string;
}

export interface SecurityDomainOption {
  id: string;
  name: string;
  type?: string;
  category?: string;
  subType?: string;
  vpcId?: string;
  provider?: string;
  region?: string;
  cloudId?: string;
  cidr?: string;
  cidr6?: string;
  vrName?: string;
  vrUuid?: string;
  vrInstanceIds?: string;
  vrPublicEniIds?: string;
  vrPrivateEniIds?: string;
  vrPublicIp?: string;
  vrPublicEip?: string;
  vrPrivateIp?: string;
  vrPublicSubnetCidr?: string;
  vrPrivateSubnetCidr?: string;
}

export interface AppItem {
  id: string;
  name: string;
  domainId: string;
  domainName?: string;
  type: 'vm' | 'container' | 'service_address' | 'mixed';
  instanceCount: number;
  status: 'running' | 'stopped' | 'degraded';
  version?: string;
  owner?: string;
  serviceAddresses?: Array<{ protocol: string; ip: string; port: string }>;
  servicePorts?: Array<{ protocol: string; port: string }>;
  instances?: any[];
}

export interface SecurityServiceItem {
  id: string;
  name: string;
  type?: string;
  vendor?: string;
  defenseType?: string;
  neCount?: number;
  source?: string;
  status?: string;
  domainId?: string;
  domainName?: string;
  [key: string]: any;
}

export type ServiceTableRow = {
  key: string;
  service: any;
  instance: any;
};
