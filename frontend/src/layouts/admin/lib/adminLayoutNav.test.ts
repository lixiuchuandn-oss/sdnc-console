import {
  byCloudCreatedAtAsc,
  pickDefaultPoolId,
  resolveDefaultPool,
  firstMenuPathInCenter,
  findMenuOpenKeyChainForPath,
  poolOverviewPath,
  sidebarForPath,
} from './adminLayoutNav';
import type { Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';

const mkCloud = (over: Record<string, unknown>): Cloud => over as unknown as Cloud;

describe('adminLayoutNav', () => {
  describe('byCloudCreatedAtAsc', () => {
    it('按 createdAt 升序', () => {
      const a = mkCloud({ id: 'a', createdAt: '2026-01-01T00:00:00Z' });
      const b = mkCloud({ id: 'b', createdAt: '2026-02-01T00:00:00Z' });
      expect(byCloudCreatedAtAsc(a, b)).toBeLessThan(0);
      expect(byCloudCreatedAtAsc(b, a)).toBeGreaterThan(0);
    });
  });

  describe('pickDefaultPoolId', () => {
    it('空列表返回 undefined', () => {
      expect(pickDefaultPoolId([])).toBeUndefined();
    });
    it('优先取 config.isDefault 标记的池', () => {
      const clouds = [
        mkCloud({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
        mkCloud({ id: 'flagged', createdAt: '2026-03-01T00:00:00Z', config: { isDefault: true } }),
      ];
      expect(pickDefaultPoolId(clouds)).toBe('flagged');
    });
    it('无标记时取最早创建的池', () => {
      const clouds = [
        mkCloud({ id: 'later', createdAt: '2026-05-01T00:00:00Z' }),
        mkCloud({ id: 'earliest', createdAt: '2026-01-01T00:00:00Z' }),
      ];
      expect(pickDefaultPoolId(clouds)).toBe('earliest');
    });
  });

  describe('resolveDefaultPool', () => {
    it('返回默认池对象', () => {
      const clouds = [
        mkCloud({ id: 'x', createdAt: '2026-02-01T00:00:00Z' }),
        mkCloud({ id: 'y', createdAt: '2026-01-01T00:00:00Z' }),
      ];
      expect(resolveDefaultPool(clouds)?.id).toBe('y');
    });
  });

  describe('firstMenuPathInCenter', () => {
    it('取第一项子菜单首个以 / 开头的 key', () => {
      const center = { items: [{ key: '__grp__', children: [{ key: '/admin/a' }, { key: '/admin/b' }] }] };
      expect(firstMenuPathInCenter(center)).toBe('/admin/a');
    });
    it('第一项无子菜单时取其自身 key', () => {
      expect(firstMenuPathInCenter({ items: [{ key: '/admin/solo' }] })).toBe('/admin/solo');
    });
    it('非 / 开头返回 null', () => {
      expect(firstMenuPathInCenter({ items: [{ key: '__grp__' }] })).toBeNull();
      expect(firstMenuPathInCenter({ items: [] })).toBeNull();
    });
  });

  describe('findMenuOpenKeyChainForPath', () => {
    const items = [
      {
        key: '__sub__root',
        children: [
          { key: '/admin/list' },
          { key: '__sub__inner', children: [{ key: '/admin/deep' }] },
        ],
      },
    ];
    it('命中浅层返回其祖先链', () => {
      expect(findMenuOpenKeyChainForPath(items, '/admin/list')).toEqual(['__sub__root']);
    });
    it('命中深层返回完整祖先链', () => {
      expect(findMenuOpenKeyChainForPath(items, '/admin/deep')).toEqual(['__sub__root', '__sub__inner']);
    });
    it('未命中返回 null', () => {
      expect(findMenuOpenKeyChainForPath(items, '/admin/none')).toBeNull();
      expect(findMenuOpenKeyChainForPath(undefined, '/x')).toBeNull();
    });
  });

  describe('poolOverviewPath', () => {
    it('池不在列表时回退到资源总览路径', () => {
      expect(poolOverviewPath('p1', [])).toBe('/admin/clouds/p1/resource_hub/overview');
    });
  });

  describe('sidebarForPath (启发式回退分支)', () => {
    it('互联/安全面/流量 → SDN', () => {
      expect(sidebarForPath('/zzz/interconnect/x')).toBe('/admin/cen_sdn');
      expect(sidebarForPath('/zzz/sec-mgr-plane/x')).toBe('/admin/cen_sdn');
    });
    it('告警/SOC → 安全运营', () => {
      expect(sidebarForPath('/zzz/aisoc/x')).toBe('/admin/cen_secops');
    });
    it('设置 → 系统设置', () => {
      expect(sidebarForPath('/zzz/settings/x')).toBe('/admin/cen_settings');
    });
    it('未知路径回退到多云计算', () => {
      expect(sidebarForPath('/zzz/unknown/x')).toBe('/admin/cen_compute');
    });
  });
});
