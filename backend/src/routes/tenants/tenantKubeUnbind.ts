import { AppDataSource } from '../../config/database';
import {
  deleteHarvesterNamespace,
  getHarvesterNamespaceRaw,
  isProtectedNamespace,
} from '../../services/clouds/harvester/client';
import { getJsonOnce } from '../../services/clouds/harvester/utils';
import {
  KUBE_OVN_BUILTIN_VPC_NAMES,
  ovnNetworkScopeFromAnnotations,
} from '../../services/clouds/harvester/kubeOvnNetworkScope';
import { getPublicNamespaceNameSetForUnbind } from '../../services/clouds/harvester/publicNamespaces';
import { KubeOvnVpcInventory } from '../../entities/kubeovn/KubeOvnVpcInventory';
import { tenantLog } from './tenantRouteLogger';

/** 解绑资源池时因仍有引用资源而返回 409 的固定提示（详情见响应体各列表字段） */
export const UNBIND_RESOURCE_POOL_HAS_RESOURCES_MSG =
  '该资源池下仍有资源存在，无法解绑。请先删除或迁移相关资源。';

const KUBE_OVN_BUILTIN_VPC_SET = new Set<string>(KUBE_OVN_BUILTIN_VPC_NAMES);

const TOWER_METADATA_ALIAS = 'tower.io/alias';

export type VpcUnbindConflictRow = { displayName: string; name: string; cidrBlock?: string };

export function mergeVpcUnbindRowsByName(tower: VpcUnbindConflictRow[], kube: VpcUnbindConflictRow[]) {
  const seen = new Set(tower.map((r) => r.name));
  return [...tower, ...kube.filter((r) => r.name && !seen.has(r.name))];
}

/** Harvester / Cloudmap 类资源池 provider 判定（分配与解绑共用） */
export function isHarvesterLikeCloudProvider(pv: string): boolean {
  const p = String(pv || '').toLowerCase();
  return (
    p === 'harvester' ||
    p === 'cloudmap' ||
    p === 'cloudmap.private' ||
    p === 'cloudmap.edge'
  );
}

/** Harvester：Tower `vpcs` 表 + 本地 Kube-OVN VPC 库存；与租户命名空间有交集的业务 VPC */
export async function kubeOvnInventoryVpcConflictRows(
  cloudId: string,
  namespaceList: string[],
): Promise<VpcUnbindConflictRow[]> {
  if (!namespaceList.length) return [];
  let rows: KubeOvnVpcInventory[] = [];
  try {
    rows = await AppDataSource.getRepository(KubeOvnVpcInventory).find({ where: { cloudId } });
  } catch {
    return [];
  }
  const out: VpcUnbindConflictRow[] = [];
  for (const row of rows) {
    const raw = row.rawData || {};
    const name = String(raw?.metadata?.name || row.name || '').trim();
    if (!name || KUBE_OVN_BUILTIN_VPC_SET.has(name)) continue;
    if (ovnNetworkScopeFromAnnotations(raw) === 'underlay') continue;
    const allowed = raw?.spec?.namespaces;
    if (!Array.isArray(allowed) || allowed.length === 0) continue;
    if (!namespaceList.some((ns) => allowed.includes(ns))) continue;
    const meta = raw.metadata || {};
    const spec = raw.spec || {};
    const cid =
      typeof spec?.cidrBlocks?.[0] === 'string'
        ? String(spec.cidrBlocks[0])
        : spec?.cidrBlock != null
          ? String(spec.cidrBlock)
          : '';
    out.push({
      displayName: kubeTowerAliasDisplay(meta),
      name,
      cidrBlock: cid.trim() ? cid : '—',
    });
  }
  return out;
}

export function kubeTowerAliasDisplay(meta?: { annotations?: Record<string, string>; name?: string }) {
  if (!meta) return '—';
  const ann = meta.annotations || {};
  const a = String(ann[TOWER_METADATA_ALIAS] || '').trim();
  if (a) return a;
  return String(meta.name || '').trim() || '—';
}

export function kubePodWorkloadDisplayName(pod: any): string {
  const meta = pod?.metadata || {};
  const ann = meta.annotations || {};
  const alias = String(ann[TOWER_METADATA_ALIAS] || '').trim();
  if (alias) return alias;
  const lbl = meta.labels || {};
  const byLabel = String(
    lbl['app.kubernetes.io/instance'] ||
      lbl['app.kubernetes.io/name'] ||
      lbl['app'] ||
      '',
  ).trim();
  if (byLabel) return byLabel;
  return String(meta.name || '').trim() || '—';
}

export function isKubeVirtOrInfraPod(pod: any): boolean {
  const lbl = pod?.metadata?.labels || {};
  const nm = String(pod?.metadata?.name || '');
  if (lbl['kubevirt.io/vm'] || lbl['kubevirt.io/domain']) return true;
  if (/^virt-launcher-/i.test(nm)) return true;
  const ns = String(pod?.metadata?.namespace || '');
  const sysNs = ['kube-system', 'cattle-system', 'cattle-dashboards', 'harvester-system', 'kube-public'];
  return sysNs.includes(ns);
}

export function podLooksLikeDatabase(pod: any): boolean {
  const blob = `${JSON.stringify(pod?.metadata?.labels || {})}${pod?.metadata?.name || ''}`.toLowerCase();
  return /\b(mysql|mariadb|mongo(db)?|postgres(ql)?|redis|cockroach|tidb|galera|rds)\b/.test(blob);
}

export async function listK8sPodsClusterWideRaw(endpoint: string, token: string, insecure: boolean) {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/pods`;
  try {
    const json = await getJsonOnce(url, token, insecure);
    return Array.isArray(json?.items) ? json.items : [];
  } catch {
    return [];
  }
}

/** 解绑且已通过占用校验后，删除本组织绑定创建的租户命名空间（不删公共/system NS） */
export async function deleteHarvesterTenantNamespacesOnOrgUnbind(opts: {
  endpoint: string;
  token: string;
  insecure: boolean;
  cloudId: string;
  organizationId: string;
  namespaceCsv?: string | null;
  fallbackName: string;
}): Promise<void> {
  const { endpoint, token, insecure, cloudId, organizationId } = opts;
  const publicNamespacesSet = await getPublicNamespaceNameSetForUnbind(cloudId);
  const listed = opts.namespaceCsv
    ? opts.namespaceCsv.split(',').map((s) => s.trim()).filter(Boolean)
    : [opts.fallbackName];

  const hostParams = { endpoint, token, insecure };

  for (const ns of listed) {
    if (!ns || publicNamespacesSet.has(ns)) continue;
    if (isProtectedNamespace(ns)) {
      tenantLog.warn(`Unbind: skip deleting namespace ${ns}: protected/system name`);
      continue;
    }
    try {
      const body = await getHarvesterNamespaceRaw(hostParams, ns);
      const meta = body?.metadata;
      const labels = meta?.labels || {};
      const bindsOrg =
        String(labels['tower.io/organization-id'] || '').trim() === organizationId;
      const isDefaultAutoName = ns === `ns-${organizationId}`;
      if (!bindsOrg && !isDefaultAutoName) {
        tenantLog.info(
          `Unbind: skip deleting namespace "${ns}" — missing tower.io/organization-id for this organization (reuse binding)`,
        );
        continue;
      }
      await deleteHarvesterNamespace(hostParams, ns);
      tenantLog.info(`Unbind: deleted tenant namespace "${ns}" on cloud ${cloudId}`);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      const st = e?.response?.status ?? e?.status;
      if (st === 404 || /\b404\b|not\s*found/i.test(msg)) {
        tenantLog.debug(`Unbind: namespace "${ns}" not found on cluster (${msg})`);
        continue;
      }
      tenantLog.warn(`Unbind: failed deleting namespace "${ns}": ${msg}`);
    }
  }
}
