import {
  getPoolSidebarSpec,
  poolSidebarRegistry,
  resolvePoolSidebar,
} from './registry';
import type { Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';

const mkCloud = (over: Record<string, unknown>): Cloud => over as unknown as Cloud;

describe('poolSidebarRegistry：已注册的真实池 spec', () => {
  it('注册全部池且 cloudmap 兜底在最后', () => {
    expect(poolSidebarRegistry.map((s) => s.type)).toEqual([
      'rancher',
      'csm',
      'xinference',
      'maas',
      'huawei',
      'aliyun',
      'cloudmap',
    ]);
    expect(poolSidebarRegistry[poolSidebarRegistry.length - 1].type).toBe('cloudmap');
    poolSidebarRegistry.forEach((s) => expect(s.presentation).toBe('context-sidebar'));
  });

  it('resolvePoolSidebar 按路径命中正确的池', () => {
    expect(resolvePoolSidebar('/admin/clouds/vendor/maas/p1')?.spec.type).toBe('maas');
    expect(resolvePoolSidebar('/admin/clouds/vendor/xinference/p2')?.spec.type).toBe('xinference');
    expect(resolvePoolSidebar('/admin/clouds/vendor/huawei/p6')?.spec.type).toBe('huawei');
    expect(resolvePoolSidebar('/admin/clouds/vendor/aliyun/p7')?.spec.type).toBe('aliyun');
    expect(resolvePoolSidebar('/admin/security/traffic/csm-pools/p3')?.spec.type).toBe('csm');

    const rancher = resolvePoolSidebar('/admin/clouds/p4/clusters/c1');
    expect(rancher?.spec.type).toBe('rancher');
    expect(rancher?.context).toEqual({ poolId: 'p4', clusterId: 'c1' });

    const cm = resolvePoolSidebar('/admin/clouds/p5/resource_hub/overview');
    expect(cm?.spec.type).toBe('cloudmap');
    expect(cm?.context).toEqual({ poolId: 'p5' });
  });

  it('cloudmap spec 不贪婪匹配厂商池 / Rancher 集群路径', () => {
    const spec = getPoolSidebarSpec('cloudmap');
    expect(spec?.resolveContext('/admin/clouds/vendor/maas/p1')).toBeNull();
    expect(spec?.resolveContext('/admin/clouds/p/clusters/c')).toBeNull();
    expect(spec?.resolveContext('/admin/clouds/realPool')).toEqual({ poolId: 'realPool' });
  });

  it('非池路径返回 null', () => {
    expect(resolvePoolSidebar('/admin/cen_compute/overview')).toBeNull();
  });

  it('maas spec：匹配的 cloud 构建出含 tab 项的 center', () => {
    const spec = getPoolSidebarSpec('maas')!;
    const cloud = mkCloud({ id: 'p1', name: '裸金属一', config: { provider: 'maas' } });
    expect(spec.matchCloud(cloud)).toBe(true);
    const center = spec.buildSidebarCenter({
      context: { poolId: 'p1' },
      cloud,
      summaryCloudCount: 1,
    });
    expect(center?.key).toBe(spec.centerKey);
    expect(center?.label).toBe('裸金属一');
    expect((center?.items?.length ?? 0)).toBeGreaterThan(0);
    // 列表已加载但类型不符 → 不渲染
    const wrong = mkCloud({ id: 'p1', name: 'x', config: { provider: 'cloudmap.edge' } });
    expect(spec.buildSidebarCenter({ context: { poolId: 'p1' }, cloud: wrong, summaryCloudCount: 1 })).toBeNull();
    // cloud 未加载 → 不渲染（等待列表）
    expect(spec.buildSidebarCenter({ context: { poolId: 'p1' }, summaryCloudCount: 0 })).toBeNull();
  });

  it('rancher spec：无 cloud 也可渲染（不阻塞集群工作台首屏）', () => {
    const spec = getPoolSidebarSpec('rancher')!;
    const center = spec.buildSidebarCenter({
      context: { poolId: 'p1', clusterId: 'c1' },
      summaryCloudCount: 0,
    });
    expect(center?.key).toBe(spec.centerKey);
    const selected = spec.selectedKey({
      context: { poolId: 'p1', clusterId: 'c1' },
      pathname: '/admin/clouds/p1/clusters/c1',
      search: '?tab=workloads&sub=deployment',
      center: center!,
    });
    expect(selected).toBe(
      '/admin/clouds/p1/clusters/c1?tab=workloads&sub=deployment',
    );
  });
});
