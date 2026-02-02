import React, { useState, useEffect, useMemo } from 'react';
import { Popover, Checkbox, Button, Tooltip } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import type { ColumnsType, ColumnType, ColumnGroupType } from 'antd/es/table';

type CheckboxValueType = string | number | boolean;

interface TableColumnSettingsProps<T> {
  columns: ColumnsType<T>; // 完整的列定义
  onChange: (newColumns: ColumnsType<T>) => void; // 返回过滤后的列
  settingsKey?: string; // 本地存储 Key
  defaultHiddenColumns?: string[]; // 默认隐藏的列 Key
}

/**
 * 表格列设置组件
 * 用于控制表格列的显示/隐藏，并支持本地持久化
 */
export const TableColumnSettings = <T extends object>({
  columns,
  onChange,
  settingsKey,
  defaultHiddenColumns = [],
}: TableColumnSettingsProps<T>) => {
  // 获取列的唯一标识 (key > dataIndex > title)
  const getColumnKey = (col: ColumnType<T> | ColumnGroupType<T>): string => {
    if (col.key) return String(col.key);
    // @ts-ignore - dataIndex exists on ColumnType but TS might complain for Group
    if (col.dataIndex) return Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : String(col.dataIndex);
    if (typeof col.title === 'string') return col.title;
    return '';
  };

  // 提取所有可配置的列
  const columnOptions = useMemo(() => {
    return columns
      .map((col) => {
        const key = getColumnKey(col);
        const title = typeof col.title === 'string' ? col.title : key;
        // 如果没有 key 且没有 title，通常是特殊列，忽略配置（始终显示）或不做处理
        if (!key) return null;
        return { label: title, value: key };
      })
      .filter((opt): opt is { label: string; value: string } => !!opt);
  }, [columns]);

  // 初始化选中状态
  const [checkedList, setCheckedList] = useState<CheckboxValueType[]>([]);
  const [initialized, setInitialized] = useState(false);

  // 加载初始设置
  useEffect(() => {
    if (initialized) return;

    const allKeys = columnOptions.map(o => o.value);
    let initialChecked = allKeys.filter(k => !defaultHiddenColumns.includes(k));

    // 如果有 settingsKey，尝试从 localStorage 读取
    if (settingsKey) {
      try {
        const saved = localStorage.getItem(`table_cols_${settingsKey}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            // 过滤掉无效的 key (防止列定义变更后残留)
            const validSaved = parsed.filter((k: string) => allKeys.includes(k));
            if (validSaved.length > 0 || parsed.length === 0) {
              initialChecked = validSaved;
            }
          }
        }
      } catch (e) {
        console.error('Failed to load column settings', e);
      }
    }

    setCheckedList(initialChecked);
    setInitialized(true);
  }, [columnOptions, settingsKey, defaultHiddenColumns, initialized]);

  // 当 checkedList 改变时，通知父组件并保存
  useEffect(() => {
    if (!initialized) return;

    // 计算新的 columns
    const newColumns = columns.filter(col => {
      const key = getColumnKey(col);
      // 如果 key 为空（未在 options 中），默认显示
      if (!key) return true;
      // 检查是否在 checkedList 中
      return checkedList.includes(key);
    });

    onChange(newColumns);

    // 保存到 localStorage
    if (settingsKey) {
      localStorage.setItem(`table_cols_${settingsKey}`, JSON.stringify(checkedList));
    }
  }, [checkedList, columns, initialized, settingsKey]); 
  // 注意：这里去掉了 onChange 依赖，防止父组件没用 useCallback 导致死循环，但 columns 变化时应该重新计算

  const handleCheckAll = (e: any) => {
    const allKeys = columnOptions.map(o => o.value);
    setCheckedList(e.target.checked ? allKeys : []);
  };

  const content = (
    <div style={{ minWidth: 150 }}>
      <div style={{ padding: '4px 8px 8px', borderBottom: '1px solid #f0f0f0' }}>
        <Checkbox
          indeterminate={checkedList.length > 0 && checkedList.length < columnOptions.length}
          onChange={handleCheckAll}
          checked={checkedList.length === columnOptions.length}
        >
          列展示
        </Checkbox>
      </div>
      <div style={{ padding: '8px', maxHeight: '300px', overflowY: 'auto' }}>
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          options={columnOptions}
          value={checkedList}
          onChange={(list) => setCheckedList(list)}
        />
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      title={null}
      trigger="click"
      placement="bottomRight"
    >
      <Tooltip title="列设置">
        <Button icon={<SettingOutlined />} />
      </Tooltip>
    </Popover>
  );
};

export default TableColumnSettings;
