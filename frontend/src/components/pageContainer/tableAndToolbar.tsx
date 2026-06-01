import React, { useMemo } from 'react';
import { Button, Checkbox, Dropdown, Popover, Space } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';

export function useFilteredTableColumns<T>(
  tableProps: TableProps<T> | undefined,
  hiddenColumns: string[],
  externalColumnControl?: boolean,
) {
  return useMemo(() => {
    if (!tableProps?.columns) return undefined;
    if (externalColumnControl) {
      return tableProps.columns;
    }
    return tableProps.columns
      .filter((c: any) => {
        const k = String(c.key || c.dataIndex || '');
        return !hiddenColumns.includes(k);
      })
      .map((c: any) => {
        const { width: _width, ...rest } = c;
        return rest;
      });
  }, [tableProps?.columns, hiddenColumns, externalColumnControl]);
}

export function useColumnControllerContent(
  tableProps: TableProps<any> | undefined,
  hiddenColumns: string[],
  setHiddenColumns: React.Dispatch<React.SetStateAction<string[]>>,
) {
  return useMemo(
    () => (
      <div style={{ padding: '4px 0', width: 500 }}>
        <div style={{ marginBottom: 8, padding: '0 12px', fontWeight: 600 }}>列展示</div>
        <div
          style={{
            maxHeight: 300,
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            padding: '0 12px',
          }}
        >
          {tableProps?.columns?.map((c: any, idx) => {
            const k = String(c.key || c.dataIndex || '');
            const title = typeof c.title === 'string' ? c.title : k || `列 ${idx + 1}`;
            return (
              <div key={k || idx} style={{ minWidth: 100 }}>
                <Checkbox
                  checked={!hiddenColumns.includes(k)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setHiddenColumns((prev) => prev.filter((x) => x !== k));
                    } else {
                      setHiddenColumns((prev) => [...prev, k]);
                    }
                  }}
                >
                  {title}
                </Checkbox>
              </div>
            );
          })}
        </div>
      </div>
    ),
    [tableProps?.columns, hiddenColumns, setHiddenColumns],
  );
}

type MoreMenuItem = {
  key: string;
  label: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

type ToolbarActionsOptions = {
  toolbarRight?: React.ReactNode;
  primaryAction?: {
    text: string;
    onClick: () => void;
    disabled?: boolean;
    type?: 'primary' | 'default';
    icon?: React.ReactNode;
  };
  secondaryActions?: React.ReactNode;
  moreMenuItems?: MoreMenuItem[];
  actionsSize?: 'small' | 'middle' | 'large';
  tableProps?: TableProps<any>;
  externalColumnControl?: boolean;
  columnControllerContent: React.ReactNode;
  onRefresh?: (force?: boolean) => void;
};

export function usePageContainerToolbarActions({
  toolbarRight,
  primaryAction,
  secondaryActions,
  moreMenuItems,
  actionsSize = 'middle',
  tableProps,
  externalColumnControl,
  columnControllerContent,
  onRefresh,
}: ToolbarActionsOptions) {
  return useMemo(() => {
    if (toolbarRight !== undefined) return toolbarRight;

    const hasActions =
      primaryAction ||
      (moreMenuItems && moreMenuItems.length > 0) ||
      tableProps ||
      secondaryActions ||
      onRefresh;

    if (!hasActions) return null;

    return (
      <Space>
        {secondaryActions}
        {primaryAction && (
          <Button
            type={primaryAction.type || 'primary'}
            size={actionsSize}
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
          >
            {primaryAction.text}
          </Button>
        )}
        {moreMenuItems && moreMenuItems.length > 0 && (
          <Dropdown
            menu={{
              items: moreMenuItems.flatMap((m, idx) => {
                const items: any[] = [];
                if (idx > 0 && m.danger && !moreMenuItems[idx - 1].danger) {
                  items.push({ type: 'divider' });
                }
                items.push({
                  key: m.key,
                  label: m.label,
                  danger: m.danger,
                  disabled: m.disabled,
                  onClick: m.onClick ? () => m.onClick?.() : undefined,
                });
                return items;
              }),
            }}
          >
            <Button size={actionsSize} icon={<EllipsisOutlined />} />
          </Dropdown>
        )}
        {tableProps && !externalColumnControl && (
          <Popover trigger="click" placement="bottomRight" content={columnControllerContent}>
            <Button size={actionsSize} icon={<SettingOutlined />} />
          </Popover>
        )}
        {onRefresh && (
          <Button
            size={actionsSize}
            icon={<ReloadOutlined />}
            onClick={() => {
              (onRefresh as (force?: boolean) => void)(true);
            }}
          />
        )}
      </Space>
    );
  }, [
    toolbarRight,
    primaryAction,
    secondaryActions,
    moreMenuItems,
    actionsSize,
    tableProps,
    externalColumnControl,
    columnControllerContent,
    onRefresh,
  ]);
}
