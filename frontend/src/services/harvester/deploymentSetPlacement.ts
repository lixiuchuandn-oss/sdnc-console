import { FAILURE_DOMAIN_NODE_LABEL } from './failureDomains';
import type {
  DeploymentSetSchedulingPolicy,
  DeploymentSetSchedulingStrength,
} from './deploymentSetScheduling';
import { DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY } from './deploymentSetConstants';

/** 用户可见的置放策略预设（后台映射为 affinity + topologyKey） */
export type DeploymentSetPlacementPreset =
  | 'none'
  | 'spread_host_preferred'
  | 'spread_host_required'
  | 'spread_failure_domain_preferred'
  | 'spread_failure_domain_required'
  | 'spread_zone_required'
  | 'pack_host_preferred'
  | 'custom';

export type DeploymentSetSchedulingFields = {
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: DeploymentSetSchedulingStrength;
  topologyKey: string;
};

export type DeploymentSetCapacityContext = {
  schedulableNodeCount: number;
  failureDomainCountWithNodes: number;
  distinctZoneCount: number;
};

const PLACEMENT_PRESET_DEFINITIONS: Record<
  Exclude<DeploymentSetPlacementPreset, 'custom'>,
  DeploymentSetSchedulingFields & { label: string; hint: string }
> = {
  none: {
    label: '不启用',
    hint: '仅通过标签归类虚拟机，不自动施加聚集或分散约束。',
    schedulingPolicy: 'none',
    schedulingStrength: 'preferred',
    topologyKey: DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  },
  spread_host_preferred: {
    label: '高可用 · 尽量分散到不同物理机',
    hint: '同部署集虚拟机尽量落在不同宿主机，资源不足时仍可能同机。',
    schedulingPolicy: 'anti_affinity',
    schedulingStrength: 'preferred',
    topologyKey: DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  },
  spread_host_required: {
    label: '严格高可用 · 必须分散到不同物理机',
    hint: '同部署集虚拟机不得落在同一宿主机；宿主机数量不足时将无法调度。',
    schedulingPolicy: 'anti_affinity',
    schedulingStrength: 'required',
    topologyKey: DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  },
  spread_failure_domain_preferred: {
    label: '按故障域 · 尽量分散',
    hint: '同部署集虚拟机尽量落在不同故障域（与「计算配置 > 故障域」节点分组一致）。',
    schedulingPolicy: 'anti_affinity',
    schedulingStrength: 'preferred',
    topologyKey: FAILURE_DOMAIN_NODE_LABEL,
  },
  spread_failure_domain_required: {
    label: '按故障域 · 必须分散',
    hint: '同部署集虚拟机不得落在同一故障域；已分配节点的故障域数量不足时将无法调度。',
    schedulingPolicy: 'anti_affinity',
    schedulingStrength: 'required',
    topologyKey: FAILURE_DOMAIN_NODE_LABEL,
  },
  spread_zone_required: {
    label: '跨可用区 · 必须分散',
    hint: '同部署集虚拟机不得落在同一可用区；依赖节点上的可用区标签。',
    schedulingPolicy: 'anti_affinity',
    schedulingStrength: 'required',
    topologyKey: 'topology.kubernetes.io/zone',
  },
  pack_host_preferred: {
    label: '低时延 · 尽量聚集到同一物理机',
    hint: '同部署集虚拟机尽量落在同一宿主机，以换取更低互访时延。',
    schedulingPolicy: 'affinity',
    schedulingStrength: 'preferred',
    topologyKey: DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  },
};

export const DEPLOYMENT_SET_PLACEMENT_PRESET_OPTIONS = (
  Object.entries(PLACEMENT_PRESET_DEFINITIONS) as [
    Exclude<DeploymentSetPlacementPreset, 'custom'>,
    (typeof PLACEMENT_PRESET_DEFINITIONS)[Exclude<DeploymentSetPlacementPreset, 'custom'>],
  ][]
).map(([value, def]) => ({
  value,
  label: def.label,
  hint: def.hint,
}));

export function getDeploymentSetPlacementPresetHint(
  preset: DeploymentSetPlacementPreset | undefined,
): string | null {
  if (!preset || preset === 'custom') return null;
  return PLACEMENT_PRESET_DEFINITIONS[preset]?.hint ?? null;
}

export function resolvePlacementPresetToScheduling(
  preset: DeploymentSetPlacementPreset,
  custom?: Partial<DeploymentSetSchedulingFields>,
): DeploymentSetSchedulingFields {
  if (preset === 'custom') {
    return {
      schedulingPolicy: custom?.schedulingPolicy || 'none',
      schedulingStrength: custom?.schedulingStrength || 'preferred',
      topologyKey: custom?.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
    };
  }
  const def = PLACEMENT_PRESET_DEFINITIONS[preset];
  return {
    schedulingPolicy: def.schedulingPolicy,
    schedulingStrength: def.schedulingStrength,
    topologyKey: def.topologyKey,
  };
}

export function inferPlacementPresetFromScheduling(row: {
  schedulingPolicy?: DeploymentSetSchedulingPolicy;
  schedulingStrength?: DeploymentSetSchedulingStrength;
  topologyKey?: string;
}): DeploymentSetPlacementPreset {
  const policy = row.schedulingPolicy || 'none';
  const strength = row.schedulingStrength || 'preferred';
  const topologyKey = String(row.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY).trim();

  for (const [preset, def] of Object.entries(PLACEMENT_PRESET_DEFINITIONS) as [
    Exclude<DeploymentSetPlacementPreset, 'custom'>,
    (typeof PLACEMENT_PRESET_DEFINITIONS)[Exclude<DeploymentSetPlacementPreset, 'custom'>],
  ][]) {
    if (
      def.schedulingPolicy === policy &&
      def.schedulingStrength === strength &&
      def.topologyKey === topologyKey
    ) {
      return preset;
    }
  }
  return policy === 'none' ? 'none' : 'custom';
}

export function formatDeploymentSetPlacementSummary(row: {
  schedulingPolicy?: DeploymentSetSchedulingPolicy;
  schedulingStrength?: DeploymentSetSchedulingStrength;
  topologyKey?: string;
}): string | null {
  const preset = inferPlacementPresetFromScheduling(row);
  if (preset !== 'custom') {
    const def = PLACEMENT_PRESET_DEFINITIONS[preset];
    return preset === 'none' ? null : def.label;
  }

  const policy = row.schedulingPolicy || 'none';
  if (policy === 'none') return null;

  const strength = row.schedulingStrength || 'preferred';
  const strengthLabel = strength === 'required' ? '必须' : '尽量';
  const policyLabel =
    policy === 'anti_affinity' ? '分散' : policy === 'affinity' ? '聚集' : policy;
  const scopeLabel = formatTopologyScopeLabel(row.topologyKey);
  return `${strengthLabel}${policyLabel}（${scopeLabel}）`;
}

export function formatTopologyScopeLabel(topologyKey?: string): string {
  const key = String(topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY).trim();
  if (key === DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY) return '按物理机';
  if (key === FAILURE_DOMAIN_NODE_LABEL) return '按故障域';
  if (key === 'topology.kubernetes.io/zone') return '按可用区';
  if (key === 'topology.kubernetes.io/region') return '按区域';
  return key;
}

/** 「必须分散」策略下，同部署集最多可稳定容纳的 VM 数（估算上限） */
export function getRequiredSpreadCapacity(
  scheduling: DeploymentSetSchedulingFields,
  ctx: DeploymentSetCapacityContext,
): number | null {
  if (scheduling.schedulingPolicy !== 'anti_affinity' || scheduling.schedulingStrength !== 'required') {
    return null;
  }
  const key = scheduling.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY;
  if (key === DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY) {
    return ctx.schedulableNodeCount > 0 ? ctx.schedulableNodeCount : null;
  }
  if (key === FAILURE_DOMAIN_NODE_LABEL) {
    return ctx.failureDomainCountWithNodes > 0 ? ctx.failureDomainCountWithNodes : null;
  }
  if (key === 'topology.kubernetes.io/zone') {
    return ctx.distinctZoneCount > 0 ? ctx.distinctZoneCount : null;
  }
  return null;
}

export function getDeploymentSetCapacityWarning(
  vmCount: number,
  scheduling: DeploymentSetSchedulingFields,
  ctx: DeploymentSetCapacityContext,
): string | null {
  const cap = getRequiredSpreadCapacity(scheduling, ctx);
  if (cap == null) return null;

  if (cap === 0) {
    if (scheduling.topologyKey === FAILURE_DOMAIN_NODE_LABEL) {
      return '当前没有已分配节点的故障域，无法按故障域分散调度。请先在「计算配置 > 故障域」中为故障域分配节点。';
    }
    if (scheduling.topologyKey === 'topology.kubernetes.io/zone') {
      return '未检测到节点可用区标签，跨可用区分散可能无法生效。';
    }
    return '当前没有可用于分散调度的计算节点。';
  }

  if (vmCount > cap) {
    const scope = formatTopologyScopeLabel(scheduling.topologyKey);
    return `该部署集已关联 ${vmCount} 台虚拟机，但「必须分散 · ${scope}」最多约 ${cap} 台；继续添加可能导致新实例调度 Pending。`;
  }

  return null;
}

export function buildDeploymentSetCapacityContext(input: {
  nodes?: Array<{ metadata?: { name?: string; labels?: Record<string, string> } }>;
  failureDomains?: Array<{ nodeNames?: string[] }>;
}): DeploymentSetCapacityContext {
  const nodes = input.nodes || [];
  const schedulableNodeCount = nodes.filter((n) => String(n?.metadata?.name || '').trim()).length;

  const failureDomainCountWithNodes = (input.failureDomains || []).filter(
    (d) => (d.nodeNames?.length ?? 0) > 0,
  ).length;

  const zones = new Set<string>();
  nodes.forEach((n) => {
    const zone = String(n?.metadata?.labels?.['topology.kubernetes.io/zone'] || '').trim();
    if (zone) zones.add(zone);
  });

  return {
    schedulableNodeCount,
    failureDomainCountWithNodes,
    distinctZoneCount: zones.size,
  };
}
