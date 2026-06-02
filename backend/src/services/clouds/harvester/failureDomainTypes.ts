/**
 * 节点故障域标签（与 Tower 故障域管理、调度优选「故障域分布」对齐）。
 * 写入 K8s Node metadata.labels，供 DRS / 亲和调度读取。
 */
export const FAILURE_DOMAIN_NODE_LABEL = 'topology.cloudmap.io/failure-domain';

export type FailureDomainType = 'rack' | 'zone' | 'host';

export type FailureDomainRow = {
  id: string;
  cloudId: string;
  name: string;
  domainType: FailureDomainType;
  description?: string;
  sortOrder: number;
  nodeNames: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type FailureDomainOverview = {
  domains: FailureDomainRow[];
  unassignedNodeNames: string[];
  nodeLabelKey: string;
};
