import { DEPLOYMENT_SET_POD_LABEL } from './deploymentSetTypes';

export type DeploymentSetSchedulingPolicy = 'none' | 'affinity' | 'anti_affinity';
export type DeploymentSetSchedulingStrength = 'preferred' | 'required';

export const DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY = 'kubernetes.io/hostname';

const VALID_POLICIES = new Set<DeploymentSetSchedulingPolicy>(['none', 'affinity', 'anti_affinity']);
const VALID_STRENGTHS = new Set<DeploymentSetSchedulingStrength>(['preferred', 'required']);

export function normalizeDeploymentSetSchedulingPolicy(raw: unknown): DeploymentSetSchedulingPolicy {
  const v = String(raw || 'none').trim() as DeploymentSetSchedulingPolicy;
  return VALID_POLICIES.has(v) ? v : 'none';
}

export function normalizeDeploymentSetSchedulingStrength(raw: unknown): DeploymentSetSchedulingStrength {
  const v = String(raw || 'preferred').trim() as DeploymentSetSchedulingStrength;
  return VALID_STRENGTHS.has(v) ? v : 'preferred';
}

export function normalizeDeploymentSetTopologyKey(raw: unknown): string {
  const v = String(raw || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY).trim();
  return v || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY;
}

export type DeploymentSetSchedulingInput = {
  schedulingPolicy?: unknown;
  schedulingStrength?: unknown;
  topologyKey?: unknown;
};

export type NormalizedDeploymentSetScheduling = {
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: DeploymentSetSchedulingStrength;
  topologyKey: string;
};

export function normalizeDeploymentSetScheduling(
  input: DeploymentSetSchedulingInput,
): NormalizedDeploymentSetScheduling {
  const schedulingPolicy = normalizeDeploymentSetSchedulingPolicy(input.schedulingPolicy);
  return {
    schedulingPolicy,
    schedulingStrength: normalizeDeploymentSetSchedulingStrength(input.schedulingStrength),
    topologyKey: normalizeDeploymentSetTopologyKey(input.topologyKey),
  };
}

/** 供 VM 引用部署集时生成 podAffinity / podAntiAffinity（K8s 结构） */
export function buildDeploymentSetAffinityForK8s(set: {
  id: string;
  namespace?: string;
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: DeploymentSetSchedulingStrength;
  topologyKey?: string;
}): Record<string, unknown> | undefined {
  if (set.schedulingPolicy === 'none') return undefined;

  const term: Record<string, unknown> = {
    labelSelector: {
      matchLabels: {
        [DEPLOYMENT_SET_POD_LABEL]: set.id,
      },
    },
    topologyKey: normalizeDeploymentSetTopologyKey(set.topologyKey),
  };
  const ns = String(set.namespace || '').trim();
  if (ns) term.namespaces = [ns];

  const blockKey =
    set.schedulingPolicy === 'affinity' ? 'podAffinity' : 'podAntiAffinity';

  if (set.schedulingStrength === 'required') {
    return {
      [blockKey]: {
        requiredDuringSchedulingIgnoredDuringExecution: [term],
      },
    };
  }

  return {
    [blockKey]: {
      preferredDuringSchedulingIgnoredDuringExecution: [
        {
          weight: 100,
          podAffinityTerm: term,
        },
      ],
    },
  };
}
