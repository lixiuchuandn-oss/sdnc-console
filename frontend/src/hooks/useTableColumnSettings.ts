import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ColumnsType, ColumnType, ColumnGroupType } from 'antd/es/table';

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
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 过滤掉无效的 key
          const validKeys = parsed.filter((k: string) => allKeys.includes(k));
          if (validKeys.length > 0) {
            // 获取保存的设置中缺少的新列（新增的列默认显示）
            const missingKeys = allKeys.filter((k) => !validKeys.includes(k));
            const mergedKeys = [...validKeys, ...missingKeys];
            setCheckedColumnKeys(mergeWithLocked(mergedKeys));
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
    setCheckedColumnKeys(mergeWithLocked(defaultKeys.length > 0 ? defaultKeys : allKeys));
    setColumnSettingsInitialized(true);
  }, [allColumns, columnSettingsInitialized, settingsKey, defaultHiddenColumns, getColumnKey, mergeWithLocked]);

  // 监听自定义事件，实现同页面多实例同步（解决 Hook 与 Button 组件状态分离的问题）
  useEffect(() => {
    const handleSync = (e: CustomEvent) => {
      if (e.detail?.key === `table_cols_${settingsKey}` && Array.isArray(e.detail?.value)) {
        setCheckedColumnKeys(e.detail.value);
      }
    };

    window.addEventListener('table-settings-sync', handleSync as any);
    return () => {
      window.removeEventListener('table-settings-sync', handleSync as any);
    };
  }, [settingsKey]);

  // 处理列设置变化
  const handleColumnSettingsChange = useCallback(
    (keys: string[]) => {
      const next = mergeWithLocked(keys);
      setCheckedColumnKeys(next);
      // 保存到 localStorage
      try {
        localStorage.setItem(`table_cols_${settingsKey}`, JSON.stringify(next));
        // 触发同步事件
        window.dispatchEvent(
          new CustomEvent('table-settings-sync', {
            detail: { key: `table_cols_${settingsKey}`, value: next },
          })
        );
      } catch (e) {
        console.warn('Failed to save column settings', e);
      }
    },
    [settingsKey, mergeWithLocked]
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
