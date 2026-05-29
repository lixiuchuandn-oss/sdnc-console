import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSidebarMenuState } from './useSidebarMenuState';
import type { AdminSidebarCenter } from '../AdminSidebar';
import type { Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import { CLOUD_POOL_SIDEBAR_CENTER_KEY } from '../cloudmap/cloudPoolSidebar';

jest.mock('../../../services/api', () => ({
  apiRequest: jest.fn().mockResolvedValue({}),
}));

const mkCloud = (over: Record<string, unknown>): Cloud => over as unknown as Cloud;

const visibleCenters: AdminSidebarCenter[] = [
  {
    key: '/admin/cen_compute',
    label: '多云管理',
    items: [{ key: '/admin/cen_compute/overview', label: '资源总览' }],
  },
];

function wrapperAt(initialPath: string) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(MemoryRouter, { initialEntries: [initialPath] }, children);
}

function setup(initialPath: string, summaryClouds: Cloud[] = []) {
  return renderHook(
    () =>
      useSidebarMenuState({
        visibleCenters,
        summaryClouds,
        userPermissions: ['*'],
        hasFeature: () => true,
      }),
    { wrapper: wrapperAt(initialPath) },
  );
}

describe('useSidebarMenuState', () => {
  it('非池路径：直接展示平台侧栏，平台高亮 key 非空', async () => {
    const view = setup('/admin/cen_compute/overview');
    await waitFor(() => expect(view.result.current.activeSidebarKey.startsWith('/admin/cen_')).toBe(true));
    expect(view.result.current.sidebarCentersForMenu).toBe(visibleCenters);
    expect(view.result.current.platformDropdownSelectedKeys).toEqual([
      view.result.current.activeSidebarKey,
    ]);
    expect(view.result.current.poolSelectedMenuKey).toBeUndefined();
  });

  it('Cloudmap 池详情：侧栏切换为池内导航，平台下拉高亮清空', async () => {
    const clouds = [
      mkCloud({
        id: 'p1',
        name: '池一',
        createdAt: '2026-01-01T00:00:00Z',
        config: { provider: 'cloudmap.edge' },
      }),
    ];
    const view = setup('/admin/clouds/p1/resource_hub/overview', clouds);
    await waitFor(() =>
      expect(view.result.current.activeSidebarKey).toBe(CLOUD_POOL_SIDEBAR_CENTER_KEY),
    );
    expect(view.result.current.sidebarCentersForMenu).toHaveLength(1);
    expect(view.result.current.sidebarCentersForMenu[0].key).toBe(CLOUD_POOL_SIDEBAR_CENTER_KEY);
    expect(view.result.current.platformDropdownSelectedKeys).toEqual([]);
  });

  it('collapsed 默认 false，setCollapsed 可切换', () => {
    const view = setup('/admin/cen_compute/overview');
    expect(view.result.current.collapsed).toBe(false);
    act(() => view.result.current.setCollapsed(true));
    expect(view.result.current.collapsed).toBe(true);
  });

  it('setActiveSidebarKey / setOpenKeys 暴露给布局与全局搜索', () => {
    const view = setup('/admin/cen_compute/overview');
    act(() => view.result.current.setOpenKeys(['CNMC_存储']));
    expect(view.result.current.openKeys).toEqual(['CNMC_存储']);
    act(() => view.result.current.setActiveSidebarKey('/admin/cen_settings'));
    expect(view.result.current.activeSidebarKey).toBe('/admin/cen_settings');
  });
});
