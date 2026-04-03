/**
 * Kube-OVN 在 Tower UI 中的展示模型：纯函数、可单测，供向导与各 Section 复用。
 * 与 CR 字段约定：`tower.io/alias`、内置 VPC 名见 lib/kubeOvnSubnetConstants。
 */
import { isBuiltInKubeOvnVpc, TOWER_ALIAS_ANNOTATION } from './kubeOvnSubnetConstants';
import { isSystemNamespace } from '../../../../../utils/harvesterUtils';

export type BusinessVpcPickerRow = {
  id: string;
  display: string;
  namespacesDisplay: string;
  searchLabel: string;
};

/**
 * 业务 VPC 下拉数据源（过滤内置 VPC；展示别名与命名空间列表）。
 */
export function buildBusinessVpcPickerRows(vpcs: any[] | undefined | null): BusinessVpcPickerRow[] {
  return (vpcs || [])
    .map((v: any) => {
      const id = String(v?.name || v?.metadata?.name || '').trim();
      if (!id || isBuiltInKubeOvnVpc(id)) return null;
      const namespacesRaw = (v?.namespaces || v?.spec?.namespaces || []) as unknown[];
      const namespaces = (Array.isArray(namespacesRaw) ? namespacesRaw : [])
        .map((x) => String(x ?? '').trim())
        .filter((x) => x && !isSystemNamespace(x));
      const alias = String(v?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] || '').trim();
      const display = alias || id;
      const namespacesDisplay = namespaces.length > 0 ? namespaces.join('、') : '-';
      const searchLabel = [display, id, namespaces.join(' ')].filter(Boolean).join(' ').toLowerCase();
      return { id, display, namespacesDisplay, searchLabel };
    })
    .filter((x): x is BusinessVpcPickerRow => x !== null);
}

export function vpcIdToDisplayRecord(rows: BusinessVpcPickerRow[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of rows) {
    m[r.id] = r.display;
  }
  return m;
}

/**
 * 任意 VPC 列表 → id → 展示名（别名优先）。含内置 VPC，用于表格 spec.vpc 列。
 */
export function vpcDisplayMapFromVpcs(vpcs: any[] | undefined | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of vpcs || []) {
    const id = String(v?.name || v?.metadata?.name || '').trim();
    if (!id) continue;
    const alias = String(v?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
    m.set(id, alias || id);
  }
  return m;
}

export function kubeSubnetCrName(s: any): string {
  return String(s?.metadata?.name || s?.name || '').trim();
}

/** 子网下拉：别名 (crName) 或 crName */
export function kubeSubnetChoiceLabel(s: any): string {
  const name = kubeSubnetCrName(s);
  if (!name) return '-';
  const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
  return alias ? `${alias} (${name})` : name;
}

/**
 * 创建云主机向导：VPC 下拉 { label, value }，过滤内置并带别名。
 */
export function kubeVpcOptionsForVmWizard(vpcs: any[] | undefined | null): Array<{ label: string; value: string }> {
  return (vpcs || [])
    .map((x: any) => {
      const id = String(x?.name || x?.metadata?.name || '').trim();
      if (!id || isBuiltInKubeOvnVpc(id)) return null;
      const alias = String(x?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] || '').trim();
      const label = alias ? `${alias} (${id})` : id;
      return { label, value: id };
    })
    .filter((x): x is { label: string; value: string } => x !== null);
}
