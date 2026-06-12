export type SecurityDomainType = 'IDC' | 'VPC' | '虚拟化网络' | '办公网络';
export type SecurityDomainStatus = 'active' | 'inactive';

/** CSM 安全域摘要（1:1 关联投影；勿用 Record<string, unknown> 以免与 antd Form 深部 Partial 冲突） */
export interface LinkedCsmSecurityDomainSummary {
  id?: string;
  name?: string;
  networkCidrs?: string[];
}

export interface SecurityDomain {
  id: string;
  name: string;
  type?: SecurityDomainType;
  category?: string;
  cloudId?: string;
  vpcId?: string;
  vpcMode?: 'existing' | 'new';
  newVpcName?: string;
  provider?: string;
  region?: string;
  cidr4?: string[];
  cidr6?: string[];
  cidr?: string;
  newVpcCidr?: string;
  vrUuid?: string;
  vrName?: string;
  tags?: string[];
  status?: SecurityDomainStatus;
  createdAt?: string;
  updatedAt?: string;
  vrInstanceIds?: string;
  vrPublicEniIds?: string;
  vrPublicEip?: string;
  vrPublicIp?: string;
  vrPrivateIp?: string;
  vrPublicSubnetCidr?: string;
  vrPrivateSubnetCidr?: string;
  resourcePool?: string;
  appInstances?: any[];
  cloudInstances?: any[];
  serviceChains?: any[];
  cascadeChannels?: any[];
  srv6Tunnels?: any[];
  natRules?: any[];
  aclRules?: any[];
  bypassPolicies?: any[];
  securityServices?: any[];
  linkedCsmSecurityDomain?: LinkedCsmSecurityDomainSummary | null;
  csmProtectionObjects?: any[];
  csmProjectionReady?: boolean;
  csmProjectionError?: string;
  tenantId?: string;
  tenantName?: string;
  organizationId?: string;
  organizationName?: string;
  roleKind?: 'internetwork_routing' | 'csm_mirror';
  orchestratable?: boolean;
  csmCloudId?: string;
  csmOrgId?: string;
  linkedCsmSecurityDomainId?: string;
  discoveryMode?: 'cloud_api' | 'vr_scan' | 'hybrid';
}
