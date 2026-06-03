import React from 'react';
import { Button, Card, Form, Select, Space, Typography } from 'antd';
import type { FormListFieldData } from 'antd/es/form';
import { SettingOutlined } from '@ant-design/icons';
import {
  mergeConfiguredBlockDeviceOptions,
  normalizeDeviceNames,
  parseBlockDeviceOptions,
  parseDatabaseSizeMB,
  type CephBlockDeviceOption,
} from '../../lib/cephHarvesterAddon';
import BlockDeviceCardGrid from './BlockDeviceCardGrid';
import { NODE_DISK_NODE_CARD_STYLE, NODE_DISK_NODE_CARD_STYLES } from './addonUiConstants';
import { deviceNamesFieldRules } from './nodeDiskFieldRules';

export type NodeDiskNodeCardProps = {
  field: FormListFieldData;
  rowIndex: number;
  fieldsLength: number;
  currentNode: string | undefined;
  nodeLocked: boolean;
  usedByOthers: Set<string>;
  nodeOptions: { label: string; value: string }[];
  blockDevicesRaw: unknown;
  metaLoading: boolean;
  disabled: boolean;
  selected: string[];
  hasAdvanced: boolean;
  lockedDevices: Set<string>;
  onNodeChange: () => void;
  onOpenAdvanced: () => void;
  onRemove: () => void;
  canRemove: boolean;
};

const NodeDiskNodeCard: React.FC<NodeDiskNodeCardProps> = ({
  field,
  rowIndex,
  fieldsLength,
  currentNode,
  nodeLocked,
  usedByOthers,
  nodeOptions,
  blockDevicesRaw,
  metaLoading,
  disabled,
  selected,
  hasAdvanced,
  lockedDevices,
  onNodeChange,
  onOpenAdvanced,
  onRemove,
  canRemove,
}) => {
  const options: CephBlockDeviceOption[] = currentNode
    ? mergeConfiguredBlockDeviceOptions(
        parseBlockDeviceOptions(blockDevicesRaw, currentNode),
        selected,
        currentNode,
      )
    : [];

  return (
    <Card
      size="small"
      style={NODE_DISK_NODE_CARD_STYLE}
      styles={NODE_DISK_NODE_CARD_STYLES}
      title={
        <Space size={10} align="center" style={{ width: '100%' }}>
          {fieldsLength > 1 ? (
            <Typography.Text
              strong
              style={{
                flexShrink: 0,
                fontSize: 13,
                color: 'rgba(0,0,0,.65)',
                minWidth: 28,
              }}
            >
              {rowIndex + 1}
            </Typography.Text>
          ) : null}
          <Form.Item
            noStyle
            name={[field.name, 'nodeName']}
            rules={[{ required: true, message: '请选择节点' }]}
            style={{ flex: 1, minWidth: 0, margin: 0 }}
          >
            <Select
              size="small"
              variant="borderless"
              prefix="选择节点"
              allowClear
              showSearch
              placeholder="请选择"
              options={nodeOptions.filter(
                (o) => o.value === currentNode || !usedByOthers.has(o.value),
              )}
              optionFilterProp="label"
              loading={metaLoading}
              disabled={disabled || nodeLocked}
              onChange={onNodeChange}
            />
          </Form.Item>
        </Space>
      }
      extra={
        <Space size={4}>
          <Button
            type="link"
            icon={<SettingOutlined />}
            disabled={disabled || nodeLocked || !currentNode}
            onClick={onOpenAdvanced}
            style={hasAdvanced ? { color: '#1677ff' } : undefined}
          >
            高级参数
          </Button>
          <Button type="link" danger disabled={disabled || !canRemove || nodeLocked} onClick={onRemove}>
            移除
          </Button>
        </Space>
      }
    >
      {!currentNode ? (
        <Typography.Text type="secondary">请先选择节点，再选择参与构建存储的硬盘</Typography.Text>
      ) : (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
            {selected.length > 0
              ? `已选择 ${selected.length} 块参与构建存储的硬盘`
              : '请选择参与构建存储的硬盘（可多选）'}
          </Typography.Text>
          <Form.Item
            noStyle
            name={[field.name, 'deviceNames']}
            normalize={(value) => normalizeDeviceNames(value)}
            rules={deviceNamesFieldRules}
          >
            <BlockDeviceCardGrid
              options={options}
              disabled={disabled || metaLoading}
              lockedDevices={lockedDevices}
            />
          </Form.Item>
        </>
      )}
      {!currentNode ? (
        <Form.Item
          noStyle
          name={[field.name, 'deviceNames']}
          normalize={(value) => normalizeDeviceNames(value)}
          rules={deviceNamesFieldRules}
          hidden
        >
          <Select mode="multiple" style={{ display: 'none' }} />
        </Form.Item>
      ) : null}
    </Card>
  );
};

export default NodeDiskNodeCard;

/** 供父组件判断「高级参数」是否已配置 */
export function nodeRowHasAdvanced(
  row: { metadataDevice?: string; databaseSizeMB?: unknown } | undefined,
): boolean {
  return !!(
    row?.metadataDevice?.trim() || parseDatabaseSizeMB(row?.databaseSizeMB) != null
  );
}
