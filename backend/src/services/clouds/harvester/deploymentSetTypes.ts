/** 虚拟机部署集：集群 DeploySet CR，供 Pod 亲和/反亲和标签引用 */

import type {
  DeploymentSetSchedulingPolicy,
  DeploymentSetSchedulingStrength,
} from './deploymentSetScheduling';

export const DEPLOYMENT_SET_POD_LABEL = 'tower.io/deployment-set';

export type DeploymentSetRow = {
  id: string;
  cloudId: string;
  name: string;
  namespace: string;
  labels: Record<string, string>;
  description?: string;
  sortOrder: number;
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: DeploymentSetSchedulingStrength;
  topologyKey: string;
  vmCount: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DeploymentSetOverview = {
  deploymentSets: DeploymentSetRow[];
  podLabelKey: string;
};
