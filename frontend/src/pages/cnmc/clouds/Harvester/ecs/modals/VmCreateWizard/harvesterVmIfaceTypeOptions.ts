/**
 * Harvester 创建/变配向导共用的 KubeVirt 接口绑定方式选项。
 * 描述统一为：「字段名（中文说明）」，与 VmWizardUtils.buildHarvesterVmPayload 一致。
 */

export const IFACE_TYPE_OPTION_BY_VALUE: Record<string, { label: string; value: string }> = {
  bridge: { label: '桥接', value: 'bridge' },
  masquerade: { label: 'NAT', value: 'masquerade' },
  managedtap: { label: 'ManagedTap', value: 'managedtap' },
  sriov: { label: 'SR-IOV', value: 'sriov' },
  macvtap: { label: 'macvtap', value: 'macvtap' },
};

export type IfaceTypeKey = keyof typeof IFACE_TYPE_OPTION_BY_VALUE;

export function ifaceTypeOption(value: IfaceTypeKey): { label: string; value: string } {
  return IFACE_TYPE_OPTION_BY_VALUE[value] ?? { label: String(value), value: String(value) };
}

/** NAD（Multus）下可选的完整列表 */
export const NAD_MULTUS_INTERFACE_TYPES = [
  ifaceTypeOption('bridge'),
  ifaceTypeOption('masquerade'),
  ifaceTypeOption('managedtap'),
  ifaceTypeOption('sriov'),
  ifaceTypeOption('macvtap'),
];

/** 直通模式（仅 SR-IOV / MacVTap 与 NAD 配套） */
export const PASSTHROUGH_VIRT_IFACE_OPTIONS = [ifaceTypeOption('sriov'), ifaceTypeOption('macvtap')];

/** NAD 选项（与 StepNetworks / useHarvesterData 中 `_type` 一致）→ KubeVirt domain 接口绑定 */
export function passthroughKubevirtIfaceTypeFromNad(nadOpt: any): 'sriov' | 'macvtap' {
  const t = String(nadOpt?._type || '').toLowerCase();
  if (t === 'sriov') return 'sriov';
  if (t === 'macvtap' || t === 'macvlan') return 'macvtap';
  return 'sriov';
}
