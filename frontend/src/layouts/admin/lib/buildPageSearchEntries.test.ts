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

  it('二级 children 展开为独立条目', () => {
    const entries = buildPageSearchEntries([
      center('cen', '多云', [
        {
          key: 'grp',
          label: '网络',
          icon: null,
          children: [{ key: '/admin/vpc', label: 'VPC', icon: null }],
        },
      ]),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('/admin/vpc');
    expect(entries[0].title).toBe('VPC 网络 多云');
    expect(entries[0].group).toBe('网络');
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
