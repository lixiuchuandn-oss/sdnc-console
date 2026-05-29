import { renderHook, act } from '@testing-library/react';
import { usePoolWizard } from './usePoolWizard';
import type { Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';

const mkCloud = (over: Record<string, unknown>): Cloud => over as unknown as Cloud;

function setup(over: Partial<Parameters<typeof usePoolWizard>[0]> = {}) {
  const loadSummaryClouds = jest.fn();
  const args = {
    user: { id: 'u1' },
    summaryClouds: [] as Cloud[],
    summaryListHydrated: true,
    summaryLoading: false,
    canWritePools: true,
    loadSummaryClouds,
    ...over,
  };
  const view = renderHook((p: Parameters<typeof usePoolWizard>[0]) => usePoolWizard(p), {
    initialProps: args,
  });
  return { view, loadSummaryClouds, args };
}

describe('usePoolWizard', () => {
  it('初始关闭、无编辑对象、非强制', () => {
    const { view } = setup();
    expect(view.result.current.poolWizardOpen).toBe(false);
    expect(view.result.current.poolWizardEditing).toBeNull();
    expect(view.result.current.poolWizardForceRequired).toBe(false);
  });

  it('无池：openDefaultPoolWizardAction 进入「添加」（editing=null）并打开', () => {
    const { view } = setup({ summaryClouds: [] });
    act(() => view.result.current.openDefaultPoolWizardAction());
    expect(view.result.current.poolWizardOpen).toBe(true);
    expect(view.result.current.poolWizardEditing).toBeNull();
    expect(view.result.current.poolWizardForceRequired).toBe(false);
  });

  it('有池：openDefaultPoolWizardAction 进入「编辑」默认池（最早创建）', () => {
    const clouds = [
      mkCloud({ id: 'later', createdAt: '2026-05-01T00:00:00Z' }),
      mkCloud({ id: 'earliest', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    const { view } = setup({ summaryClouds: clouds });
    act(() => view.result.current.openDefaultPoolWizardAction());
    expect(view.result.current.poolWizardOpen).toBe(true);
    expect(view.result.current.poolWizardEditing?.id).toBe('earliest');
  });

  it('取消：关闭并清空状态', () => {
    const { view } = setup({ summaryClouds: [] });
    act(() => view.result.current.openDefaultPoolWizardAction());
    act(() => view.result.current.handlePoolWizardCancel());
    expect(view.result.current.poolWizardOpen).toBe(false);
    expect(view.result.current.poolWizardEditing).toBeNull();
    expect(view.result.current.poolWizardForceRequired).toBe(false);
  });

  it('成功：关闭并触发列表重载', () => {
    const { view, loadSummaryClouds } = setup({ summaryClouds: [] });
    act(() => view.result.current.openDefaultPoolWizardAction());
    act(() => view.result.current.handlePoolWizardSuccess());
    expect(view.result.current.poolWizardOpen).toBe(false);
    expect(loadSummaryClouds).toHaveBeenCalledTimes(1);
  });

  it('编辑默认池时排除 CSM 池', () => {
    const clouds = [
      mkCloud({ id: 'csm', createdAt: '2026-01-01T00:00:00Z', config: { provider: 'cloudmap.csm' } }),
      mkCloud({ id: 'cnmc', createdAt: '2026-02-01T00:00:00Z' }),
    ];
    const { view } = setup({ summaryClouds: clouds });
    act(() => view.result.current.openDefaultPoolWizardAction());
    expect(view.result.current.poolWizardEditing?.id).toBe('cnmc');
  });
});
