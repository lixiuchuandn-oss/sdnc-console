import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ColumnsType, ColumnType, ColumnGroupType } from 'antd/es/table';

/** v2：带列全集快照，区分「用户隐藏的列」与「后来才出现的列」 */
type TableColumnSettingsV2 = {
  v: 2;
  /** 勾选的列 key（含 frozen，与运行时 checkedColumnKeys 一致） */
  visible: string[];
  /** 写入时的可选列全集（key 列表），用于后续计算 brand-new 列 */
  snap: string[];
};

function isSettingsV2(x: unknown): x is TableColumnSettingsV2 {
  if (!x || typeof x !== 'object') return false;
  const o = x as TableColumnSettingsV2;
  return o.v === 2 && Array.isArray(o.visible) && Array.isArray(o.snap);
}

function isColumnGroup<T extends object>(col: ColumnType<T> | ColumnGroupType<T>): col is ColumnGroupType<T> {
  return (
    'children' in col &&
    Array.isArray((col as ColumnGroupType<T>).children) &&
    (col as ColumnGroupType<T>).children!.length > 0
  );
}

/** 全站版式 A：带 fixed 的列必须在「列展示」中不可取消、始终显示 */
function collectFixedColumnKeys<T extends object>(
  cols: ColumnsType<T>,
  getColumnKey: (col: ColumnType<T> | ColumnGroupType<T>) => string
): string[] {
  const out: string[] = [];
  for (const col of cols) {
    if (isColumnGroup(col)) {
      for (const child of col.children) {
        const c = child as ColumnType<T>;
        if (c.fixed) {
          const k = getColumnKey(c);
          if (k) out.push(k);
        }
      }
    } else {
      const c = col as ColumnType<T>;
      if (c.fixed) {
        const k = getColumnKey(c);
        if (k) out.push(k);
      }
    }
  }
  return out;
}

/**
 * 表格列设置 Hook
 * 用于管理表格列的显示/隐藏，并支持本地持久化
 * 
 * 这个 hook 替代了原来的 TableColumnSettings 组件，避免了死锁问题
 * 
 * 带 `fixed` 的列会锁定为常显，且不会在列展示中可取消（与全站 .std-table 版式 A 一致）。
 * 
 * @param allColumns - 完整的列定义数组
 * @param settingsKey - localStorage 的 key，用于持久化设置
 * @param defaultHiddenColumns - 默认隐藏的列 key 数组
 * @returns 返回过滤后的列数组、列设置 UI 内容、以及相关状态和方法
 */
export function useTableColumnSettings<T extends object>(
  allColumns: ColumnsType<T>,
  settingsKey: string,
  defaultHiddenColumns: string[] = []
) {
  const [checkedColumnKeys, setCheckedColumnKeys] = useState<string[]>([]);
  const [columnSettingsInitialized, setColumnSettingsInitialized] = useState(false);
  /** 上一次已处理过的可选列 key 集合（用于仅在「真正新增列」时默认勾选） */
  const prevAllKeysRef = useRef<string[]>([]);
  /**
   * 用户意图隐藏的列（含曾出现在 snap 中、当前尚未进入 allColumns 的 key）。
   * 解决：可选列先后随数据变多时，不能把「早已隐藏的列」当成 brand-new 自动打开。
   */
  const hiddenIntentRef = useRef<Set<string>>(new Set());

  // 获取列的唯一标识 (key > dataIndex > title)
  const getColumnKey = useCallback((col: ColumnType<T> | ColumnGroupType<T>): string => {
    if (col.key) return String(col.key);
    // @ts-ignore - dataIndex exists on ColumnType but TS might complain for Group
    if (col.dataIndex) return Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : String(col.dataIndex);
    if (typeof col.title === 'string') return col.title;
    return '';
  }, []);

  const lockedColumnKeys = useMemo(
    () => collectFixedColumnKeys(allColumns, getColumnKey),
    [allColumns, getColumnKey]
  );

  const mergeWithLocked = useCallback(
    (keys: string[]) => Array.from(new Set([...keys, ...lockedColumnKeys])),
    [lockedColumnKeys]
  );

  const persistV2 = useCallback(
    (visibleKeys: string[], allKeys: string[]) => {
      try {
        const payload: TableColumnSettingsV2 = { v: 2, visible: visibleKeys, snap: allKeys };
        localStorage.setItem(`table_cols_${settingsKey}`, JSON.stringify(payload));
        hiddenIntentRef.current = new Set(allKeys.filter((k) => !visibleKeys.includes(k)));
        window.dispatchEvent(
          new CustomEvent('table-settings-sync', {
            detail: { key: `table_cols_${settingsKey}`, value: visibleKeys },
          }),
        );
      } catch (e) {
        console.warn('Failed to persist column settings', e);
      }
    },
    [settingsKey]
  );

  const rebuildHiddenIntentFromFile = useCallback((snapKeys: string[], visibleKeys: string[]) => {
    hiddenIntentRef.current = new Set(snapKeys.filter((k) => typeof k === 'string' && !visibleKeys.includes(k)));
  }, []);

  // 初始化列设置（只执行一次）
  useEffect(() => {
    if (columnSettingsInitialized || allColumns.length === 0) return;

    const allKeys = allColumns
      .map((col) => {
        const key = getColumnKey(col);
        return key;
      })
      .filter(Boolean);

    // 从 localStorage 读取保存的设置
    try {
      const saved = localStorage.getItem(`table_cols_${settingsKey}`);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isSettingsV2(parsed)) {
          const snapArr = parsed.snap.filter((k) => typeof k === 'string');
          rebuildHiddenIntentFromFile(snapArr, parsed.visible.filter((k) => typeof k === 'string'));
          const vis = parsed.visible.filter((k) => typeof k === 'string' && allKeys.includes(k));
          const snapSet = new Set(snapArr);
          const brandNew = allKeys.filter((k) => !snapSet.has(k));
          const next = mergeWithLocked([...vis, ...brandNew]);
          setCheckedColumnKeys(next);
          for (const k of allKeys) {
            if (!next.includes(k)) hiddenIntentRef.current.add(k);
          }
          prevAllKeysRef.current = [...allKeys];
          setColumnSettingsInitialized(true);
          return;
        }
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 旧版仅存可见 key：无法区分「隐藏」与「当时尚不存在的列」，升级为 v2（snap 取当前可选列全集）
          const validKeys = parsed.filter((k: string) => typeof k === 'string' && allKeys.includes(k));
          if (validKeys.length > 0) {
            const next = mergeWithLocked(validKeys);
            setCheckedColumnKeys(next);
            persistV2(next, allKeys);
            prevAllKeysRef.current = [...allKeys];
            setColumnSettingsInitialized(true);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load column settings', e);
    }

    // 默认全部选中（排除默认隐藏的列，但冻结列必含）
    const defaultKeys = allKeys.filter((k) => !defaultHiddenColumns.includes(k));
    const initial = mergeWithLocked(defaultKeys.length > 0 ? defaultKeys : allKeys);
    hiddenIntentRef.current = new Set(allKeys.filter((k) => !initial.includes(k)));
    setCheckedColumnKeys(initial);
    prevAllKeysRef.current = [...allKeys];
    setColumnSettingsInitialized(true);
  }, [allColumns, columnSettingsInitialized, settingsKey, defaultHiddenColumns, getColumnKey, mergeWithLocked, persistV2, rebuildHiddenIntentFromFile]);

  /**
   * 可选列集合变化时（例如列表先空后有数据、或动态列与当前数据集对齐），同步勾选状态：
   * - 剔除已不在 allColumns 中的 key（避免 Popover 与表格脱节）
   * - 仅当相对「上一次已处理的可选列」真正新增的 key 才默认并入勾选（避免把用户隐藏的列当成「缺失」又打开）
   */
  useEffect(() => {
    if (!columnSettingsInitialized || allColumns.length === 0) return;
    const allKeys = allColumns.map((col) => getColumnKey(col)).filter(Boolean);
    const prev = prevAllKeysRef.current;
    const prevSet = new Set(prev);
    const sameUniverse = prev.length === allKeys.length && allKeys.every((k) => prevSet.has(k));
    if (sameUniverse) return;

    const brandNew = allKeys.filter((k) => !prevSet.has(k));
    const toShow = brandNew.filter((k) => !hiddenIntentRef.current.has(k));
    setCheckedColumnKeys((prevChecked) => {
      const pruned = prevChecked.filter((k) => allKeys.includes(k));
      if (toShow.length === 0 && pruned.length === prevChecked.length) {
        prevAllKeysRef.current = [...allKeys];
        return prevChecked;
      }
      const next = mergeWithLocked([...pruned, ...toShow]);
      persistV2(next, allKeys);
      prevAllKeysRef.current = [...allKeys];
      return next;
    });
  }, [allColumns, columnSettingsInitialized, getColumnKey, mergeWithLocked, persistV2]);

  // 监听自定义事件，实现同页面多实例同步（解决 Hook 与 Button 组件状态分离的问题）
  useEffect(() => {
    const handleSync = (e: CustomEvent) => {
      if (e.detail?.key === `table_cols_${settingsKey}` && Array.isArray(e.detail?.value)) {
        const v = e.detail.value as string[];
        setCheckedColumnKeys(v);
        const keysNow = allColumns.map((col) => getColumnKey(col)).filter(Boolean);
        hiddenIntentRef.current = new Set(keysNow.filter((k) => !v.includes(k)));
      }
    };

    window.addEventListener('table-settings-sync', handleSync as any);
    return () => {
      window.removeEventListener('table-settings-sync', handleSync as any);
    };
  }, [settingsKey, allColumns, getColumnKey]);

  // 处理列设置变化
  const handleColumnSettingsChange = useCallback(
    (keys: string[]) => {
      const next = mergeWithLocked(keys);
      setCheckedColumnKeys(next);
      const allKeys = allColumns.map((col) => getColumnKey(col)).filter(Boolean);
      persistV2(next, allKeys);
      prevAllKeysRef.current = [...allKeys];
    },
    [allColumns, getColumnKey, mergeWithLocked, persistV2]
  );

  // 根据选中的列键过滤列
  const displayColumns = useMemo(() => {
    if (!columnSettingsInitialized || checkedColumnKeys.length === 0) {
      return allColumns;
    }
    return allColumns.filter((col) => {
      const key = getColumnKey(col);
      // 如果没有 key，默认显示（如操作列）
      if (!key) return true;
      if (lockedColumnKeys.includes(key)) return true;
      return checkedColumnKeys.includes(key);
    });
  }, [allColumns, checkedColumnKeys, columnSettingsInitialized, getColumnKey, lockedColumnKeys]);

  // 列设置选项（fixed 为冻结列，不可在列展示中取消）
  const columnOptions = useMemo(() => {
    return allColumns
      .map((col) => {
        const key = getColumnKey(col);
        const title = typeof col.title === 'string' ? col.title : key;
        if (!key) return null;
        return {
          label: title,
          value: key,
          disabled: lockedColumnKeys.includes(key),
        };
      })
      .filter(Boolean) as { label: string; value: string; disabled?: boolean }[];
  }, [allColumns, getColumnKey, lockedColumnKeys]);

  return {
    displayColumns,
    checkedColumnKeys,
    columnOptions,
    handleColumnSettingsChange,
    columnSettingsInitialized,
    /** 带 `fixed` 的列，列展示中不可取消 */
    lockedColumnKeys,
  };
}
