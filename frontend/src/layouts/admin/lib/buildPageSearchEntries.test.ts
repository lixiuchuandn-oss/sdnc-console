import type { AdminSidebarCenter } from '../AdminSidebar';
import { buildPageSearchEntries } from './buildPageSearchEntries';

function center(
  key: string,
  label: string,
  items: AdminSidebarCenter['items'],
): AdminSidebarCenter {
  return { key, label, items };
}

describe('buildPageSearchEntries', () => {
  it('扁平菜单项生成搜索条目', () => {
    const entries = buildPageSearchEntries([
      center('cen', '多云', [
        { key: '/admin/pools', label: '资源池', icon: null },
      ]),
    ]);

    expect(entries).toEqual([
      {
        path: '/admin/pools',
        title: '资源池 多云',
        icon: null,
        label: '资源池',
        group: '多云',
      },
    ]);
  });

  it('SDNCC 等平台扁平菜单：仅顶层 path 条目', () => {
    const entries = buildPageSearchEntries([
      center('/admin/cen_sdn', 'IBR 控制台', [
        { key: '/admin/interconnect/vr', label: 'IBR实例', icon: null },
        { key: '/admin/interconnect/srv6', label: 'SRv6隧道', icon: null },
      ]),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      path: '/admin/interconnect/vr',
      label: 'IBR实例',
      group: 'IBR 控制台',
      title: 'IBR实例 IBR 控制台',
    });
  });

  it('SETTINGS 平台走 items 直推（无 children 分组）', () => {
    const entries = buildPageSearchEntries([
      center('/admin/cen_settings', '系统设置', [
        { key: '/admin/settings/users', label: '用户', icon: null },
      ]),
    ]);

    expect(entries[0]).toMatchObject({
      path: '/admin/settings/users',
      label: '用户',
      group: '系统设置',
    });
  });

  it('忽略非 / 开头 path', () => {
    const entries = buildPageSearchEntries([
      center('cen', '多云', [{ key: 'invalid', label: '无效', icon: null }]),
    ]);
    expect(entries).toHaveLength(0);
  });
});
