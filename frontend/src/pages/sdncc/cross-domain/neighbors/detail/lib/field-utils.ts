import type { SecurityDomainOption } from '../types';

export function pick(obj: any, keys: string[]): any {
  const sources = [obj, obj?.group, obj?.service, obj?.securityService, obj?.elementGroup, obj?.vmGroup];
  for (const src of sources) {
    for (const k of keys) {
      const v = src?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
  }
  return undefined;
}

export function normalizeInstanceList(val: any): any[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const items = val?.items || val?.list || val?.data;
  if (Array.isArray(items)) return items;
  return [];
}

export function getServiceInstances(
  r: any,
  allDomains: SecurityDomainOption[],
  csmElementGroupCache: Record<string, Record<string, any>>,
): any[] {
  const direct = normalizeInstanceList(
    pick(r, [
      'elements',
      'elementList',
      'vmList',
      'vm_list',
      'vms',
      'vm_id_list',
      'vmIds',
      'vmIdList',
      'neList',
      'ne_id_list',
      'neIds',
      'neIdList',
      'instances',
      'instanceList',
      'members',
    ]),
  );
  if (direct.length > 0) return direct;

  const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
  const cloudId = dom?.cloudId ? String(dom.cloudId).trim() : '';
  if (!cloudId) return [];

  const gidRaw = pick(r, ['id', 'vm_group_id', 'vmGroupId', 'group_id', 'groupId', 'vm_group_uuid', 'vmGroupUuid']);
  const gid = gidRaw !== undefined && gidRaw !== null ? String(gidRaw).trim() : '';
  const g = gid ? csmElementGroupCache[cloudId]?.[gid] : undefined;
  if (!g) return [];

  return normalizeInstanceList(
    pick(g, [
      'elements',
      'elementList',
      'vmList',
      'vm_list',
      'vms',
      'vm_id_list',
      'vmIds',
      'vmIdList',
      'neList',
      'ne_id_list',
      'neIds',
      'neIdList',
      'instances',
      'instanceList',
      'members',
      'items',
    ]),
  );
}

export function calcServiceNeCount(
  r: any,
  allDomains: SecurityDomainOption[],
  csmElementGroupCache: Record<string, Record<string, any>>,
): number | string {
  const v = pick(r, [
    'neCount',
    'count',
    'Count',
    'elementCount',
    'elementsCount',
    'elements_count',
    'vm_count',
    'vmCount',
    'ne_count',
  ]);
  if (v === 0 || v) return Number(v);
  const list = getServiceInstances(r, allDomains, csmElementGroupCache);
  if (list.length > 0) return list.length;
  return '-';
}
