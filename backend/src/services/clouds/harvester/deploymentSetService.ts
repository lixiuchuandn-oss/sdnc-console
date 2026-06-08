/**
 * 虚拟机部署集：持久化到集群 DeploySet CR（deploysets.hms.rivercloud.com/v1）。
 */
import { AppDataSource } from '../../../config/database';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';
import {
  buildDeploySetCrManifest,
  createDeploySetCr,
  deleteDeploySetCr,
  getDeploySetCr,
  listDeploySetCrs,
  updateDeploySetCr,
  type DeploySetCrPlacementPolicy,
  type DeploySetCrPlacementStrength,
  type DeploySetCrSpecInput,
} from '../../hms/deploySetCr';
import {
  normalizeDeploymentSetLabels,
  validateDeploymentSetLabels,
  validateDeploymentSetName,
} from './deploymentSetName';
import {
  DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  normalizeDeploymentSetScheduling,
  type DeploymentSetSchedulingInput,
  type DeploymentSetSchedulingPolicy,
} from './deploymentSetScheduling';
import {
  DEPLOYMENT_SET_POD_LABEL,
  type DeploymentSetOverview,
  type DeploymentSetRow,
} from './deploymentSetTypes';

type HarvesterCloudRef = {
  id: string;
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
};

function towerPolicyToCr(policy: DeploymentSetSchedulingPolicy): DeploySetCrPlacementPolicy {
  if (policy === 'affinity') return 'Affinity';
  if (policy === 'anti_affinity') return 'AntiAffinity';
  return 'None';
}

function crPolicyToTower(policy: unknown): DeploymentSetSchedulingPolicy {
  const p = String(policy || 'None');
  if (p === 'Affinity') return 'affinity';
  if (p === 'AntiAffinity') return 'anti_affinity';
  return 'none';
}

function towerStrengthToCr(strength: string): DeploySetCrPlacementStrength {
  return strength === 'required' ? 'Required' : 'Preferred';
}

function crStrengthToTower(strength: unknown): 'preferred' | 'required' {
  return String(strength || 'Preferred') === 'Required' ? 'required' : 'preferred';
}

function readVmPodLabels(vm: HarvesterVmInventory): Record<string, string> {
  const fromTemplate =
    vm?.template?.metadata?.labels ||
    vm?.rawData?.spec?.template?.metadata?.labels ||
    vm?.rawData?.template?.metadata?.labels;
  if (fromTemplate && typeof fromTemplate === 'object') {
    return normalizeDeploymentSetLabels(fromTemplate);
  }
  return {};
}

async function countVmsBySetKey(cloudId: string): Promise<Map<string, number>> {
  const repo = AppDataSource.getRepository(HarvesterVmInventory);
  const vms = await repo.find({ where: { cloudId } });
  const counts = new Map<string, number>();
  for (const vm of vms) {
    const labels = readVmPodLabels(vm);
    const setKey = String(labels[DEPLOYMENT_SET_POD_LABEL] || '').trim();
    if (!setKey) continue;
    counts.set(setKey, (counts.get(setKey) || 0) + 1);
  }
  return counts;
}

function stripSystemPodLabel(labels: Record<string, string>): Record<string, string> {
  const out = { ...labels };
  delete out[DEPLOYMENT_SET_POD_LABEL];
  return out;
}

function crItemToRow(cr: any, cloudId: string, vmCounts: Map<string, number>): DeploymentSetRow | null {
  const name = String(cr?.metadata?.name || '').trim();
  if (!name) return null;

  const spec = cr?.spec || {};
  const schedulingPolicy = crPolicyToTower(spec?.placement?.policy);
  const scheduling = normalizeDeploymentSetScheduling({
    schedulingPolicy,
    schedulingStrength: crStrengthToTower(spec?.placement?.strength),
    topologyKey: spec?.placement?.topologyKey || DEFAULT_DEPLOYMENT_SET_TOPOLOGY_KEY,
  });

  const rawLabels = normalizeDeploymentSetLabels(spec?.podTemplateLabels || {});
  const labels = stripSystemPodLabel(rawLabels);

  return {
    id: name,
    cloudId,
    name,
    namespace: String(spec?.projectNamespace || '').trim(),
    labels,
    description: String(spec?.description || '').trim() || undefined,
    sortOrder: Number.isFinite(Number(spec?.sortOrder)) ? Number(spec.sortOrder) : 0,
    ...scheduling,
    vmCount: vmCounts.get(name) || 0,
    createdAt: String(cr?.metadata?.creationTimestamp || '').trim() || undefined,
    updatedAt: undefined,
  };
}

function buildCrSpecFromInput(
  name: string,
  input: {
    namespace?: string;
    labels?: Record<string, string>;
    description?: string;
    sortOrder?: number;
  } & DeploymentSetSchedulingInput,
): DeploySetCrSpecInput {
  const scheduling = normalizeDeploymentSetScheduling(input);
  const customLabels = stripSystemPodLabel(normalizeDeploymentSetLabels(input.labels));
  const podTemplateLabels: Record<string, string> = {
    ...customLabels,
    [DEPLOYMENT_SET_POD_LABEL]: name,
  };

  const placement: DeploySetCrSpecInput['placement'] = {
    policy: towerPolicyToCr(scheduling.schedulingPolicy),
  };
  if (scheduling.schedulingPolicy !== 'none') {
    placement.strength = towerStrengthToCr(scheduling.schedulingStrength);
    placement.topologyKey = scheduling.topologyKey;
  }

  const spec: DeploySetCrSpecInput = {
    placement,
    podTemplateLabels,
  };

  const description = String(input.description || '').trim();
  if (description) spec.description = description;

  const namespace = String(input.namespace ?? '').trim();
  if (namespace) spec.projectNamespace = namespace;

  if (input.sortOrder != null && Number.isFinite(Number(input.sortOrder))) {
    spec.sortOrder = Math.floor(Number(input.sortOrder));
  }

  return spec;
}

async function loadOverviewRows(cloud: HarvesterCloudRef): Promise<DeploymentSetRow[]> {
  const listed = await listDeploySetCrs(cloud);
  if (!listed.apiAvailable) {
    throw Object.assign(
      new Error(
        listed.error ||
          '无法从集群拉取 DeploySet 列表，请确认已安装 deploysets.hms.rivercloud.com CRD。',
      ),
      { status: 503 },
    );
  }

  const vmCounts = await countVmsBySetKey(cloud.id);
  const rows = listed.items
    .map((item) => crItemToRow(item, cloud.id, vmCounts))
    .filter((row): row is DeploymentSetRow => !!row);

  rows.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

async function getRowByName(cloud: HarvesterCloudRef, name: string): Promise<DeploymentSetRow> {
  const rows = await loadOverviewRows(cloud);
  const row = rows.find((r) => r.id === name || r.name === name);
  if (!row) throw Object.assign(new Error('部署集不存在'), { status: 404 });
  return row;
}

export async function getDeploymentSetOverview(cloud: HarvesterCloudRef): Promise<DeploymentSetOverview> {
  return {
    deploymentSets: await loadOverviewRows(cloud),
    podLabelKey: DEPLOYMENT_SET_POD_LABEL,
  };
}

export async function createDeploymentSet(
  cloud: HarvesterCloudRef,
  input: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    description?: string;
    sortOrder?: number;
  } & DeploymentSetSchedulingInput,
): Promise<DeploymentSetRow> {
  const name = String(input.name || '').trim();
  const nameErr = validateDeploymentSetName(name);
  if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 });

  const labels = normalizeDeploymentSetLabels(input.labels);
  const labelsErr = validateDeploymentSetLabels(labels);
  if (labelsErr) throw Object.assign(new Error(labelsErr), { status: 400 });

  buildDeploySetCrManifest(name, buildCrSpecFromInput(name, input));

  const listed = await listDeploySetCrs(cloud);
  if (!listed.apiAvailable) {
    throw Object.assign(
      new Error(listed.error || 'DeploySet CR API 不可用'),
      { status: 503 },
    );
  }
  if (listed.items.some((item) => String(item?.metadata?.name || '').trim() === name)) {
    throw Object.assign(new Error('部署集名称已存在'), { status: 409 });
  }

  await createDeploySetCr(cloud, {
    name,
    spec: buildCrSpecFromInput(name, input),
  });

  return getRowByName(cloud, name);
}

export async function updateDeploymentSet(
  cloud: HarvesterCloudRef,
  setId: string,
  input: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    description?: string;
    sortOrder?: number;
  } & DeploymentSetSchedulingInput,
): Promise<DeploymentSetRow> {
  const crName = String(setId || '').trim();
  if (!crName) throw Object.assign(new Error('缺少部署集标识'), { status: 400 });

  try {
    await getDeploySetCr(cloud, crName);
  } catch (e: any) {
    if (Number(e?.status) === 404) {
      throw Object.assign(new Error('部署集不存在'), { status: 404 });
    }
    throw e;
  }

  const newName = input.name != null ? String(input.name).trim() : crName;
  const nameErr = validateDeploymentSetName(newName);
  if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 });

  if (input.labels !== undefined) {
    const labelsErr = validateDeploymentSetLabels(normalizeDeploymentSetLabels(input.labels));
    if (labelsErr) throw Object.assign(new Error(labelsErr), { status: 400 });
  }

  if (newName !== crName) {
    const vmCounts = await countVmsBySetKey(cloud.id);
    const count = vmCounts.get(crName) || 0;
    if (count > 0) {
      throw Object.assign(new Error(`仍有 ${count} 台虚拟机归属该部署集，无法重命名`), {
        status: 409,
      });
    }
    try {
      await getDeploySetCr(cloud, newName);
      throw Object.assign(new Error('部署集名称已存在'), { status: 409 });
    } catch (e: any) {
      if (Number(e?.status) === 409) throw e;
      if (Number(e?.status) !== 404 && e?.status) throw e;
    }

    const existingRows = await loadOverviewRows(cloud);
    const existing = existingRows.find((r) => r.id === crName);
    const merged = {
      name: newName,
      namespace: input.namespace ?? existing?.namespace,
      labels: input.labels ?? existing?.labels,
      description: input.description ?? existing?.description,
      sortOrder: input.sortOrder ?? existing?.sortOrder,
      schedulingPolicy: input.schedulingPolicy ?? existing?.schedulingPolicy,
      schedulingStrength: input.schedulingStrength ?? existing?.schedulingStrength,
      topologyKey: input.topologyKey ?? existing?.topologyKey,
    };

    await createDeploySetCr(cloud, {
      name: newName,
      spec: buildCrSpecFromInput(newName, merged),
    });
    await deleteDeploySetCr(cloud, crName);
    return getRowByName(cloud, newName);
  }

  const existingRows = await loadOverviewRows(cloud);
  const existing = existingRows.find((r) => r.id === crName);
  if (!existing) throw Object.assign(new Error('部署集不存在'), { status: 404 });

  const merged = {
    name: crName,
    namespace: input.namespace ?? existing.namespace,
    labels: input.labels ?? existing.labels,
    description: input.description ?? existing.description,
    sortOrder: input.sortOrder ?? existing.sortOrder,
    schedulingPolicy: input.schedulingPolicy ?? existing.schedulingPolicy,
    schedulingStrength: input.schedulingStrength ?? existing.schedulingStrength,
    topologyKey: input.topologyKey ?? existing.topologyKey,
  };

  await updateDeploySetCr(cloud, crName, {
    spec: buildCrSpecFromInput(crName, merged),
  });

  return getRowByName(cloud, crName);
}

export async function deleteDeploymentSet(cloud: HarvesterCloudRef, setId: string): Promise<void> {
  const crName = String(setId || '').trim();
  if (!crName) throw Object.assign(new Error('缺少部署集标识'), { status: 400 });

  try {
    await getDeploySetCr(cloud, crName);
  } catch (e: any) {
    if (Number(e?.status) === 404) {
      throw Object.assign(new Error('部署集不存在'), { status: 404 });
    }
    throw e;
  }

  const vmCounts = await countVmsBySetKey(cloud.id);
  const count = vmCounts.get(crName) || 0;
  if (count > 0) {
    throw Object.assign(new Error(`仍有 ${count} 台虚拟机归属该部署集，请先解除关联后再删除`), {
      status: 409,
    });
  }

  await deleteDeploySetCr(cloud, crName);
}

/** 供 VM 创建/变配写入 Pod template labels */
export function buildDeploymentSetPodLabels(set: {
  id: string;
  labels?: Record<string, string>;
}): Record<string, string> {
  const custom = stripSystemPodLabel(normalizeDeploymentSetLabels(set.labels));
  return {
    ...custom,
    [DEPLOYMENT_SET_POD_LABEL]: set.id,
  };
}
