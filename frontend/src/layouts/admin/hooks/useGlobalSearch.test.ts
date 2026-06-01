import { act, renderHook } from '@testing-library/react';
import { useGlobalSearch } from './useGlobalSearch';
import type { PageSearchEntry } from '../lib/adminLayoutNav';

const entries: PageSearchEntry[] = [
  { path: '/admin/a', title: '计算实例', icon: null, label: '计算实例', group: '多云' },
  { path: '/admin/b', title: '网络拓扑', icon: null, label: '网络拓扑', group: '多云' },
  { path: '/console', title: '控制台', icon: null, label: '控制台', group: '工具' },
];

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ...opts }));
  });
}

function setup(navigate = jest.fn(), setActive = jest.fn()) {
  const view = renderHook(() =>
    useGlobalSearch({
      pageSearchEntries: entries,
      navigateToAdminContent: navigate,
      setActiveSidebarKey: setActive,
    }),
  );
  return { view, navigate, setActive };
}

describe('useGlobalSearch', () => {
  it('Ctrl+K 打开搜索并重置', () => {
    const { view } = setup();
    expect(view.result.current.searchOpen).toBe(false);
    press('k', { ctrlKey: true });
    expect(view.result.current.searchOpen).toBe(true);
    expect(view.result.current.searchText).toBe('');
    expect(view.result.current.searchActiveIndex).toBe(0);
  });

  it('Esc 关闭搜索', () => {
    const { view } = setup();
    press('k', { ctrlKey: true });
    expect(view.result.current.searchOpen).toBe(true);
    press('Escape');
    expect(view.result.current.searchOpen).toBe(false);
  });

  it('ArrowDown / ArrowUp 在边界内移动高亮', () => {
    const { view } = setup();
    press('k', { ctrlKey: true });
    press('ArrowDown');
    expect(view.result.current.searchActiveIndex).toBe(1);
    press('ArrowDown');
    press('ArrowDown'); // 越界被钳制在最后一项（共 3 条，max index 2）
    expect(view.result.current.searchActiveIndex).toBe(2);
    press('ArrowUp');
    expect(view.result.current.searchActiveIndex).toBe(1);
  });

  it('Enter 跳转到选中项并关闭；非 /console 同步侧栏 key', () => {
    const { view, navigate, setActive } = setup();
    press('k', { ctrlKey: true });
    press('Enter'); // 选中 filtered[0] = /admin/a
    expect(navigate).toHaveBeenCalledWith('/admin/a');
    expect(setActive).toHaveBeenCalled();
    expect(view.result.current.searchOpen).toBe(false);
  });

  it('filteredSearchList 关键词过滤（按 title）', () => {
    const { view } = setup();
    expect(view.result.current.filteredSearchList).toHaveLength(3);
    act(() => view.result.current.setSearchText('网络'));
    expect(view.result.current.filteredSearchList.map((e) => e.path)).toEqual(['/admin/b']);
  });
});
