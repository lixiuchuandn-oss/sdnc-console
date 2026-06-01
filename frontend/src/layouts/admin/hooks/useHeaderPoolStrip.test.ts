import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHeaderPoolStrip } from './useHeaderPoolStrip';

const mockApiRequest = jest.fn();
jest.mock('../../../services/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

type CloudLike = { id: string; createdAt?: string; config?: Record<string, unknown> };

function wrapperAt(initialPath: string) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(MemoryRouter, { initialEntries: [initialPath] }, children);
}

function setup(user: { id: string } | null, initialPath = '/admin/cen_compute', clouds: CloudLike[] = []) {
  mockApiRequest.mockReset();
  mockApiRequest.mockResolvedValue({ data: clouds });
  return renderHook(() => useHeaderPoolStrip(user), { wrapper: wrapperAt(initialPath) });
}

describe('useHeaderPoolStrip', () => {
  it('无用户：不拉取，列表为空且未 hydrate', async () => {
    const view = setup(null);
    await waitFor(() => expect(view.result.current.summaryListHydrated).toBe(false));
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(view.result.current.summaryClouds).toEqual([]);
    expect(view.result.current.headerSelectedPoolId).toBeUndefined();
  });

  it('登入后用 skipCache 拉取列表并 hydrate', async () => {
    const view = setup({ id: 'u1' }, '/admin/cen_compute', [{ id: 'a', createdAt: '2026-01-01T00:00:00Z' }]);
    await waitFor(() => expect(view.result.current.summaryListHydrated).toBe(true));
    expect(mockApiRequest).toHaveBeenCalledWith('/api/clouds', { skipCache: true });
    expect(view.result.current.summaryClouds.map((c) => c.id)).toEqual(['a']);
  });

  it('列表变化回填默认池：优先 config.isDefault', async () => {
    const view = setup({ id: 'u1' }, '/admin/cen_compute', [
      { id: 'old', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'flag', createdAt: '2026-03-01T00:00:00Z', config: { isDefault: true } },
    ]);
    await waitFor(() => expect(view.result.current.headerSelectedPoolId).toBe('flag'));
  });

  it('无标记时回填最早创建的池', async () => {
    const view = setup({ id: 'u1' }, '/admin/cen_compute', [
      { id: 'later', createdAt: '2026-05-01T00:00:00Z' },
      { id: 'earliest', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    await waitFor(() => expect(view.result.current.headerSelectedPoolId).toBe('earliest'));
  });

  it('从 URL 池详情同步顶栏可用区到该池', async () => {
    const view = setup({ id: 'u1' }, '/admin/clouds/p2/resource_hub/overview', [
      { id: 'p1', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'p2', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    await waitFor(() => expect(view.result.current.headerSelectedPoolId).toBe('p2'));
  });

  it('setHeaderSelectedPoolId 暴露给调用方手动切池', async () => {
    const view = setup({ id: 'u1' }, '/admin/cen_compute', [
      { id: 'p1', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'p2', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    await waitFor(() => expect(view.result.current.headerSelectedPoolId).toBe('p1'));
    act(() => view.result.current.setHeaderSelectedPoolId('p2'));
    expect(view.result.current.headerSelectedPoolId).toBe('p2');
  });
});
