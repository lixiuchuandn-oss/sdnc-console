import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  InputNumber,
  Select,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd/es/form';
import type { FormListOperation } from 'antd/es/form';
import { PlusOutlined } from '@ant-design/icons';
import {
  buildMetadataDeviceSelectOptions,
  normalizeDatabaseSizeMBInput,
  normalizeDeviceNames,
  baselineNodeDeviceKeySet,
  baselineNodeNameSet,
  type CephHarvesterAddonFormValues,
  type CephHarvesterAddonValuesConfig,
} from '../../lib/cephHarvesterAddon';
import { summarizeNodeDevices } from '../../hooks/harvesterAddonFormTypes';
import FormSection from './FormSection';
import NodeDiskNodeCard, { nodeRowHasAdvanced } from './NodeDiskNodeCard';
import { NODE_DISK_LIST_LAYOUT_STYLE } from './addonUiConstants';
import { addHarvesterAddonNodeRow } from './nodeDiskAssignmentUtils';

type FormValues = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

type NodeDiskAssignmentEditorProps = {
  form: FormInstance<FormValues>;
  nodeOptions: { label: string; value: string }[];
  blockDevicesRaw: unknown;
  metaLoading: boolean;
  disabled: boolean;
  baselineConfig: CephHarvesterAddonValuesConfig | null;
  onRefresh: () => void;
  expansionMode?: boolean;
  listOpsRef?: React.MutableRefObject<FormListOperation | null>;
};

const NodeDiskAssignmentEditor: React.FC<NodeDiskAssignmentEditorProps> = ({
  form,
  nodeOptions,
  blockDevicesRaw,
  metaLoading,
  disabled,
  baselineConfig,
  onRefresh,
  expansionMode = false,
  listOpsRef,
}) => {
  const watchedNodes = Form.useWatch(['cephCluster', 'nodes'], form);
  const summary = useMemo(() => summarizeNodeDevices(watchedNodes), [watchedNodes]);
  const lockedNodeNames = useMemo(() => baselineNodeNameSet(baselineConfig), [baselineConfig]);
  const lockedDeviceKeys = useMemo(
    () => baselineNodeDeviceKeySet(baselineConfig),
    [baselineConfig],
  );
  const [advancedRowIndex, setAdvancedRowIndex] = useState<number | null>(null);

  const lockedDevicesForNode = useCallback(
    (nodeName: string | undefined) => {
      if (!nodeName) return new Set<string>();
      return new Set(
        [...lockedDeviceKeys]
          .filter((key) => key.startsWith(`${nodeName}/`))
          .map((key) => key.slice(nodeName.length + 1)),
      );
    },
    [lockedDeviceKeys],
  );

  const clearDevicesForRow = (rowIndex: number) => {
    form.setFieldValue(['cephCluster', 'nodes', rowIndex, 'deviceNames'], []);
  };

  const usedNodeNames = useMemo(
    () => new Set((watchedNodes || []).map((r) => r?.nodeName).filter(Boolean) as string[]),
    [watchedNodes],
  );

  const advancedRow = advancedRowIndex != null ? watchedNodes?.[advancedRowIndex] : undefined;
  const advancedNodeName = advancedRow?.nodeName;
  const advancedMetadataOptions = advancedNodeName
    ? buildMetadataDeviceSelectOptions(
        blockDevicesRaw,
        advancedNodeName,
        advancedRow?.metadataDevice,
        advancedRow?.deviceNames,
      )
    : [];

  return (
    <Form.List name={['cephCluster', 'nodes']}>
      {(fields, { add, remove, move }) => {
        if (listOpsRef) {
          listOpsRef.current = { add, remove, move };
        }

        const toolbarButtons = (
          <Space wrap size={8}>
            <Button loading={metaLoading} disabled={disabled} onClick={onRefresh}>
              刷新磁盘
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={
                disabled ||
                nodeOptions.length === 0 ||
                nodeOptions.every((o) => usedNodeNames.has(o.value))
              }
              onClick={() => addHarvesterAddonNodeRow(add, nodeOptions, watchedNodes)}
            >
              添加节点
            </Button>
          </Space>
        );

        const emptyMarginStyle = expansionMode
          ? ({ margin: 0 } as const)
          : ({ margin: '8px 0 16px' } as const);
        const emptyFieldsMarginStyle = expansionMode
          ? ({ margin: 0 } as const)
          : ({ margin: '16px 0' } as const);

        const nodeListContent: React.ReactNode =
          fields.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="请点击「添加节点」开始配置"
              style={emptyFieldsMarginStyle}
            />
          ) : (
            <div style={NODE_DISK_LIST_LAYOUT_STYLE}>
              {fields.map((field, rowIndex) => {
                const currentNode = watchedNodes?.[field.name]?.nodeName;
                const nodeLocked = !!(currentNode && lockedNodeNames.has(currentNode));
                const usedByOthers = new Set(
                  (watchedNodes || [])
                    .filter((_, index) => index !== field.name)
                    .map((r) => r?.nodeName)
                    .filter(Boolean) as string[],
                );
                const selected = normalizeDeviceNames(watchedNodes?.[field.name]?.deviceNames);

                return (
                  <NodeDiskNodeCard
                    key={field.key}
                    field={field}
                    rowIndex={rowIndex}
                    fieldsLength={fields.length}
                    currentNode={currentNode}
                    nodeLocked={nodeLocked}
                    usedByOthers={usedByOthers}
                    nodeOptions={nodeOptions}
                    blockDevicesRaw={blockDevicesRaw}
                    metaLoading={metaLoading}
                    disabled={disabled}
                    selected={selected}
                    hasAdvanced={nodeRowHasAdvanced(watchedNodes?.[field.name])}
                    lockedDevices={lockedDevicesForNode(currentNode)}
                    onNodeChange={() => clearDevicesForRow(field.name)}
                    onOpenAdvanced={() => setAdvancedRowIndex(field.name)}
                    onRemove={() => remove(field.name)}
                    canRemove={fields.length > 1}
                  />
                );
              })}
            </div>
          );

        const editorBody: React.ReactNode = (
          <>
            {!metaLoading && nodeOptions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无节点数据，请先刷新磁盘列表"
                style={emptyMarginStyle}
              />
            ) : null}

            {metaLoading ? (
              <Skeleton
                active
                paragraph={{ rows: expansionMode ? 2 : 3 }}
                style={{ margin: 0, padding: 0 }}
              />
            ) : (
              nodeListContent
            )}

            {!metaLoading ? (
              <Space wrap size={[16, 4]} style={{ marginTop: 16 }}>
                <Typography.Text type="secondary">
                  已选择 {summary.diskCount} 块存储硬盘，涉及 {summary.nodeCount} 个节点
                </Typography.Text>
                {nodeOptions.length > 0 ? (
                  <Typography.Text type="secondary">集群共 {nodeOptions.length} 个节点</Typography.Text>
                ) : null}
              </Space>
            ) : null}

            {!metaLoading && summary.duplicateNodeNames.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message="存在重复节点"
                description={`同一节点请勿添加多行：${summary.duplicateNodeNames.join('、')}`}
              />
            ) : null}
          </>
        );

        return (
          <>
            {expansionMode ? (
              editorBody
            ) : (
              <FormSection
                title="节点与数据盘"
                description="为每个节点选择参与构建存储的硬盘，可多选，推荐每个节点选择的硬盘数量相同。"
                extra={toolbarButtons}
              >
                {editorBody}
              </FormSection>
            )}

            <Drawer
              title="节点高级参数"
              width={480}
              open={advancedRowIndex != null}
              destroyOnClose
              onClose={() => setAdvancedRowIndex(null)}
            >
              {advancedRowIndex != null ? (
                <>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    节点：{advancedNodeName || '—'}
                  </Typography.Paragraph>
                  <Form.Item
                    name={[advancedRowIndex, 'metadataDevice']}
                    label="元数据盘"
                    style={{ marginBottom: 16 }}
                  >
                    <Select
                      allowClear
                      showSearch
                      placeholder={advancedNodeName ? '选择元数据盘（可选）' : '请先选择节点'}
                      options={advancedMetadataOptions}
                      optionFilterProp="label"
                      loading={metaLoading}
                      disabled={
                        disabled ||
                        !advancedNodeName ||
                        !!(advancedNodeName && lockedNodeNames.has(advancedNodeName))
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    name={[advancedRowIndex, 'databaseSizeMB']}
                    label="每盘缓存区大小"
                    normalize={normalizeDatabaseSizeMBInput}
                    extra="BlueStore DB 容量，留空使用集群默认。"
                  >
                    <InputNumber
                      min={1}
                      precision={0}
                      placeholder="留空默认"
                      suffix="MB"
                      style={{ width: '100%' }}
                      disabled={
                        disabled ||
                        !!(advancedNodeName && lockedNodeNames.has(advancedNodeName))
                      }
                    />
                  </Form.Item>
                </>
              ) : null}
            </Drawer>
          </>
        );
      }}
    </Form.List>
  );
};

export default NodeDiskAssignmentEditor;
