/**
 * 扁平 / 公共 Kube-OVN Underlay 子网（非 VPC 业务网段）的共享模块：
 * - constants：注解键、finalizer、Kube-OVN 内置/保留名（与后端 kubeOvnNetworkScope 对齐）
 * - UnderlaySubnetFormFields：创建/编辑表单字段
 * - CreateFlatSubnetModal / CreatePublicSubnetModal：创建弹窗
 * - vlanUtils：如按 VLAN ID 选默认 CR 名
 *
 * 使用方：UnderlaySubnetsSection（列表页）、vlan-plan-drawer（物理网络详情抽屉）等。
 */
export {
  SUBNET_FINALIZER,
  SUBNET_TYPE_ANNOTATION_KEY,
  SUBNET_TYPE_FLAT_UNDERLAY_ANNOTATION_KEY,
  SUBNET_TYPE_FLAT_OVERLAY_ANNOTATION_KEY,
  buildFlatUnderlayOverlayAnnotations,
  resolveTowerUnderlaySubnetCategory,
  TOWER_ALIAS_ANNOTATION,
  OVN_INTERNAL_ROUTE_CIDR_ANNOTATION,
  TOWER_SUBNET_DESCRIPTION_ANNOTATION,
  KUBE_OVN_PUBLIC_VPC,
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PROVIDER_VPC,
  KUBE_OVN_BUILTIN_VPC_NAMES,
  KUBE_OVN_BUILTIN_SUBNET_CR_NAMES,
  KUBE_OVN_RESERVED_VLAN_CR_NAMES,
  isBuiltInKubeOvnVpc,
  isFlatKubeOvnSubnetVpc,
} from './constants';
export type { TowerUnderlaySubnetCategory } from './constants';

export { default as CreateFlatSubnetModal } from './CreateFlatSubnetModal';
export type { CreateFlatSubnetModalProps } from './CreateFlatSubnetModal';

export { default as CreatePublicSubnetModal } from './CreatePublicSubnetModal';
export type { CreatePublicSubnetModalProps } from './CreatePublicSubnetModal';

export { defaultVlanCrNameByMinVlanId } from './vlanUtils';

export {
  default as UnderlaySubnetFormFields,
  vlanRecordLabelForSelect,
  vlanRecordSearchBlob,
  providerDisplayName,
} from './UnderlaySubnetFormFields';
export type { UnderlaySubnetFormFieldsProps } from './UnderlaySubnetFormFields';
