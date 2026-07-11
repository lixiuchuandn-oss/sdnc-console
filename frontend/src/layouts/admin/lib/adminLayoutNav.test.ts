import {
  firstMenuPathInCenter,
  findMenuOpenKeyChainForPath,
  sidebarForPath,
} from './adminLayoutNav';

describe('adminLayoutNav', () => {
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

  describe('sidebarForPath (SDNC)', () => {
    it('互联/安全面 → SDN', () => {
      expect(sidebarForPath('/zzz/interconnect/x')).toBe('/admin/cen_sdn');
      expect(sidebarForPath('/zzz/sec-mgr-plane/x')).toBe('/admin/cen_sdn');
    });
    it('设置 → 系统设置', () => {
      expect(sidebarForPath('/zzz/settings/x')).toBe('/admin/cen_settings');
      expect(sidebarForPath('/zzz/access/roles')).toBe('/admin/cen_settings');
    });
    it('未知路径回退到 SDN', () => {
      expect(sidebarForPath('/zzz/unknown/x')).toBe('/admin/cen_sdn');
    });
  });
});
