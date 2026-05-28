import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
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
import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import {
  buildMetadataDeviceSelectOptions,
  mergeConfiguredBlockDeviceOptions,
  normalizeDatabaseSizeMBInput,
  normalizeDeviceNames,
  parseBlockDeviceOptions,
  parseDatabaseSizeMB,
  baselineNodeDeviceKeySet,
  baselineNodeNameSet,
  type CephHarvesterAddonFormValues,
  type CephHarvesterAddonNodeFormRow,
  type CephHarvesterAddonValuesConfig,
} from '../../lib/cephHarvesterAddon';
import BlockDeviceCardGrid from './BlockDeviceCardGrid';
import FormSection from './FormSection';
import { NODE_DISK_LIST_LAYOUT_STYLE } from './addonUiConstants';
import { addHarvesterAddonNodeRow } from './nodeDiskAssignmentUtils';

type FormValues = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

const deviceNamesFieldRules = [
  {
    validator: async (_: unknown, value: unknown) => {
      if (normalizeDeviceNames(value).length < 1) {
        throw new Error('请至少选择一块数据盘');
      }
    },
  },
];

function summarizeNodeDevices(nodes: CephHarvesterAddonNodeFormRow[] | undefined): {
  diskCount: number;
  nodeCount: number;
  duplicateNodeNames: string[];
} {
  const rows = (nodes || []).filter(
    (r) => r?.nodeName && normalizeDeviceNames(r.deviceNames).length > 0,
  );
  const nodeNames = (nodes || []).map((r) => r?.nodeName).filter(Boolean) as string[];
  const duplicateNodeNames = [
    ...new Set(nodeNames.filter((name, index) => nodeNames.indexOf(name) !== index)),
  ];
  return {
    diskCount: rows.reduce((sum, r) => sum + normalizeDeviceNames(r.deviceNames).length, 0),
    nodeCount: rows.length,
    duplicateNodeNames,
  };
}

type NodeDiskAssignmentEditorProps = {
  form: FormInstance<FormValues>;
  nodeOptions: { label: string; value: string }[];
  blockDevicesRaw: unknown;
  metaLoading: boolean;
  disabled: boolean;
  baselineConfig: CephHarvesterAddonValuesConfig | null;
  onRefresh: () => void;
  /** 扩容 Tab：仅渲染列表区，Alert 由父级与「配置详情」Tab 对齐 */
  expansionMode?: boolean;
  /** 扩容 Tab：向父级暴露 Form.List 的 add/remove，供 Alert 工具栏使用 */
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

        const nodeListContent =
          fields.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="请点击「添加节点」开始配置"
              style={emptyFieldsMarginStyle}
            />
          ) : (
            <div style={NODE_DISK_LIST_LAYOUT_STYLE}>
              {fields.map((field) => {
                const currentNode = watchedNodes?.[field.name]?.nodeName;
                const nodeLocked = !!(currentNode && lockedNodeNames.has(currentNode));
                const usedByOthers = new Set(
                  (watchedNodes || [])
                    .filter((_, index) => index !== field.name)
                    .map((r) => r?.nodeName)
                    .filter(Boolean) as string[],
                );
                const selected = normalizeDeviceNames(watchedNodes?.[field.name]?.deviceNames);
                const options = currentNode
                  ? mergeConfiguredBlockDeviceOptions(
                      parseBlockDeviceOptions(blockDevicesRaw, currentNode),
                      selected,
                      currentNode,
                    )
                  : [];
                const hasAdvanced = !!(
                  watchedNodes?.[field.name]?.metadataDevice?.trim() ||
                  parseDatabaseSizeMB(watchedNodes?.[field.name]?.databaseSizeMB) != null
                );

                return (
                  <Card
                    key={field.key}
                    size="small"
                    styles={{ body: { padding: '16px 20px' } }}
                    title={
                      <Form.Item
                        noStyle
                        name={[field.name, 'nodeName']}
                        rules={[{ required: true, message: '请选择节点' }]}
                      >
                        <Select
                          size="small"
                          variant="borderless"
                          allowClear
                          showSearch
                          placeholder="选择存储节点"
                          options={nodeOptions.filter(
                            (o) => o.value === currentNode || !usedByOthers.has(o.value),
                          )}
                          optionFilterProp="label"
                          loading={metaLoading}
                          disabled={disabled || nodeLocked}
                          style={{ maxWidth: 320, width: '100%' }}
                          onChange={() => clearDevicesForRow(field.name)}
                        />
                      </Form.Item>
                    }
                    extra={
                      <Space size={4}>
                        <Button
                          type="link"
                          icon={<SettingOutlined />}
                          disabled={disabled || nodeLocked || !currentNode}
                          onClick={() => setAdvancedRowIndex(field.name)}
                          style={hasAdvanced ? { color: '#1677ff' } : undefined}
                        >
                          高级参数
                        </Button>
                        <Button
                          type="link"
                          danger
                          disabled={disabled || fields.length <= 1 || nodeLocked}
                          onClick={() => remove(field.name)}
                        >
                          移除
                        </Button>
                      </Space>
                    }
                  >
                    {!currentNode ? (
                      <Typography.Text type="secondary">请先选择节点，再勾选数据盘</Typography.Text>
                    ) : (
                      <>
                        <Typography.Text
                          type="secondary"
                          style={{ display: 'block', marginBottom: 12, fontSize: 13 }}
                        >
                          {selected.length > 0
                            ? `已选 ${selected.length} 块数据盘`
                            : '请点选下方磁盘卡片（可多选）'}
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
                            lockedDevices={lockedDevicesForNode(currentNode)}
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
              })}
            </div>
          );

        const editorBody = (
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
                  已选 {summary.diskCount} 块盘，涉及 {summary.nodeCount} 个节点
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
                description="为每个存储节点选择一块或多块裸盘作为 Ceph OSD。请勿选择系统盘或仍在使用的业务盘。"
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
