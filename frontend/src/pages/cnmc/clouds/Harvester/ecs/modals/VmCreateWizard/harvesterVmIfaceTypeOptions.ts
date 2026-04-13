/**
 * Harvester 创建/变配向导共用的 KubeVirt 接口绑定方式选项。
 * 描述统一为：「字段名（中文说明）」，与 VmWizardUtils.buildHarvesterVmPayload 一致。
 */

export const IFACE_TYPE_OPTION_BY_VALUE: Record<string, { label: string; value: string }> = {
  bridge: { label: 'bridge（桥接）', value: 'bridge' },
  masquerade: { label: 'masquerade（NAT）', value: 'masquerade' },
  managedtap: { label: 'managedtap（ManagedTap 绑定）', value: 'managedtap' },
  sriov: { label: 'sriov（SR-IOV VF 直通）', value: 'sriov' },
  macvtap: { label: 'macvtap（二层 MAC 转发）', value: 'macvtap' },
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
