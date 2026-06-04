import type { PodAffinityConfig } from '../../pages/cnmc/clouds/Harvester/containers/components/workloadForm/types';
import {
  DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  DEPLOYMENT_SET_POD_LABEL,
} from './deploymentSetConstants';

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
  { value: 'kubernetes.io/hostname', label: 'kubernetes.io/hostname（宿主机）' },
  { value: 'topology.kubernetes.io/zone', label: 'topology.kubernetes.io/zone（可用区）' },
  { value: 'topology.kubernetes.io/region', label: 'topology.kubernetes.io/region（区域）' },
];

export function formatDeploymentSetSchedulingSummary(row: {
  schedulingPolicy?: DeploymentSetSchedulingPolicy;
  schedulingStrength?: DeploymentSetSchedulingStrength;
}): string | null {
  const policy = row.schedulingPolicy || 'none';
  if (policy === 'none') return null;
  const policyLabel =
    DEPLOYMENT_SET_SCHEDULING_POLICY_OPTIONS.find((o) => o.value === policy)?.label || policy;
  const strength = row.schedulingStrength || 'preferred';
  const strengthLabel =
    DEPLOYMENT_SET_SCHEDULING_STRENGTH_OPTIONS.find((o) => o.value === strength)?.label || strength;
  return `${policyLabel} · ${strengthLabel}`;
}

/** Select 下拉项：名称 + 调度策略 + 约束强度 */
export function formatDeploymentSetSelectOptionLabel(row: {
  name: string;
  schedulingPolicy?: DeploymentSetSchedulingPolicy;
  schedulingStrength?: DeploymentSetSchedulingStrength;
}): string {
  const policy = row.schedulingPolicy || 'none';
  const policyLabel =
    DEPLOYMENT_SET_SCHEDULING_POLICY_OPTIONS.find((o) => o.value === policy)?.label || policy;
  if (policy === 'none') {
    return `${row.name}（${policyLabel}）`;
  }
  const strength = row.schedulingStrength || 'preferred';
  const strengthLabel =
    DEPLOYMENT_SET_SCHEDULING_STRENGTH_OPTIONS.find((o) => o.value === strength)?.label || strength;
  return `${row.name}（${policyLabel} · ${strengthLabel}）`;
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
