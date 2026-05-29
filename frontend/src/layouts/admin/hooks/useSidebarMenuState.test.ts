import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSidebarMenuState } from './useSidebarMenuState';
import type { AdminSidebarCenter } from '../AdminSidebar';
import type { Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import { CLOUD_POOL_SIDEBAR_CENTER_KEY } from '../cloudmap/cloudPoolSidebar';
import { HW_POOL_SIDEBAR_CENTER_KEY } from '../hw/hwPoolSidebar';
import { ALIYUN_POOL_SIDEBAR_CENTER_KEY } from '../aliyun/aliyunPoolSidebar';
import { MAAS_POOL_SIDEBAR_CENTER_KEY } from '../maas/maasPoolSidebar';
import { XINFERENCE_POOL_SIDEBAR_CENTER_KEY } from '../xinference/xinferencePoolSidebar';
import { CSM_POOL_SIDEBAR_CENTER_KEY } from '../csm/csmPoolSidebar';
import { RANCHER_CLUSTER_SIDEBAR_CENTER_KEY } from '../rancher/rancherClusterSidebar';

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

  it('华为云池：侧栏切换为华为上下文，选中项随 ?tab=（查表分发覆盖 Hw）', async () => {
    const clouds = [
      mkCloud({
        id: 'h1',
        name: '华为一',
        createdAt: '2026-01-01T00:00:00Z',
        config: { provider: 'huaweicloud' },
      }),
    ];
    const view = setup('/admin/clouds/vendor/huawei/h1?tab=ecs', clouds);
    await waitFor(() =>
      expect(view.result.current.activeSidebarKey).toBe(HW_POOL_SIDEBAR_CENTER_KEY),
    );
    expect(view.result.current.sidebarCentersForMenu[0].key).toBe(HW_POOL_SIDEBAR_CENTER_KEY);
    expect(view.result.current.poolSelectedMenuKey).toBe('/admin/clouds/vendor/huawei/h1?tab=ecs');
    expect(view.result.current.platformDropdownSelectedKeys).toEqual([]);
  });

  it('阿里云池：侧栏切换为阿里云上下文（查表分发覆盖 Aliyun）', async () => {
    const clouds = [
      mkCloud({
        id: 'a1',
        name: '阿里一',
        createdAt: '2026-01-01T00:00:00Z',
        config: { provider: 'aliyun' },
      }),
    ];
    const view = setup('/admin/clouds/vendor/aliyun/a1?tab=vpc', clouds);
    await waitFor(() =>
      expect(view.result.current.activeSidebarKey).toBe(ALIYUN_POOL_SIDEBAR_CENTER_KEY),
    );
    expect(view.result.current.poolSelectedMenuKey).toBe('/admin/clouds/vendor/aliyun/a1?tab=vpc');
  });

  it('MAAS 池：侧栏切换为裸金属上下文，选中项随 ?tab=', async () => {
    const view = setup('/admin/clouds/vendor/maas/m1?tab=machines', [
      mkCloud({ id: 'm1', name: '裸金属', createdAt: '2026-01-01T00:00:00Z', config: { provider: 'maas' } }),
    ]);
    await waitFor(() =>
      expect(view.result.current.activeSidebarKey).toBe(MAAS_POOL_SIDEBAR_CENTER_KEY),
    );
    expect(view.result.current.poolSelectedMenuKey).toBe('/admin/clouds/vendor/maas/m1?tab=machines');
  });

  it('Xinference 池：侧栏切换为边缘推理上下文', async () => {
    const view = setup('/admin/clouds/vendor/xinference/x1?tab=running_models', [
      mkCloud({ id: 'x1', name: '推理池', createdAt: '2026-01-01T00:00:00Z', config: { provider: 'xinference' } }),
    ]);
    await waitFor(() =>
      expect(view.result.current.activeSidebarKey).toBe(XINFERENCE_POOL_SIDEBAR_CENTER_KEY),
    );
  });

  it('CSM 池：侧栏切换为 CSM 上下文（基路径在 SDNCC）', async () => {
    const view = setup('/admin/security/traffic/csm-pools/cs1?tab=assets', [
      mkCloud({ id: 'cs1', name: 'CSM', createdAt: '2026-01-01T00:00:00Z', config: { provider: 'cloudmap.csm' } }),
    ]);
    await waitFor(() =>
      expect(view.result.current.activeSidebarKey).toBe(CSM_POOL_SIDEBAR_CENTER_KEY),
    );
  });

  it('Rancher 集群工作台：侧栏切换为集群上下文，选中项随 ?tab=&sub=', async () => {
    const view = setup('/admin/clouds/r1/clusters/c1?tab=workloads&sub=deployment', [
      mkCloud({ id: 'r1', name: 'R', createdAt: '2026-01-01T00:00:00Z', config: { provider: 'rancher' } }),
    ]);
    await waitFor(() =>
      expect(view.result.current.activeSidebarKey).toBe(RANCHER_CLUSTER_SIDEBAR_CENTER_KEY),
    );
    expect(view.result.current.poolSelectedMenuKey).toBe(
      '/admin/clouds/r1/clusters/c1?tab=workloads&sub=deployment',
    );
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
