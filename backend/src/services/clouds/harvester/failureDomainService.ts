/**
 * 集群故障域：Tower 本地定义 + 节点 label 同步。
 */
import { randomUUID } from 'crypto';
import { AppDataSource } from '../../../config/database';
import { HarvesterNodeInventory } from '../../../entities/harvester/HarvesterNodeInventory';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';
import { getJsonOnce, requestJson } from './utils';
import {
  FAILURE_DOMAIN_NODE_LABEL,
  type FailureDomainOverview,
  type FailureDomainRow,
  type FailureDomainType,
  type VmFailureDomainRef,
} from './failureDomainTypes';
import { validateFailureDomainName } from './failureDomainName';

const VALID_TYPES = new Set<FailureDomainType>(['rack', 'zone', 'host']);

function normalizeType(raw: unknown): FailureDomainType {
  const t = String(raw || 'rack')
    .trim()
    .toLowerCase();
  if (VALID_TYPES.has(t as FailureDomainType)) return t as FailureDomainType;
  return 'rack';
}

async function resolveClusterId(
  origin: string,
  token: string,
  insecure: boolean,
): Promise<string | null> {
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true);
    const arr = Array.isArray(clusters?.data)
      ? clusters.data
      : Array.isArray(clusters?.items)
        ? clusters.items
        : [];
    const local = arr.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = arr[0];
    const id = String(local?.id || local?.Id || any?.id || any?.Id || '').trim();
    return id || null;
  } catch {
    return null;
  }
}

function nodePatchCandidates(origin: string, clusterId: string | null, nodeName: string): string[] {
  const enc = encodeURIComponent(nodeName);
  return [
    ...(clusterId
      ? [`${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/nodes/${enc}`]
      : []),
    `${origin}/api/v1/nodes/${enc}`,
    `${origin}/v1/harvester/api/v1/nodes/${enc}`,
    `${origin}/v1/core.v1.nodes/${enc}`,
  ];
}

export async function patchNodeFailureDomainLabel(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  nodeName: string,
  domainName: string | null,
): Promise<void> {
  const name = String(nodeName || '').trim();
  if (!name) throw new Error('缺少节点名称');
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = cloud.secretKey || '';
  const base = String(cloud.endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const clusterId = await resolveClusterId(origin, token, insecure);
  const patchBody = {
    metadata: {
      labels: {
        [FAILURE_DOMAIN_NODE_LABEL]: domainName ? String(domainName).trim() : null,
      },
    },
  };
  let lastErr: any;
  for (const url of nodePatchCandidates(origin, clusterId, name)) {
    try {
      await requestJson('PATCH', url, token, insecure, patchBody, {
        'Content-Type': 'application/merge-patch+json',
      });
      return;
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('更新节点故障域标签失败');
}

async function listDomainRows(cloudId: string) {
  return AppDataSource.query(
    `SELECT id, cloudId, name, domainType, description, sortOrder, createdAt, updatedAt
     FROM cloud_failure_domains WHERE cloudId = ? ORDER BY sortOrder ASC, name ASC`,
    [cloudId],
  );
}

async function listAssignments(cloudId: string) {
  return AppDataSource.query(
    `SELECT failureDomainId, nodeName FROM cloud_failure_domain_nodes WHERE cloudId = ?`,
    [cloudId],
  );
}

async function inventoryNodeNames(cloudId: string): Promise<string[]> {
  const repo = AppDataSource.getRepository(HarvesterNodeInventory);
  const rows = await repo.find({ where: { cloudId }, select: ['name'] });
  return rows.map((r) => String(r.name || '').trim()).filter(Boolean);
}

function assembleDomains(domains: any[], assignments: any[]): FailureDomainRow[] {
  const byId = new Map<string, string[]>();
  for (const a of assignments) {
    const list = byId.get(a.failureDomainId) || [];
    list.push(a.nodeName);
    byId.set(a.failureDomainId, list);
  }
  return domains.map((d) => ({
    id: d.id,
    cloudId: d.cloudId,
    name: d.name,
    domainType: normalizeType(d.domainType),
    description: d.description || undefined,
    sortOrder: Number(d.sortOrder) || 0,
    nodeNames: (byId.get(d.id) || []).sort(),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export async function getFailureDomainOverview(cloudId: string): Promise<FailureDomainOverview> {
  const [domains, assignments, nodeNames] = await Promise.all([
    listDomainRows(cloudId),
    listAssignments(cloudId),
    inventoryNodeNames(cloudId),
  ]);
  const assembled = assembleDomains(domains, assignments);
  const assigned = new Set(assignments.map((a: any) => a.nodeName));
  const unassignedNodeNames = nodeNames.filter((n) => !assigned.has(n)).sort();
  return {
    domains: assembled,
    unassignedNodeNames,
    nodeLabelKey: FAILURE_DOMAIN_NODE_LABEL,
  };
}

export async function createFailureDomain(
  cloudId: string,
  input: { name: string; domainType?: FailureDomainType; description?: string; sortOrder?: number },
): Promise<FailureDomainRow> {
  const name = String(input.name || '').trim();
  const nameErr = validateFailureDomainName(name);
  if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 });
  const dup = await AppDataSource.query(
    `SELECT id FROM cloud_failure_domains WHERE cloudId = ? AND name = ? LIMIT 1`,
    [cloudId, name],
  );
  if (dup?.length) throw Object.assign(new Error('故障域名称已存在'), { status: 409 });

  let sortOrder = Number(input.sortOrder);
  if (!Number.isFinite(sortOrder)) {
    const maxRow = await AppDataSource.query(
      `SELECT COALESCE(MAX(sortOrder), -1) AS m FROM cloud_failure_domains WHERE cloudId = ?`,
      [cloudId],
    );
    sortOrder = Number(maxRow?.[0]?.m ?? -1) + 1;
  }

  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO cloud_failure_domains (id, cloudId, name, domainType, description, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      cloudId,
      name,
      normalizeType(input.domainType),
      String(input.description || '').trim() || null,
      sortOrder,
    ],
  );
  const overview = await getFailureDomainOverview(cloudId);
  const row = overview.domains.find((d) => d.id === id);
  if (!row) throw new Error('创建后读取故障域失败');
  return row;
}

export async function updateFailureDomain(
  cloudId: string,
  domainId: string,
  cloud: any,
  input: {
    name?: string;
    domainType?: FailureDomainType;
    description?: string;
    sortOrder?: number;
  },
): Promise<FailureDomainRow> {
  const id = String(domainId || '').trim();
  const existing = await AppDataSource.query(
    `SELECT id, name FROM cloud_failure_domains WHERE id = ? AND cloudId = ? LIMIT 1`,
    [id, cloudId],
  );
  if (!existing?.length) throw Object.assign(new Error('故障域不存在'), { status: 404 });

  const oldName = String(existing[0].name || '').trim();
  const newName = input.name != null ? String(input.name).trim() : oldName;
  const nameErr = validateFailureDomainName(newName);
  if (nameErr) throw Object.assign(new Error(nameErr), { status: 400 });
  if (newName !== oldName) {
    const dup = await AppDataSource.query(
      `SELECT id FROM cloud_failure_domains WHERE cloudId = ? AND name = ? AND id != ? LIMIT 1`,
      [cloudId, newName, id],
    );
    if (dup?.length) throw Object.assign(new Error('故障域名称已存在'), { status: 409 });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (newName !== oldName) {
    sets.push('name = ?');
    params.push(newName);
  }
  if (input.domainType != null) {
    sets.push('domainType = ?');
    params.push(normalizeType(input.domainType));
  }
  if (input.description !== undefined) {
    sets.push('description = ?');
    params.push(String(input.description || '').trim() || null);
  }
  if (input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))) {
    sets.push('sortOrder = ?');
    params.push(Number(input.sortOrder));
  }
  if (sets.length) {
    sets.push("updatedAt = datetime('now')");
    params.push(id, cloudId);
    await AppDataSource.query(
      `UPDATE cloud_failure_domains SET ${sets.join(', ')} WHERE id = ? AND cloudId = ?`,
      params,
    );
  }

  if (newName !== oldName) {
    const nodes = await AppDataSource.query(
      `SELECT nodeName FROM cloud_failure_domain_nodes WHERE cloudId = ? AND failureDomainId = ?`,
      [cloudId, id],
    );
    for (const n of nodes) {
      await patchNodeFailureDomainLabel(cloud, n.nodeName, newName);
    }
  }

  const overview = await getFailureDomainOverview(cloudId);
  const row = overview.domains.find((d) => d.id === id);
  if (!row) throw new Error('更新后读取故障域失败');
  return row;
}

/** 从 VM 库存/原始对象读取 nodeSelector 中的故障域名称 */
export function readVmFailureDomainName(vmLike: unknown): string | undefined {
  const row = vmLike as {
    rawData?: { spec?: { template?: { spec?: { nodeSelector?: Record<string, unknown> } } } };
    spec?: { template?: { spec?: { nodeSelector?: Record<string, unknown> } } };
    template?: { spec?: { nodeSelector?: Record<string, unknown> } };
  };
  const nodeSelector =
    row?.rawData?.spec?.template?.spec?.nodeSelector ||
    row?.spec?.template?.spec?.nodeSelector ||
    row?.template?.spec?.nodeSelector;
  if (!nodeSelector || typeof nodeSelector !== 'object') return undefined;
  const val = String(nodeSelector[FAILURE_DOMAIN_NODE_LABEL] ?? '').trim();
  return val || undefined;
}

export function formatFailureDomainDeleteBlockedMessage(
  domainName: string,
  vms: VmFailureDomainRef[],
): string {
  const labels = vms.map((v) => v.displayName).filter(Boolean);
  if (labels.length === 0) return '故障域仍被虚拟机使用，无法删除';
  if (labels.length === 1) {
    return `故障域「${domainName}」仍被虚拟机「${labels[0]}」使用，无法删除`;
  }
  return `故障域「${domainName}」仍被以下虚拟机使用，无法删除：${labels.join('、')}`;
}

export async function findVmsUsingFailureDomain(
  cloudId: string,
  domainName: string,
): Promise<VmFailureDomainRef[]> {
  const name = String(domainName || '').trim();
  if (!name) return [];

  const repo = AppDataSource.getRepository(HarvesterVmInventory);
  const allVms = await repo.find({ where: { cloudId } });
  const out: VmFailureDomainRef[] = [];
  const seen = new Set<string>();

  for (const vm of allVms) {
    const fd = readVmFailureDomainName(vm);
    if (fd !== name) continue;

    const ns = String(vm.namespace || vm.rawData?.metadata?.namespace || '').trim();
    const vmName = String(vm.name || vm.rawData?.metadata?.name || '').trim();
    if (!vmName) continue;

    const key = `${ns}/${vmName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ann =
      (vm.annotations as Record<string, string> | undefined) ||
      (vm.rawData?.metadata?.annotations as Record<string, string> | undefined) ||
      {};
    const displayName = String(ann['tower.io/alias'] || vmName).trim() || vmName;
    out.push({ namespace: ns, name: vmName, displayName });
  }

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
}

export async function deleteFailureDomain(cloudId: string, domainId: string, cloud: any) {
  const id = String(domainId || '').trim();
  const domainRows = await AppDataSource.query(
    `SELECT id, name FROM cloud_failure_domains WHERE id = ? AND cloudId = ? LIMIT 1`,
    [id, cloudId],
  );
  if (!domainRows?.length) throw Object.assign(new Error('故障域不存在'), { status: 404 });
  const domainName = String(domainRows[0].name || '').trim();

  const usingVms = await findVmsUsingFailureDomain(cloudId, domainName);
  if (usingVms.length) {
    throw Object.assign(
      new Error(formatFailureDomainDeleteBlockedMessage(domainName, usingVms)),
      { status: 409, code: 'FAILURE_DOMAIN_IN_USE', resources: usingVms },
    );
  }

  const nodes = await AppDataSource.query(
    `SELECT nodeName FROM cloud_failure_domain_nodes WHERE cloudId = ? AND failureDomainId = ?`,
    [cloudId, id],
  );
  for (const n of nodes) {
    await patchNodeFailureDomainLabel(cloud, n.nodeName, null);
  }
  await AppDataSource.query(
    `DELETE FROM cloud_failure_domain_nodes WHERE cloudId = ? AND failureDomainId = ?`,
    [cloudId, id],
  );
  await AppDataSource.query(`DELETE FROM cloud_failure_domains WHERE id = ? AND cloudId = ?`, [
    id,
    cloudId,
  ]);
}

export async function setFailureDomainNodes(
  cloudId: string,
  domainId: string,
  nodeNames: string[],
  cloud: any,
): Promise<FailureDomainRow> {
  const id = String(domainId || '').trim();
  const domainRows = await AppDataSource.query(
    `SELECT id, name FROM cloud_failure_domains WHERE id = ? AND cloudId = ? LIMIT 1`,
    [id, cloudId],
  );
  if (!domainRows?.length) throw Object.assign(new Error('故障域不存在'), { status: 404 });
  const domainName = String(domainRows[0].name || '').trim();

  const want = Array.from(new Set(nodeNames.map((n) => String(n || '').trim()).filter(Boolean)));
  const inventory = new Set(await inventoryNodeNames(cloudId));
  for (const n of want) {
    if (!inventory.has(n)) throw Object.assign(new Error(`节点不存在: ${n}`), { status: 400 });
  }

  const current = await AppDataSource.query(
    `SELECT nodeName FROM cloud_failure_domain_nodes WHERE cloudId = ? AND failureDomainId = ?`,
    [cloudId, id],
  );
  const currentSet = new Set(current.map((r: any) => r.nodeName));
  const wantSet = new Set(want);

  for (const n of currentSet) {
    if (!wantSet.has(String(n))) {
      await patchNodeFailureDomainLabel(cloud, String(n), null);
      await AppDataSource.query(
        `DELETE FROM cloud_failure_domain_nodes WHERE cloudId = ? AND nodeName = ?`,
        [cloudId, n],
      );
    }
  }

  for (const n of want) {
    const other = await AppDataSource.query(
      `SELECT failureDomainId FROM cloud_failure_domain_nodes WHERE cloudId = ? AND nodeName = ? LIMIT 1`,
      [cloudId, n],
    );
    if (other?.length && other[0].failureDomainId !== id) {
      await patchNodeFailureDomainLabel(cloud, n, null);
      await AppDataSource.query(
        `DELETE FROM cloud_failure_domain_nodes WHERE cloudId = ? AND nodeName = ?`,
        [cloudId, n],
      );
    }
    if (!currentSet.has(n)) {
      await AppDataSource.query(
        `INSERT INTO cloud_failure_domain_nodes (id, cloudId, failureDomainId, nodeName)
         VALUES (?, ?, ?, ?)`,
        [randomUUID(), cloudId, id, n],
      );
    }
    await patchNodeFailureDomainLabel(cloud, n, domainName);
  }

  const overview = await getFailureDomainOverview(cloudId);
  const row = overview.domains.find((d) => d.id === id);
  if (!row) throw new Error('分配后读取故障域失败');
  return row;
}
