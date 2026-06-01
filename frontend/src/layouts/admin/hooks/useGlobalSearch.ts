/**
 * 顶栏全局搜索（Ctrl+K）：搜索框开合、关键词过滤、键盘导航（↑/↓/Enter/Esc）。
 * 从 AdminLayout 原样抽出为 hook；行为与原内联实现一致。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { sidebarForPath, type PageSearchEntry } from '../lib/adminLayoutNav';

type UseGlobalSearchArgs = {
  /** 可搜索的页面条目（由调用方按权限/可见性构建） */
  pageSearchEntries: PageSearchEntry[];
  /** 跳转到管理后台内容路径 */
  navigateToAdminContent: (path: string) => void;
  /** 选中结果后同步高亮的平台侧栏 key */
  setActiveSidebarKey: (key: string) => void;
};

export function useGlobalSearch({
  pageSearchEntries,
  navigateToAdminContent,
  setActiveSidebarKey,
}: UseGlobalSearchArgs) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchActiveIndexRef = useRef(0);

  const filteredSearchList = useMemo(() => {
    const kw = String(searchText || '').toLowerCase().trim();
    const base = pageSearchEntries;
    if (!kw) return base.slice(0, 12);
    return base.filter((e) => e.title.toLowerCase().includes(kw));
  }, [pageSearchEntries, searchText]);

  useEffect(() => {
    searchActiveIndexRef.current = searchActiveIndex;
  }, [searchActiveIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setSearchText('');
        setSearchActiveIndex(0);
      }
      if (searchOpen) {
        if (e.key === 'Escape') {
          setSearchOpen(false);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSearchActiveIndex((i) => {
            const newIndex = Math.min(i + 1, Math.max(filteredSearchList.length - 1, 0));
            searchActiveIndexRef.current = newIndex;
            return newIndex;
          });
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSearchActiveIndex((i) => {
            const newIndex = Math.max(i - 1, 0);
            searchActiveIndexRef.current = newIndex;
            return newIndex;
          });
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const sel = filteredSearchList[searchActiveIndexRef.current];
          if (sel) {
            const path = sel.path;
            const pure = String(path || '').split('?')[0];
            navigateToAdminContent(path);
            if (pure !== '/console') {
              setActiveSidebarKey(sidebarForPath(path));
            }
            setSearchOpen(false);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, filteredSearchList, navigateToAdminContent]);

  return {
    searchOpen,
    setSearchOpen,
    searchText,
    setSearchText,
    searchActiveIndex,
    setSearchActiveIndex,
    filteredSearchList,
  };
}
