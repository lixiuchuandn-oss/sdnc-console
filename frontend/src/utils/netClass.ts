export type NetClass = 'vpc' | 'flat' | 'unbound';

/**
 * 根据安全域类型获取网络分类
 * @param domain 安全域对象
 * @returns 'private' | 'public' | 'hybrid' | 'unknown'
 */
export function getDomainClass(domain: any): NetClass {
  if (!domain) return 'unbound';
  const category = String(domain?.category || '').trim();
  if (category === 'vpc') return 'vpc';
  if (category === 'flat') return 'flat';
  return 'unbound';
}

export function netClassLabel(cls: NetClass): string {
  if (cls === 'vpc') return 'VPC网络';
  if (cls === 'flat') return '扁平网络';
  return '未绑定';
}

export function netClassColor(cls: NetClass): string {
  if (cls === 'vpc') return 'blue';
  if (cls === 'flat') return 'green';
  return 'default';
}

// 映射
// 1. vpc: VPC网络
// 2. flat: 扁平网络
// 3. security-domain: 安全域
// 4. unclassified: 未分类
