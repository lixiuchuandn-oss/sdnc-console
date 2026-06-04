import { apiDelete, apiPost, apiPut, apiRequest } from '../api';
import type {
  DeploymentSetSchedulingPolicy,
  DeploymentSetSchedulingStrength,
} from './deploymentSetScheduling';
import { DEPLOYMENT_SET_POD_LABEL } from './deploymentSetConstants';

export type { DeploymentSetSchedulingPolicy, DeploymentSetSchedulingStrength };
export {
  buildDeploymentSetPodAffinityConfig,
  DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  DEPLOYMENT_SET_SCHEDULING_POLICY_OPTIONS,
  DEPLOYMENT_SET_SCHEDULING_STRENGTH_OPTIONS,
  DEPLOYMENT_SET_TOPOLOGY_KEY_OPTIONS,
  formatDeploymentSetSchedulingSummary,
} from './deploymentSetScheduling';

export { DEPLOYMENT_SET_POD_LABEL };

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
};

export type DeploymentSetSchedulingBody = {
  schedulingPolicy?: DeploymentSetSchedulingPolicy;
  schedulingStrength?: DeploymentSetSchedulingStrength;
  topologyKey?: string;
};

export type DeploymentSetOverview = {
  deploymentSets: DeploymentSetRow[];
  podLabelKey: string;
};

export async function fetchDeploymentSetOverview(cloudId: string, force = false) {
  const qs = force ? '?force=true' : '';
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/deployment-sets/overview${qs}`, {
    skipCache: true,
  });
}

export async function createDeploymentSet(
  cloudId: string,
  body: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    description?: string;
    sortOrder?: number;
  } & DeploymentSetSchedulingBody,
) {
  return apiPost(`/api/clouds/${cloudId}/resources/harvester/deployment-sets`, body);
}

export async function updateDeploymentSet(
  cloudId: string,
  setId: string,
  body: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    description?: string;
    sortOrder?: number;
  } & DeploymentSetSchedulingBody,
) {
  return apiPut(`/api/clouds/${cloudId}/resources/harvester/deployment-sets/${setId}`, body);
}

export async function deleteDeploymentSet(cloudId: string, setId: string) {
  return apiDelete(`/api/clouds/${cloudId}/resources/harvester/deployment-sets/${setId}`);
}

/** 将部署集转为 Pod 标签（含系统键 tower.io/deployment-set） */
export function buildDeploymentSetPodLabels(set: {
  id: string;
  labels?: Record<string, string>;
}): Record<string, string> {
  const custom = { ...(set.labels || {}) };
  delete custom[DEPLOYMENT_SET_POD_LABEL];
  return {
    ...custom,
    [DEPLOYMENT_SET_POD_LABEL]: set.id,
  };
}

/** 生成「同部署集聚集/分散」亲和规则示例（topologyKey 默认宿主机） */
export function buildDeploymentSetAffinityMatchLabels(setId: string): Record<string, string> {
  return { [DEPLOYMENT_SET_POD_LABEL]: setId };
}
