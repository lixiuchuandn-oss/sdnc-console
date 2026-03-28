/**
 * 扁平 / 公共 Kube-OVN Underlay 子网（非 VPC 业务网段）的共享模块：
 * - constants：注解键、finalizer
 * - UnderlaySubnetFormFields：创建/编辑表单字段
 * - CreateFlatSubnetModal / CreatePublicSubnetModal：创建弹窗
 * - vlanUtils：如按 VLAN ID 选默认 CR 名
 *
 * 使用方：UnderlaySubnetsSection（列表页）、vlan-plan-drawer（物理网络详情抽屉）等。
 */
export {
  SUBNET_FINALIZER,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  KUBE_OVN_PUBLIC_VPC,
  KUBE_OVN_FLAT_VPC,
  isBuiltInKubeOvnVpc,
  isFlatKubeOvnSubnetVpc,
} from './constants';

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
