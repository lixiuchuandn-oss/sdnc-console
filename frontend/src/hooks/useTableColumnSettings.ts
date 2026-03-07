import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ColumnsType, ColumnType, ColumnGroupType } from 'antd/es/table';

/**
 * 表格列设置 Hook
 * 用于管理表格列的显示/隐藏，并支持本地持久化
 * 
 * 这个 hook 替代了原来的 TableColumnSettings 组件，避免了死锁问题
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
            setCheckedColumnKeys(validKeys);
            setColumnSettingsInitialized(true);
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load column settings', e);
    }
    
    // 默认全部选中（排除默认隐藏的列）
    const defaultKeys = allKeys.filter(k => !defaultHiddenColumns.includes(k));
    setCheckedColumnKeys(defaultKeys.length > 0 ? defaultKeys : allKeys);
    setColumnSettingsInitialized(true);
  }, [allColumns, columnSettingsInitialized, settingsKey, defaultHiddenColumns, getColumnKey]);

  // 处理列设置变化
  const handleColumnSettingsChange = useCallback((keys: string[]) => {
    setCheckedColumnKeys(keys);
    // 保存到 localStorage
    try {
      localStorage.setItem(`table_cols_${settingsKey}`, JSON.stringify(keys));
    } catch (e) {
      console.warn('Failed to save column settings', e);
    }
  }, [settingsKey]);

  // 根据选中的列键过滤列
  const displayColumns = useMemo(() => {
    if (!columnSettingsInitialized || checkedColumnKeys.length === 0) {
      return allColumns;
    }
    return allColumns.filter((col) => {
      const key = getColumnKey(col);
      // 如果没有 key，默认显示（如操作列）
      if (!key) return true;
      return checkedColumnKeys.includes(key);
    });
  }, [allColumns, checkedColumnKeys, columnSettingsInitialized, getColumnKey]);

  // 列设置选项
  const columnOptions = useMemo(() => {
    return allColumns
      .map((col) => {
        const key = getColumnKey(col);
        const title = typeof col.title === 'string' ? col.title : key;
        if (!key) return null;
        return { label: title, value: key };
      })
      .filter((opt): opt is { label: string; value: string } => !!opt);
  }, [allColumns, getColumnKey]);

  return {
    displayColumns,
    checkedColumnKeys,
    columnOptions,
    handleColumnSettingsChange,
    columnSettingsInitialized,
  };
}
