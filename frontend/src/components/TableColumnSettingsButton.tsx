import React, { useMemo } from 'react';
import { Popover, Checkbox, Button, Tooltip } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTableColumnSettings } from '../hooks/useTableColumnSettings';
import type { ColumnsType } from 'antd/es/table';

interface TableColumnSettingsButtonProps<T> {
  allColumns: ColumnsType<T>;
  settingsKey: string;
  defaultHiddenColumns?: string[];
  onColumnsChange?: (columns: ColumnsType<T>) => void;
}

/**
 * 表格列设置按钮组件
 * 替代原来的 TableColumnSettings 组件，避免死锁问题
 * 
 * 使用方式：
 * ```tsx
 * const { displayColumns, ColumnSettingsButton } = useTableColumnSettings(allColumns, 'my-table-key');
 * 
 * return (
 *   <>
 *     <ColumnSettingsButton />
 *     <Table columns={displayColumns} ... />
 *   </>
 * );
 * ```
 */
export function TableColumnSettingsButton<T extends object>({
  allColumns,
  settingsKey,
  defaultHiddenColumns = [],
  onColumnsChange,
}: TableColumnSettingsButtonProps<T>) {
  const {
    displayColumns,
    checkedColumnKeys,
    columnOptions,
    handleColumnSettingsChange,
    columnSettingsInitialized,
  } = useTableColumnSettings(allColumns, settingsKey, defaultHiddenColumns);

  // 通知父组件列变化
  React.useEffect(() => {
    if (columnSettingsInitialized && onColumnsChange) {
      onColumnsChange(displayColumns);
    }
  }, [displayColumns, columnSettingsInitialized, onColumnsChange]);

  const [visible, setVisible] = React.useState(false);

  const handleCheckAll = (e: any) => {
    const allValues = columnOptions.map((o) => o.value);
    handleColumnSettingsChange(e.target.checked ? allValues : []);
  };

  const content = useMemo(() => (
    <div style={{ minWidth: 150 }}>
      <div style={{ padding: '4px 8px 8px', borderBottom: '1px solid #f0f0f0' }}>
        <Checkbox
          indeterminate={checkedColumnKeys.length > 0 && checkedColumnKeys.length < columnOptions.length}
          onChange={handleCheckAll}
          checked={checkedColumnKeys.length === columnOptions.length}
        >
          列展示
        </Checkbox>
      </div>
      <div style={{ padding: '8px', maxHeight: '300px', overflowY: 'auto' }}>
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          options={columnOptions}
          value={checkedColumnKeys}
          onChange={(list) => handleColumnSettingsChange(list as string[])}
        />
      </div>
    </div>
  ), [checkedColumnKeys, columnOptions, handleColumnSettingsChange]);

  return (
    <Popover
      content={content}
      title={null}
      trigger="click"
      placement="bottomRight"
      open={visible}
      onOpenChange={setVisible}
    >
      <Tooltip title="列设置">
        <Button icon={<SettingOutlined />} />
      </Tooltip>
    </Popover>
  );
}

export default TableColumnSettingsButton;
