import {
  findPoolSidebarSpecByType,
  resolvePoolSidebarForPath,
} from './registry';
import type { PoolSidebarSpec } from './types';

/** 合成最小 spec：仅填充查询所需字段，其余以类型断言占位。 */
function mkSpec(
  type: string,
  resolve: (pathname: string) => { poolId: string; clusterId?: string } | null,
): PoolSidebarSpec {
  return {
    type,
    presentation: 'context-sidebar',
    subNav: 'tab',
    tier: 'simple',
    centerKey: `/admin/${type}_context`,
    label: type,
    navKeys: [],
    resolveContext: resolve,
    matchCloud: () => true,
    buildSidebarCenter: () => null,
    selectedKey: () => undefined,
  };
}

describe('poolSidebar registry 查询 API', () => {
  const rancher = mkSpec('rancher', (p) => {
    const m = /^\/admin\/clouds\/([^/]+)\/clusters\/([^/]+)$/.exec(p);
    return m ? { poolId: m[1], clusterId: m[2] } : null;
  });
  const maas = mkSpec('maas', (p) =>
    p.startsWith('/admin/clouds/vendor/maas/')
      ? { poolId: p.split('/').filter(Boolean)[4] }
      : null,
  );
  // cloudmap 贪婪匹配：任何 /admin/clouds/:id；置于注册表最后做兜底
  const cloudmap = mkSpec('cloudmap', (p) => {
    const m = /^\/admin\/clouds\/([^/]+)/.exec(p);
    return m ? { poolId: m[1] } : null;
  });
  const registry: PoolSidebarSpec[] = [rancher, maas, cloudmap];

  it('findPoolSidebarSpecByType 命中 / 未命中', () => {
    expect(findPoolSidebarSpecByType(registry, 'maas')).toBe(maas);
    expect(findPoolSidebarSpecByType(registry, 'unknown')).toBeUndefined();
  });

  it('resolvePoolSidebarForPath 取首个命中（具体优先于贪婪兜底）', () => {
    const r = resolvePoolSidebarForPath(registry, '/admin/clouds/p1/clusters/c1');
    expect(r?.spec.type).toBe('rancher');
    expect(r?.context).toEqual({ poolId: 'p1', clusterId: 'c1' });

    const m = resolvePoolSidebarForPath(registry, '/admin/clouds/vendor/maas/p2');
    expect(m?.spec.type).toBe('maas');
    expect(m?.context).toEqual({ poolId: 'p2' });

    const c = resolvePoolSidebarForPath(registry, '/admin/clouds/p3/resource_hub/overview');
    expect(c?.spec.type).toBe('cloudmap');
    expect(c?.context).toEqual({ poolId: 'p3' });
  });

  it('resolvePoolSidebarForPath 非池路径返回 null', () => {
    expect(resolvePoolSidebarForPath(registry, '/admin/cen_compute/overview')).toBeNull();
    expect(resolvePoolSidebarForPath([], '/admin/clouds/x')).toBeNull();
  });
});
