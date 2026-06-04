/**
 * 虚拟机部署集：Tower 本地定义，供 VM Pod 标签与亲和/反亲和引用。
 */
import { randomUUID } from 'crypto';
import { AppDataSource } from '../../../config/database';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';
import {
  normalizeDeploymentSetLabels,
  validateDeploymentSetLabels,
  validateDeploymentSetName,
} from './deploymentSetName';
import {
  normalizeDeploymentSetScheduling,
  type DeploymentSetSchedulingInput,
} from './deploymentSetScheduling';
import {
  DEPLOYMENT_SET_POD_LABEL,
  type DeploymentSetOverview,
  type DeploymentSetRow,
} from './deploymentSetTypes';

function parseLabelsJson(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return normalizeDeploymentSetLabels(raw);
  }
  try {
    const parsed = JSON.parse(String(raw));
    return normalizeDeploymentSetLabels(parsed);
  } catch {
    return {};
  }
}

async function listSetRows(cloudId: string) {
  return AppDataSource.query(
    `SELECT id, cloudId, name, namespace, labels, description, sortOrder,
            schedulingPolicy, schedulingStrength, topologyKey, createdAt, updatedAt
     FROM cloud_deployment_sets WHERE cloudId = ? ORDER BY sortOrder ASC, name ASC`,
    [cloudId],
  );
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

async function countVmsBySetId(cloudId: string): Promise<Map<string, number>> {
  const repo = AppDataSource.getRepository(HarvesterVmInventory);
  const vms = await repo.find({ where: { cloudId } });
  const counts = new Map<string, number>();
  for (const vm of vms) {
    const labels = readVmPodLabels(vm);
    const setId = String(labels[DEPLOYMENT_SET_POD_LABEL] || '').trim();
    if (!setId) continue;
    counts.set(setId, (counts.get(setId) || 0) + 1);
  }
  return counts;
}

function assembleRows(rows: any[], vmCounts: Map<string, number>): DeploymentSetRow[] {
  return rows.map((r) => {
    const scheduling = normalizeDeploymentSetScheduling({
      schedulingPolicy: r.schedulingPolicy,
      schedulingStrength: r.schedulingStrength,
      topologyKey: r.topologyKey,
    });
    return {
      id: r.id,
      cloudId: r.cloudId,
      name: r.name,
      namespace: r.namespace,
      labels: parseLabelsJson(r.labels),
      description: r.description || undefined,
      sortOrder: Number(r.sortOrder) || 0,
      ...scheduling,
      vmCount: vmCounts.get(r.id) || 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export async function getDeploymentSetOverview(cloudId: string): Promise<DeploymentSetOverview> {
  const [rows, vmCounts] = await Promise.all([listSetRows(cloudId), countVmsBySetId(cloudId)]);
  return {
    deploymentSets: assembleRows(rows, vmCounts),
    podLabelKey: DEPLOYMENT_SET_POD_LABEL,
  };
}

function normalizeNamespace(namespace: unknown): string {
  return String(namespace ?? '').trim();
}

export async function createDeploymentSet(
  cloudId: string,
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
  const namespace = normalizeNamespace(input.namespace);
  const labels = normalizeDeploymentSetLabels(input.labels);
  const labelsErr = validateDeploymentSetLabels(labels);
  if (labelsErr) throw Object.assign(new Error(labelsErr), { status: 400 });
  const scheduling = normalizeDeploymentSetScheduling(input);

  const dup = await AppDataSource.query(
    `SELECT id FROM cloud_deployment_sets WHERE cloudId = ? AND name = ? LIMIT 1`,
    [cloudId, name],
  );
  if (dup?.length) throw Object.assign(new Error('部署集名称已存在'), { status: 409 });

  let sortOrder = Number(input.sortOrder);
  if (!Number.isFinite(sortOrder)) {
    const maxRow = await AppDataSource.query(
      `SELECT COALESCE(MAX(sortOrder), -1) AS m FROM cloud_deployment_sets WHERE cloudId = ?`,
      [cloudId],
    );
    sortOrder = Number(maxRow?.[0]?.m ?? -1) + 1;
  }

  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO cloud_deployment_sets
      (id, cloudId, name, namespace, labels, description, sortOrder, schedulingPolicy, schedulingStrength, topologyKey)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      cloudId,
      name,
      namespace,
      JSON.stringify(labels),
      String(input.description || '').trim() || null,
      sortOrder,
      scheduling.schedulingPolicy,
      scheduling.schedulingStrength,
      scheduling.topologyKey,
    ],
  );
  const overview = await getDeploymentSetOverview(cloudId);
  const row = overview.deploymentSets.find((d) => d.id === id);
  if (!row) throw new Error('创建后读取部署集失败');
  return row;
}

export async function updateDeploymentSet(
  cloudId: string,
  setId: string,
  input: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    description?: string;
    sortOrder?: number;
  } & DeploymentSetSchedulingInput,
): Promise<DeploymentSetRow> {
  const id = String(setId || '').trim();
  const existing = await AppDataSource.query(
    `SELECT id, name FROM cloud_deployment_sets WHERE id = ? AND cloudId = ? LIMIT 1`,
    [id, cloudId],
  );
  if (!existing?.length) throw Object.assign(new Error('部署集不存在'), { status: 404 });

  const oldName = String(existing[0].name || '').trim();
  const newName = input.name != null ? String(input.name).trim() : oldName;
  const nameErr = validateDeploymentSetName(newName);
  if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 });
  if (newName !== oldName) {
    const dup = await AppDataSource.query(
      `SELECT id FROM cloud_deployment_sets WHERE cloudId = ? AND name = ? AND id != ? LIMIT 1`,
      [cloudId, newName, id],
    );
    if (dup?.length) throw Object.assign(new Error('部署集名称已存在'), { status: 409 });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (newName !== oldName) {
    sets.push('name = ?');
    params.push(newName);
  }
  if (input.namespace != null) {
    sets.push('namespace = ?');
    params.push(normalizeNamespace(input.namespace));
  }
  if (input.labels !== undefined) {
    const labels = normalizeDeploymentSetLabels(input.labels);
    const labelsErr = validateDeploymentSetLabels(labels);
    if (labelsErr) throw Object.assign(new Error(labelsErr), { status: 400 });
    sets.push('labels = ?');
    params.push(JSON.stringify(labels));
  }
  if (input.description !== undefined) {
    sets.push('description = ?');
    params.push(String(input.description || '').trim() || null);
  }
  if (input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))) {
    sets.push('sortOrder = ?');
    params.push(Number(input.sortOrder));
  }
  if (
    input.schedulingPolicy !== undefined ||
    input.schedulingStrength !== undefined ||
    input.topologyKey !== undefined
  ) {
    const scheduling = normalizeDeploymentSetScheduling(input);
    sets.push('schedulingPolicy = ?');
    params.push(scheduling.schedulingPolicy);
    sets.push('schedulingStrength = ?');
    params.push(scheduling.schedulingStrength);
    sets.push('topologyKey = ?');
    params.push(scheduling.topologyKey);
  }
  if (sets.length) {
    sets.push("updatedAt = datetime('now')");
    params.push(id, cloudId);
    await AppDataSource.query(
      `UPDATE cloud_deployment_sets SET ${sets.join(', ')} WHERE id = ? AND cloudId = ?`,
      params,
    );
  }

  const overview = await getDeploymentSetOverview(cloudId);
  const row = overview.deploymentSets.find((d) => d.id === id);
  if (!row) throw new Error('更新后读取部署集失败');
  return row;
}

export async function deleteDeploymentSet(cloudId: string, setId: string): Promise<void> {
  const id = String(setId || '').trim();
  const existing = await AppDataSource.query(
    `SELECT id FROM cloud_deployment_sets WHERE id = ? AND cloudId = ? LIMIT 1`,
    [id, cloudId],
  );
  if (!existing?.length) throw Object.assign(new Error('部署集不存在'), { status: 404 });

  const vmCounts = await countVmsBySetId(cloudId);
  const count = vmCounts.get(id) || 0;
  if (count > 0) {
    throw Object.assign(
      new Error(`仍有 ${count} 台虚拟机归属该部署集，请先解除关联后再删除`),
      { status: 409 },
    );
  }

  await AppDataSource.query(`DELETE FROM cloud_deployment_sets WHERE id = ? AND cloudId = ?`, [
    id,
    cloudId,
  ]);
}

/** 供 VM 创建/变配写入 Pod template labels */
export function buildDeploymentSetPodLabels(set: {
  id: string;
  labels?: Record<string, string>;
}): Record<string, string> {
  const custom = normalizeDeploymentSetLabels(set.labels);
  return {
    ...custom,
    [DEPLOYMENT_SET_POD_LABEL]: set.id,
  };
}
