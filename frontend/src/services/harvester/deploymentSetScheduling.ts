import type { PodAffinityConfig } from '../../pages/cnmc/clouds/Harvester/containers/components/workloadForm/types';
import {
  DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  DEPLOYMENT_SET_POD_LABEL,
} from './deploymentSetConstants';
import { formatDeploymentSetPlacementSummary } from './deploymentSetPlacement';

export type DeploymentSetSchedulingPolicy = 'none' | 'affinity' | 'anti_affinity';
export type DeploymentSetSchedulingStrength = 'preferred' | 'required';

export { DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY };

export const DEPLOYMENT_SET_SCHEDULING_POLICY_OPTIONS: {
  value: DeploymentSetSchedulingPolicy;
  label: string;
}[] = [
  { value: 'none', label: '无' },
  { value: 'affinity', label: '亲和' },
  { value: 'anti_affinity', label: '反亲和' },
];

export const DEPLOYMENT_SET_SCHEDULING_STRENGTH_OPTIONS: {
  value: DeploymentSetSchedulingStrength;
  label: string;
}[] = [
  { value: 'preferred', label: '尽量' },
  { value: 'required', label: '必须' },
];

export const DEPLOYMENT_SET_TOPOLOGY_KEY_OPTIONS = [
  { value: 'kubernetes.io/hostname', label: '物理机（宿主机）' },
  { value: 'topology.cloudmap.io/failure-domain', label: '故障域（与计算配置一致）' },
  { value: 'topology.kubernetes.io/zone', label: '可用区' },
  { value: 'topology.kubernetes.io/region', label: '区域' },
];

export function formatDeploymentSetSchedulingSummary(row: {
  schedulingPolicy?: DeploymentSetSchedulingPolicy;
  schedulingStrength?: DeploymentSetSchedulingStrength;
  topologyKey?: string;
}): string | null {
  return formatDeploymentSetPlacementSummary(row);
}

/** Select 下拉项：名称 + 置放策略摘要 */
export function formatDeploymentSetSelectOptionLabel(row: {
  name: string;
  schedulingPolicy?: DeploymentSetSchedulingPolicy;
  schedulingStrength?: DeploymentSetSchedulingStrength;
  topologyKey?: string;
}): string {
  const summary = formatDeploymentSetSchedulingSummary(row);
  if (!summary) return `${row.name}（不启用）`;
  return `${row.name}（${summary}）`;
}

/** VM 引用部署集时生成表单 PodAffinityConfig（与 podAffinityK8s 兼容） */
export function buildDeploymentSetPodAffinityConfig(set: {
  id: string;
  namespace?: string;
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: DeploymentSetSchedulingStrength;
  topologyKey?: string;
}): { podAffinity?: PodAffinityConfig; podAntiAffinity?: PodAffinityConfig } | undefined {
  if (set.schedulingPolicy === 'none') return undefined;

  const term = {
    labelSelector: {
      matchLabels: { [DEPLOYMENT_SET_POD_LABEL]: set.id },
      matchExpressions: [] as never[],
    },
    namespaces: String(set.namespace || '').trim() ? [String(set.namespace).trim()] : undefined,
    topologyKey: set.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  };

  if (set.schedulingPolicy === 'affinity') {
    if (set.schedulingStrength === 'required') {
      return { podAffinity: { required: [term] } };
    }
    return {
      podAffinity: {
        preferred: [{ weight: 100, podAffinityTerm: term }],
      },
    };
  }

  if (set.schedulingStrength === 'required') {
    return { podAntiAffinity: { required: [term] } };
  }
  return {
    podAntiAffinity: {
      preferred: [{ weight: 100, podAffinityTerm: term }],
    },
  };
}
