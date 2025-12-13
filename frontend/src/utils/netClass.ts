export type NetClass = 'vpc' | 'flat' | 'unbound';

// 从信息域对象计算分类
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