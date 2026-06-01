import React, { useState } from 'react';
import { Space, Button, Dropdown, Modal, Checkbox, Tooltip } from 'antd';
import { ReloadOutlined, SettingOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';

export type ColumnOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

type Props = {
  left?: React.ReactNode;
  right?: React.ReactNode; // Custom right content (will be appended after standard actions if both exist)
  style?: React.CSSProperties;
  leftGap?: number;
  rightGap?: number;
  
  // Standard Actions
  primaryAction?: {
    label: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    danger?: boolean;
    tooltip?: React.ReactNode;
  };
  
  batchActions?: {
    items: MenuProps['items'];
    onMenuClick?: (key: string) => void;
    disabled?: boolean;
    tooltip?: React.ReactNode;
  };
  
  columnsConfig?: {
    value: string[];
    options: ColumnOption[];
    onChange: (values: string[]) => void;
    tooltip?: React.ReactNode;
  };
  
  onRefresh?: (force?: boolean) => void;
  refreshLoading?: boolean;
  refreshTooltip?: React.ReactNode;
};

/**
 * SharedToolbar
 * 
 * Layout:
 * - Left: Filter actions
 * - Right: 
 *   1. Primary Action (Text only)
 *   2. Batch Actions (Icon only: EllipsisOutlined)
 *   3. Column Settings (Icon only: SettingOutlined) -> Modal (720px, flex-wrap)
 *   4. Refresh (Icon only: ReloadOutlined)
 *   5. Custom right content
 */
const SharedToolbar: React.FC<Props> = ({ 
  left, 
  right, 
  style, 
  leftGap = 8, 
  rightGap = 8,
  primaryAction,
  batchActions,
  columnsConfig,
  onRefresh,
  refreshLoading,
  refreshTooltip = '刷新'
}) => {
  const [colModalVisible, setColModalVisible] = useState(false);
  const [tempColValue, setTempColValue] = useState<string[]>([]);

  const handleOpenColModal = () => {
    if (columnsConfig) {
      setTempColValue(columnsConfig.value);
      setColModalVisible(true);
    }
  };

  const handleColOk = () => {
    if (columnsConfig) {
      columnsConfig.onChange(tempColValue);
    }
    setColModalVisible(false);
  };

  const renderRightActions = () => {
    const items: React.ReactNode[] = [];

    // 1. Primary Action
    if (primaryAction) {
      const btn = (
        <Button 
          type="primary" 
          onClick={primaryAction.onClick}
          loading={primaryAction.loading}
          disabled={primaryAction.disabled}
          danger={primaryAction.danger}
        >
          {primaryAction.label}
        </Button>
      );
      items.push(primaryAction.tooltip ? <Tooltip key="primary" title={primaryAction.tooltip}>{btn}</Tooltip> : <React.Fragment key="primary">{btn}</React.Fragment>);
    }

    // 2. Batch Actions
    if (batchActions && batchActions.items && batchActions.items.length > 0) {
      const btn = (
        <Dropdown 
          menu={{ 
            items: batchActions.items, 
            onClick: (info) => batchActions.onMenuClick && batchActions.onMenuClick(info.key) 
          }} 
          trigger={['click']}
          disabled={batchActions.disabled}
        >
          <Button icon={<EllipsisOutlined />} />
        </Dropdown>
      );
      items.push(batchActions.tooltip ? <Tooltip key="batch" title={batchActions.tooltip}>{btn}</Tooltip> : <React.Fragment key="batch">{btn}</React.Fragment>);
    }

    // 3. Column Settings
    if (columnsConfig) {
      const btn = (
        <Button 
          icon={<SettingOutlined />} 
          onClick={handleOpenColModal}
        />
      );
      items.push(columnsConfig.tooltip ? <Tooltip key="columns" title={columnsConfig.tooltip}>{btn}</Tooltip> : <React.Fragment key="columns">{btn}</React.Fragment>);
    }

    // 4. Refresh
    if (onRefresh) {
      const btn = (
        <Button
          icon={<ReloadOutlined />}
          onClick={() => onRefresh(true)}
          loading={refreshLoading}
        />
      );
      items.push(<Tooltip key="refresh" title={refreshTooltip}>{btn}</Tooltip>);
    }

    return items;
  };

  const rightItems = renderRightActions();

  return (
    <>
      <div
        className="shared-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          marginBottom: 16,
          ...style,
        }}
      >
        <Space size={leftGap} wrap style={{ minWidth: 0 }}>
          {left}
        </Space>
        <Space size={rightGap} wrap style={{ marginLeft: 'auto' }}>
          {rightItems}
          {right}
        </Space>
      </div>

      {/* Column Selection Modal */}
      {columnsConfig && (
        <Modal
          open={colModalVisible}
          onOk={handleColOk}
          onCancel={() => setColModalVisible(false)}
          width={720}
          destroyOnHidden
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px' }}>
             <Checkbox 
                indeterminate={tempColValue.length > 0 && tempColValue.length < columnsConfig.options.length}
                checked={tempColValue.length === columnsConfig.options.length}
                onChange={(e) => {
                  setTempColValue(e.target.checked ? columnsConfig.options.map(o => o.value) : []);
                }}
                style={{ width: '100%', marginBottom: 8, fontWeight: 'bold' }}
              >
                全选
              </Checkbox>
              <Checkbox.Group 
                value={tempColValue} 
                onChange={(vals) => setTempColValue(vals as string[])}
                style={{ display: 'contents' }}
              >
                {columnsConfig.options.map(opt => (
                  <div key={opt.value} style={{ minWidth: 140, display: 'flex', alignItems: 'center' }}>
                    <Checkbox value={opt.value} disabled={opt.disabled}>{opt.label}</Checkbox>
                  </div>
                ))}
              </Checkbox.Group>
          </div>
        </Modal>
      )}
    </>
  );
};

export default SharedToolbar;
