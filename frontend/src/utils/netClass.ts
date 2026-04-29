import { getDomainKindFromCategory, type SecurityDomainKind } from './securityDomainKind';

export type NetClass = SecurityDomainKind;

/**
 * 根据安全域 `category`（`kind:子类` 或旧版纯 kind）得到网络分类。
 */
export function getDomainClass(domain: any): NetClass {
  if (!domain) return 'unbound';
  return getDomainKindFromCategory(domain?.category);
}

export function netClassLabel(cls: NetClass): string {
  if (cls === 'vpc') return 'VPC网络';
  if (cls === 'flat') return 'NAD网络';
  if (cls === 'container') return '容器网络';
  return '未绑定';
}

export function netClassColor(cls: NetClass): string {
  if (cls === 'vpc') return 'blue';
  if (cls === 'flat') return 'green';
  if (cls === 'container') return 'purple';
  return 'default';
}

// 映射
// 1. vpc: VPC网络
// 2. flat: NAD网络（Multus NetworkAttachmentDefinition，向导中与 VPC/直通并列）
// 3. security-domain: 安全域
// 4. unclassified: 未分类
