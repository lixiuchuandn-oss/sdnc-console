/**
 * 集群 · 存储服务 · 开启/配置 Harvester rook-ceph Addon（Cloudmap `cluster/harvester_addon`）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Select,
  Space,
  Spin,
  Steps,
  Switch,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { FormListFieldData } from 'antd/es/form';
import type { FormInstance } from 'antd/es/form';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import {
  applyCephHarvesterAddon,
  fetchCephHarvesterAddon,
  type CephHarvesterAddonStatusResponse,
} from '../../../../../../services/cephApi';
import { fetchBlockDevices, fetchNodeResources } from '../../../../../../services/monitoringApi';
import {
  createHarvesterToolbarRefresh,
  mergeCephSectionOnRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cephSectionRefresh';
import {
  blockDeviceOptionTooltip,
  buildDefaultHarvesterAddonFormValues,
  buildHarvesterAddonFormValuesFromStatus,
  buildMetadataDeviceSelectOptions,
  describeSelectedBlockDevices,
  formatBlockDbSizeForConfig,
  formValuesToApplyConfig,
  formatBlockDeviceOptionSummary,
  mergeConfiguredBlockDeviceOptions,
  normalizeDeviceNames,
  parseBlockDbSizeGiB,
  parseBlockDeviceOptions,
  parseNodeNameOptions,
  validateAddonConfig,
  validateRunningClusterConfigChange,
  baselineNodeDeviceKeySet,
  baselineNodeNameSet,
  type CephBlockDeviceOption,
  type CephHarvesterAddonFormValues,
  type CephHarvesterAddonNodeFormRow,
  type CephHarvesterAddonValuesConfig,
} from '../lib/cephHarvesterAddon';

export type CephHarvesterAddonSectionProps = {
  cloudId: string;
  onRefresh?: HarvesterSectionOnRefresh;
  onDeployed?: () => void;
};

type FormValues = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

const WIZARD_STEPS = [
  { title: '存储节点' },
  { title: '集群服务' },
  { title: '容量与策略' },
  { title: '组件版本' },
  { title: '确认配置' },
] as const;

/** 向导内 Input / InputNumber / Select 统一宽度 */
const FIELD_CONTROL_WIDTH = 480;
const fc: React.CSSProperties = { width: FIELD_CONTROL_WIDTH };

const COMPRESSION_OPTIONS = [
  { value: 'none', label: '关闭' },
  { value: 'passive', label: '被动（空闲时压缩）' },
  { value: 'aggressive', label: '积极' },
  { value: 'force', label: '强制' },
];

const RECLAIM_POLICY_OPTIONS = [
  { value: 'Delete', label: '随云硬盘删除' },
  { value: 'Retain', label: '保留数据' },
];

const VOLUME_BINDING_OPTIONS = [
  { value: 'Immediate', label: '创建时分配' },
  { value: 'WaitForFirstConsumer', label: '首次使用时分配' },
];

const OSD_STORE_OPTIONS = [
  { value: 'bluestore', label: 'BlueStore（推荐）' },
  { value: 'filestore', label: 'FileStore（旧版）' },
];

const deviceNamesFieldRules = [
  {
    validator: async (_: unknown, value: unknown) => {
      if (normalizeDeviceNames(value).length < 1) {
        throw new Error('请至少选择一块数据盘');
      }
    },
  },
];

const SUBMIT_RISK_ITEMS = [
  '所选数据盘将用于 Ceph OSD，盘内原有数据会被清除且不可恢复。',
  '节点、磁盘或副本等配置错误可能导致部署失败，或导致集群/业务长时间不可用。',
  '对已运行的统一存储修改配置，可能触发 OSD 迁移、重建或服务中断。',
  '提交后部署或应用通常需要数分钟，请勿重复提交；进度以页面状态为准。',
  '若使用专家模式手动 YAML，将绕过向导校验，错误配置需自行承担后果。',
];

const EXPANSION_SUBMIT_RISK_ITEMS = [
  '本次仅允许扩容：新增数据盘或新存储节点；已有 OSD 不可移除或改配。',
  '仅新勾选的数据盘会被初始化并加入集群，已有 OSD 上的业务数据不会被此向导清除。',
  '新盘仍会被格式化为 OSD，盘内原有数据不可恢复，请勿误选系统盘或业务盘。',
  '副本数、管理节点、镜像等集群级配置已锁定；如需调整请联系运维在维护窗口处理。',
  '提交后 Rook 创建新 OSD 通常需要数分钟，请勿重复提交；进度以页面状态为准。',
];

type WizardBlockProps = {
  title: string;
  description?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
};

const WizardBlock: React.FC<WizardBlockProps> = ({ title, description, extra, children }) => (
  <Card
    size="small"
    title={title}
    extra={extra}
    style={{ marginBottom: 16 }}
    styles={{ body: { paddingTop: description ? 12 : 16 } }}
  >
    {description ? (
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {description}
      </Typography.Paragraph>
    ) : null}
    {children}
  </Card>
);

type NodeDeviceFormRow = CephHarvesterAddonNodeFormRow;

function summarizeNodeDevices(nodes: NodeDeviceFormRow[] | undefined): {
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
    diskCount: rows.reduce(
      (sum, r) => sum + normalizeDeviceNames(r.deviceNames).length,
      0,
    ),
    nodeCount: rows.length,
    duplicateNodeNames,
  };
}

function BlockDeviceCheckboxList({
  options,
  disabled,
  lockedDevices,
  value,
  onChange,
}: {
  options: CephBlockDeviceOption[];
  disabled?: boolean;
  lockedDevices?: Set<string>;
  value?: string[];
  onChange?: (checked: string[]) => void;
}) {
  const normalizedValue = normalizeDeviceNames(value);
  const locked = lockedDevices ?? new Set<string>();

  const handleChange = (checked: unknown) => {
    const next = normalizeDeviceNames(checked);
    const preserved = normalizedValue.filter((name) => locked.has(name));
    onChange?.([...new Set([...preserved, ...next])]);
  };

  return (
    <Checkbox.Group
      disabled={disabled}
      value={normalizedValue}
      onChange={handleChange}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
    >
      {options.map((opt) => {
        const pathLabel = opt.devPath || (opt.value ? `/dev/${opt.value}` : opt.value);
        const meta = [opt.sizeLabel, opt.driveType, opt.model, opt.serialNumber ? `SN ${opt.serialNumber}` : '']
          .filter(Boolean)
          .join(' · ');
        const isLocked = locked.has(opt.value) && normalizedValue.includes(opt.value);
        return (
          <Tooltip key={opt.blockDeviceCrName || `${opt.nodeName}:${opt.value}:${opt.devPath}`} title={blockDeviceOptionTooltip(opt)} placement="left">
            <Checkbox
              value={opt.value}
              disabled={disabled || isLocked}
              style={{ alignItems: 'flex-start', marginInlineStart: 0 }}
            >
              <div style={{ lineHeight: 1.5 }}>
                <Typography.Text strong>{pathLabel}</Typography.Text>
                {meta ? (
                  <Typography.Text
                    type="secondary"
                    style={{ display: 'block', fontSize: 12, marginTop: 2 }}
                  >
                    {meta}
                  </Typography.Text>
                ) : null}
              </div>
            </Checkbox>
          </Tooltip>
        );
      })}
    </Checkbox.Group>
  );
}

type NodeDiskAssignmentEditorProps = {
  form: FormInstance<FormValues>;
  nodeOptions: { label: string; value: string }[];
  blockDevicesRaw: unknown;
  metaLoading: boolean;
  disabled: boolean;
  baselineConfig: CephHarvesterAddonValuesConfig | null;
  onRefresh: () => void;
};

const NodeDiskAssignmentEditor: React.FC<NodeDiskAssignmentEditorProps> = ({
  form,
  nodeOptions,
  blockDevicesRaw,
  metaLoading,
  disabled,
  baselineConfig,
  onRefresh,
}) => {
  const watchedNodes = Form.useWatch(['cephCluster', 'nodes'], form);
  const summary = useMemo(() => summarizeNodeDevices(watchedNodes), [watchedNodes]);
  const lockedNodeNames = useMemo(() => baselineNodeNameSet(baselineConfig), [baselineConfig]);
  const lockedDeviceKeys = useMemo(
    () => baselineNodeDeviceKeySet(baselineConfig),
    [baselineConfig],
  );

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

  const addEmptyRow = (add: (row: NodeDeviceFormRow) => void) => {
    const usedNodes = new Set(
      (watchedNodes || []).map((r) => r?.nodeName).filter(Boolean) as string[],
    );
    const presetNode =
      nodeOptions.length === 1 && !usedNodes.has(nodeOptions[0].value)
        ? nodeOptions[0].value
        : '';
    add({
      nodeName: presetNode,
      deviceNames: [],
      metadataDevice: '',
      blockDbSize: '',
    });
  };

  const usedNodeNames = useMemo(
    () => new Set((watchedNodes || []).map((r) => r?.nodeName).filter(Boolean) as string[]),
    [watchedNodes],
  );

  return (
    <Form.List name={['cephCluster', 'nodes']}>
      {(fields, { add, remove }) => (
        <>
          <WizardBlock
            title="节点与数据盘"
            extra={
              <Space wrap size={8}>
                <Button
                  size="small"
                  loading={metaLoading}
                  disabled={disabled}
                  onClick={onRefresh}
                >
                  刷新列表
                </Button>
                <Button
                  size="small"
                  type="primary"
                  disabled={
                    disabled ||
                    nodeOptions.length === 0 ||
                    nodeOptions.every((o) => usedNodeNames.has(o.value))
                  }
                  onClick={() => addEmptyRow(add)}
                >
                  添加
                </Button>
              </Space>
            }
          >
            {!metaLoading && nodeOptions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无节点数据，请先刷新列表"
                style={{ margin: '8px 0 16px' }}
              />
            ) : null}

            <Table<FormListFieldData>
              className="std-table"
              size="middle"
              pagination={false}
              scroll={{ x: true }}
              rowKey="key"
              dataSource={fields}
              locale={{ emptyText: '请点击右上角「添加」配置节点与数据盘' }}
              columns={[
                {
                  title: '序号',
                  width: 56,
                  fixed: 'left',
                  render: (_v, field) => field.name + 1,
                },
                {
                  title: '节点',
                  fixed: 'left',
                  render: (_v, field) => {
                    const currentNode = watchedNodes?.[field.name]?.nodeName;
                    const nodeLocked = !!(currentNode && lockedNodeNames.has(currentNode));
                    const usedByOthers = new Set(
                      (watchedNodes || [])
                        .filter((_, index) => index !== field.name)
                        .map((r) => r?.nodeName)
                        .filter(Boolean) as string[],
                    );
                    return (
                    <Form.Item
                      name={[field.name, 'nodeName']}
                      rules={[{ required: true, message: '请选择节点' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        allowClear
                        showSearch
                        placeholder="选择节点"
                        options={nodeOptions.filter(
                          (o) => o.value === currentNode || !usedByOthers.has(o.value),
                        )}
                        optionFilterProp="label"
                        loading={metaLoading}
                        disabled={disabled || nodeLocked}
                        style={{ width: 200 }}
                        onChange={() => clearDevicesForRow(field.name)}
                      />
                    </Form.Item>
                    );
                  },
                },
                {
                  title: '数据盘',
                  render: (_v, field) => {
                    const nodeName = watchedNodes?.[field.name]?.nodeName;
                    const selected = normalizeDeviceNames(watchedNodes?.[field.name]?.deviceNames);
                    const options = nodeName
                      ? mergeConfiguredBlockDeviceOptions(
                          parseBlockDeviceOptions(blockDevicesRaw, nodeName),
                          selected,
                          nodeName,
                        )
                      : [];
                    const selectedSummary = selected
                      .map((value) => {
                        const opt = options.find((o) => o.value === value);
                        return opt ? formatBlockDeviceOptionSummary(opt) : value;
                      })
                      .join('；');
                    return (
                      <div style={{ minWidth: 480, maxWidth: FIELD_CONTROL_WIDTH }}>
                        {!nodeName ? (
                          <Typography.Text type="secondary">请先选择节点</Typography.Text>
                        ) : options.length === 0 && selected.length === 0 && !metaLoading ? (
                          <Typography.Text type="secondary">
                            该节点暂无可用磁盘，请确认已挂载裸盘或刷新列表
                          </Typography.Text>
                        ) : (
                          <>
                            {selected.length > 0 ? (
                              <Typography.Text
                                type="secondary"
                                style={{ display: 'block', marginBottom: 8, fontSize: 12 }}
                              >
                                已选 {selected.length} 块：{selectedSummary}
                              </Typography.Text>
                            ) : (
                              <Typography.Text
                                type="secondary"
                                style={{ display: 'block', marginBottom: 8, fontSize: 12 }}
                              >
                                请勾选参与存储的数据盘
                              </Typography.Text>
                            )}
                            <Form.Item
                              name={[field.name, 'deviceNames']}
                              normalize={(value) => normalizeDeviceNames(value)}
                              rules={deviceNamesFieldRules}
                              style={{ marginBottom: 0 }}
                            >
                              <BlockDeviceCheckboxList
                                options={options}
                                disabled={disabled || metaLoading}
                                lockedDevices={lockedDevicesForNode(nodeName)}
                              />
                            </Form.Item>
                          </>
                        )}
                        {!nodeName ? (
                          <Form.Item
                            name={[field.name, 'deviceNames']}
                            normalize={(value) => normalizeDeviceNames(value)}
                            rules={deviceNamesFieldRules}
                            hidden
                          >
                            <Select mode="multiple" style={{ display: 'none' }} />
                          </Form.Item>
                        ) : null}
                        {nodeName && options.length === 0 && selected.length === 0 && !metaLoading ? (
                          <Form.Item
                            name={[field.name, 'deviceNames']}
                            normalize={(value) => normalizeDeviceNames(value)}
                            rules={deviceNamesFieldRules}
                            hidden
                          >
                            <Select mode="multiple" style={{ display: 'none' }} />
                          </Form.Item>
                        ) : null}
                      </div>
                    );
                  },
                },
                {
                  title: '高级',
                  width: 72,
                  render: (_v, field) => {
                    const row = watchedNodes?.[field.name];
                    const nodeName = row?.nodeName;
                    const nodeLocked = !!(nodeName && lockedNodeNames.has(nodeName));
                    const metadataOptions = nodeName
                      ? buildMetadataDeviceSelectOptions(
                          blockDevicesRaw,
                          nodeName,
                          row?.metadataDevice,
                          row?.deviceNames,
                        )
                      : [];
                    const hasAdvanced = !!(row?.metadataDevice?.trim() || row?.blockDbSize?.trim());
                    return (
                      <Popover
                        trigger="click"
                        placement="left"
                        title="可选参数"
                        content={
                          <div style={{ width: FIELD_CONTROL_WIDTH }}>
                            <Form.Item
                              name={[field.name, 'metadataDevice']}
                              label="元数据盘"
                              style={{ marginBottom: 12 }}
                            >
                              <Select
                                allowClear
                                showSearch
                                placeholder={nodeName ? '选择元数据盘' : '请先选择节点'}
                                options={metadataOptions}
                                optionFilterProp="label"
                                loading={metaLoading}
                                disabled={disabled || !nodeName || nodeLocked}
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                            <Form.Item
                              name={[field.name, 'blockDbSize']}
                              label="每盘缓存区大小"
                              normalize={formatBlockDbSizeForConfig}
                              getValueProps={(v) => ({ value: parseBlockDbSizeGiB(v) })}
                              style={{ marginBottom: 0 }}
                            >
                              <InputNumber
                                min={1}
                                precision={0}
                                placeholder="留空默认"
                                suffix="GiB"
                                disabled={disabled || nodeLocked}
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                          </div>
                        }
                      >
                        <Button
                          type="link"
                          disabled={disabled || nodeLocked}
                          style={hasAdvanced ? { color: '#1677ff' } : undefined}
                        >
                          {hasAdvanced ? '已设' : '设置'}
                        </Button>
                      </Popover>
                    );
                  },
                },
                {
                  title: '操作',
                  width: 72,
                  fixed: 'right',
                  render: (_v, field) => {
                    const rowNode = watchedNodes?.[field.name]?.nodeName;
                    const nodeLocked = !!(rowNode && lockedNodeNames.has(rowNode));
                    return (
                    <Button
                      type="link"
                      danger
                      disabled={disabled || fields.length <= 1 || nodeLocked}
                      onClick={() => remove(field.name)}
                    >
                      移除
                    </Button>
                    );
                  },
                },
              ]}
            />

            <Space wrap size={[16, 4]} style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">
                已选 {summary.diskCount} 块盘，涉及 {summary.nodeCount} 个节点
              </Typography.Text>
              {nodeOptions.length > 0 ? (
                <Typography.Text type="secondary">
                  集群共 {nodeOptions.length} 个节点
                </Typography.Text>
              ) : null}
            </Space>

            {summary.duplicateNodeNames.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message="存在重复节点"
                description={`同一节点请勿添加多行：${summary.duplicateNodeNames.join('、')}`}
              />
            ) : null}
          </WizardBlock>
        </>
      )}
    </Form.List>
  );
};

function formatCompressionLabel(value?: string): string {
  return COMPRESSION_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

function formatReclaimLabel(value?: string): string {
  return RECLAIM_POLICY_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

function formatBindingLabel(value?: string): string {
  return VOLUME_BINDING_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

const CephHarvesterAddonSection: React.FC<CephHarvesterAddonSectionProps> = ({
  cloudId,
  onRefresh,
  onDeployed,
}) => {
  const [form] = Form.useForm<FormValues>();
  const [formInitKey, setFormInitKey] = useState(0);
  const [formInitialValues, setFormInitialValues] = useState<FormValues>(() =>
    buildDefaultHarvesterAddonFormValues(),
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [statusLoading, setStatusLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitRiskAck, setSubmitRiskAck] = useState(false);
  const [submitAdminPassword, setSubmitAdminPassword] = useState('');
  const [metaLoading, setMetaLoading] = useState(false);
  const [status, setStatus] = useState<CephHarvesterAddonStatusResponse | null>(null);
  const [nodeOptions, setNodeOptions] = useState<{ label: string; value: string }[]>([]);
  const [blockDevicesRaw, setBlockDevicesRaw] = useState<unknown>(null);
  const pollRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<CephHarvesterAddonStatusResponse['phase'] | null>(null);
  const onDeployedRef = useRef(onDeployed);
  onDeployedRef.current = onDeployed;

  const notifyDeployedIfNeeded = useCallback((phase: CephHarvesterAddonStatusResponse['phase']) => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === 'progress' && phase === 'success') {
      onDeployedRef.current?.();
    }
  }, []);

  const applyStatusToForm = useCallback(
    (res: CephHarvesterAddonStatusResponse) => {
      const values = buildHarvesterAddonFormValuesFromStatus(res);
      setFormInitialValues(values);
      form.setFieldsValue(values);
      setFormInitKey((k) => k + 1);
    },
    [form],
  );

  const loadMeta = useCallback(async () => {
    if (!cloudId) return;
    setMetaLoading(true);
    try {
      const [nodeRes, bdRes] = await Promise.all([
        fetchNodeResources(cloudId, { signal: undefined }),
        fetchBlockDevices(cloudId, { signal: undefined }),
      ]);
      if (nodeRes.ok && nodeRes.data != null) {
        setNodeOptions(parseNodeNameOptions(nodeRes.data));
      }
      if (bdRes.ok && bdRes.data != null) {
        setBlockDevicesRaw(bdRes.data);
      }
    } finally {
      setMetaLoading(false);
    }
  }, [cloudId]);

  const loadStatus = useCallback(
    async (force?: boolean, opts?: { silent?: boolean }) => {
      if (!cloudId) return;
      if (!opts?.silent) setStatusLoading(true);
      try {
        const res = await fetchCephHarvesterAddon(cloudId, { force: !!force });
        if (!res.ok || !res.data) {
          setStatus(null);
          prevPhaseRef.current = null;
          return;
        }
        notifyDeployedIfNeeded(res.data.phase);
        setStatus(res.data);
        applyStatusToForm(res.data);
      } finally {
        if (!opts?.silent) setStatusLoading(false);
      }
    },
    [applyStatusToForm, cloudId, notifyDeployedIfNeeded],
  );

  useEffect(() => {
    prevPhaseRef.current = null;
    setCurrentStep(0);
    const defaults = buildDefaultHarvesterAddonFormValues();
    setFormInitialValues(defaults);
    setFormInitKey((k) => k + 1);
    void loadStatus(true);
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 cloudId 切换时初始化
  }, [cloudId]);

  useEffect(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (status?.phase === 'progress') {
      pollRef.current = window.setInterval(() => {
        void loadStatus(true, { silent: true });
      }, 8000);
    }
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, [loadStatus, status?.phase]);

  const sectionOnRefresh = useMemo(
    () => mergeCephSectionOnRefresh((force) => loadStatus(force !== false), onRefresh),
    [loadStatus, onRefresh],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(sectionOnRefresh),
    [sectionOnRefresh],
  );

  const handleReplicaSizeChange = (value: number | null) => {
    const size = Math.max(1, Math.min(7, Number(value) || 3));
    const derived = Math.min(3, size);
    const current = form.getFieldsValue();
    form.setFieldsValue({
      cephtools: { ...current.cephtools, replicas: derived },
      cephCluster: {
        ...current.cephCluster,
        monCount: derived,
        mgrCount: derived,
      },
    });
  };

  const validateWizardStep = async (step: number) => {
    if (step === 0) {
      const nodes = form.getFieldValue(['cephCluster', 'nodes']) as FormValues['cephCluster']['nodes'];
      if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('请至少添加一组节点与数据盘');
      }
      const namePaths = nodes.flatMap((_, index) => [
        ['cephCluster', 'nodes', index, 'nodeName'],
        ['cephCluster', 'nodes', index, 'deviceNames'],
      ]);
      await form.validateFields(namePaths);
      const summary = summarizeNodeDevices(nodes);
      if (summary.duplicateNodeNames.length > 0) {
        throw new Error('同一节点请勿添加多行，请合并数据盘选择');
      }
      return;
    }
    if (step === 1) {
      await form.validateFields([
        ['cephCluster', 'monCount'],
        ['cephCluster', 'mgrCount'],
        ['cephCluster', 'dashboardEnabled'],
      ]);
      return;
    }
    if (step === 2) {
      await form.validateFields([
        'replicaSize',
        'compressionMode',
        ['storageClass', 'reclaimPolicy'],
        ['storageClass', 'allowVolumeExpansion'],
        ['storageClass', 'volumeBindingMode'],
      ]);
      return;
    }
    if (step === 3) {
      await form.validateFields([
        ['cephtools', 'replicas'],
        ['cephtools', 'image'],
        ['operator', 'replicas'],
        ['operator', 'image'],
      ]);
    }
  };

  const handleNext = async () => {
    try {
      await validateWizardStep(currentStep);
      setCurrentStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
    } catch (e) {
      if (e instanceof Error && e.message) message.warning(e.message);
    }
  };

  const handlePrev = () => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  const handleStepChange = (next: number) => {
    if (next < currentStep) setCurrentStep(next);
  };

  const getWizardFormValues = useCallback((): FormValues => {
    return form.getFieldsValue(true) as FormValues;
  }, [form]);

  const closeSubmitConfirm = useCallback(() => {
    setSubmitConfirmOpen(false);
    setSubmitRiskAck(false);
    setSubmitAdminPassword('');
  }, []);

  const submitConfirmReady =
    submitRiskAck && submitAdminPassword.trim().length > 0;

  const openSubmitConfirm = async () => {
    if (!cloudId) return;
    if (status?.phase === 'progress') {
      message.warning('统一存储正在部署中，请待完成后再提交配置变更');
      return;
    }
    try {
      for (let step = 0; step < WIZARD_STEPS.length - 1; step += 1) {
        await validateWizardStep(step);
      }
      setSubmitRiskAck(false);
      setSubmitAdminPassword('');
      setSubmitConfirmOpen(true);
    } catch (e) {
      if (e instanceof Error && e.message) message.warning(e.message);
    }
  };

  const formDisabled = submitting || metaLoading || status?.phase === 'progress';
  const isRunningCluster = status?.phase === 'success' && !!status?.config;
  const configLocked = isRunningCluster;
  const baselineConfig = isRunningCluster ? status?.config ?? null : null;
  const submitActionLabel = isRunningCluster
    ? '提交扩容'
    : status?.exists
      ? '保存并应用'
      : '开启统一存储';
  const submitRiskItems = isRunningCluster ? EXPANSION_SUBMIT_RISK_ITEMS : SUBMIT_RISK_ITEMS;

  const executeSubmit = async () => {
    const password = submitAdminPassword.trim();
    if (!cloudId || !submitRiskAck || !password) {
      message.warning('请勾选风险确认并输入管理员密码');
      return;
    }
    setSubmitting(true);
    try {
      const values = getWizardFormValues();
      const overrideYaml = String(values.valuesContentOverride || '').trim();

      if (isRunningCluster && overrideYaml) {
        message.warning('已运行集群不支持专家 YAML 覆盖，请使用向导扩容');
        return;
      }

      if (overrideYaml) {
        const res = await applyCephHarvesterAddon(cloudId, {
          valuesContent: overrideYaml,
          password,
        });
        if (!res.ok || !res.data) {
          message.error(res.error || '提交失败');
          return;
        }
        closeSubmitConfirm();
        setStatus(res.data);
        prevPhaseRef.current = res.data.phase;
        applyStatusToForm(res.data);
        message.success(
          res.data.applied === 'created' ? '已提交开启统一存储' : '已更新统一存储配置',
        );
        if (res.data.phase === 'success') onDeployedRef.current?.();
        else if (res.data.phase === 'progress') void loadStatus(true);
        return;
      }

      const config = formValuesToApplyConfig(values);
      const validationError = validateAddonConfig(config);
      if (validationError) {
        message.warning(validationError);
        setCurrentStep(0);
        return;
      }

      if (isRunningCluster && status.config) {
        const expansionError = validateRunningClusterConfigChange(status.config, config);
        if (expansionError) {
          message.warning(expansionError);
          setCurrentStep(0);
          return;
        }
      }

      const res = await applyCephHarvesterAddon(cloudId, { config, password });
      if (!res.ok || !res.data) {
        message.error(res.error || '提交失败');
        return;
      }
      closeSubmitConfirm();
      setStatus(res.data);
      prevPhaseRef.current = res.data.phase;
      applyStatusToForm(res.data);
      message.success(
        res.data.applied === 'created'
          ? '已提交开启统一存储'
          : isRunningCluster
            ? '已提交扩容'
            : '已更新统一存储配置',
      );
      if (res.data.phase === 'success') onDeployedRef.current?.();
      else if (res.data.phase === 'progress') void loadStatus(true);
    } catch {
      /* 表单校验 */
    } finally {
      setSubmitting(false);
    }
  };

  const renderStepPoolAndSc = () => (
    <>
      <WizardBlock
        title="数据保护"
        description="决定块存储数据的冗余份数。生产环境通常使用 3 副本以兼顾可靠性与性能。"
      >
        <Form.Item
          name="replicaSize"
          label="数据副本数"
          rules={[{ required: true, message: '请输入副本数' }]}
          extra="修改后会同步更新「集群服务」与「组件版本」中的相关副本数量。"
        >
          <InputNumber
            min={1}
            max={7}
            style={fc}
            disabled={configLocked}
            onChange={handleReplicaSizeChange}
          />
        </Form.Item>
        <Form.Item name="compressionMode" label="数据压缩">
          <Select options={COMPRESSION_OPTIONS} style={fc} disabled={configLocked} />
        </Form.Item>
      </WizardBlock>

      <WizardBlock
        title="云硬盘行为"
        description="创建块存储云硬盘时的默认回收、扩容与分配策略。"
      >
        <Form.Item name={['storageClass', 'reclaimPolicy']} label="删除云硬盘时">
          <Select options={RECLAIM_POLICY_OPTIONS} style={fc} disabled={configLocked} />
        </Form.Item>
        <Form.Item
          name={['storageClass', 'allowVolumeExpansion']}
          label="允许在线扩容"
          valuePropName="checked"
        >
          <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={configLocked} />
        </Form.Item>
        <Form.Item name={['storageClass', 'volumeBindingMode']} label="存储空间分配时机">
          <Select options={VOLUME_BINDING_OPTIONS} style={fc} disabled={configLocked} />
        </Form.Item>
      </WizardBlock>

      <Collapse
        ghost
        items={[
          {
            key: 'advanced',
            label: '高级选项',
            children: (
              <WizardBlock title="高级 · 数据保护" description="一般保持默认即可。">
                <Form.Item
                  name="requireSafeReplicaSize"
                  label="启用严格副本数校验"
                  valuePropName="checked"
                  extra="关闭后允许使用非标准副本数组合，仅在有明确规划时调整。"
                >
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" disabled={configLocked} />
                </Form.Item>
                <Form.Item
                  name={['storageClass', 'jobImage']}
                  label="存储初始化镜像"
                  rules={[{ required: true, message: '请输入镜像地址' }]}
                >
                  <Input placeholder="docker.io/rancher/shell:v0.5.0" style={fc} disabled={configLocked} />
                </Form.Item>
              </WizardBlock>
            ),
          },
        ]}
      />
    </>
  );

  const renderStepOsdStorage = () => (
    <NodeDiskAssignmentEditor
      form={form}
      nodeOptions={nodeOptions}
      blockDevicesRaw={blockDevicesRaw}
      metaLoading={metaLoading}
      disabled={formDisabled}
      baselineConfig={baselineConfig}
      onRefresh={() => void loadMeta()}
    />
  );

  const renderStepCluster = () => (
    <>
      <WizardBlock
        title="集群管理"
        description="管理节点负责维护存储集群元数据与调度；数量通常与下一步设定的数据副本数一致，也可在此先按节点规模调整。"
      >
        <Form.Item name={['cephCluster', 'monCount']} label="管理节点数量">
          <InputNumber min={1} max={7} style={fc} disabled={configLocked} />
        </Form.Item>
        <Form.Item name={['cephCluster', 'mgrCount']} label="调度服务数量">
          <InputNumber min={1} max={7} style={fc} disabled={configLocked} />
        </Form.Item>
        <Form.Item
          name={['cephCluster', 'dashboardEnabled']}
          label="内置监控面板"
          valuePropName="checked"
        >
          <Switch checkedChildren="启用" unCheckedChildren="关闭" disabled={configLocked} />
        </Form.Item>
      </WizardBlock>

      <Collapse
        ghost
        items={[
          {
            key: 'advanced',
            label: '高级选项',
            children: (
              <>
                <WizardBlock title="高级 · 软件版本" description="除非有升级或兼容性要求，请保持默认版本。">
                  <Form.Item
                    name={['cephCluster', 'cephVersionImage']}
                    label="存储引擎版本"
                    rules={[{ required: true, message: '请输入版本镜像' }]}
                  >
                    <Input placeholder="quay.io/ceph/ceph:v19.2.3" style={fc} disabled={configLocked} />
                  </Form.Item>
                  <Form.Item
                    name={['cephCluster', 'allowUnsupported']}
                    label="允许非官方支持版本"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={configLocked} />
                  </Form.Item>
                </WizardBlock>
                <WizardBlock title="高级 · 磁盘布局" description="影响单盘上的存储进程划分，一般无需修改。">
                  <Form.Item name={['cephCluster', 'osdsPerDevice']} label="每盘存储进程数">
                    <Input style={fc} disabled={configLocked} />
                  </Form.Item>
                  <Form.Item name={['cephCluster', 'osdObjectstore']} label="磁盘存储引擎">
                    <Select options={OSD_STORE_OPTIONS} style={fc} disabled={configLocked} />
                  </Form.Item>
                  <Form.Item name={['cephCluster', 'metadataDevice']} label="集群级元数据盘（可选）">
                    <Input placeholder="留空使用默认" style={fc} disabled={configLocked} />
                  </Form.Item>
                  <Form.Item
                    name={['cephCluster', 'allowMultipleMonPerNode']}
                    label="允许同一节点部署多个管理节点"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={configLocked} />
                  </Form.Item>
                </WizardBlock>
              </>
            ),
          },
        ]}
      />
    </>
  );

  const renderStepComponents = () => (
    <>
      <WizardBlock
        title="运维工具"
        description="用于集群诊断与运维的辅助组件，副本数通常与数据副本数一致。"
      >
        <Form.Item name={['cephtools', 'replicas']} label="实例数量">
          <InputNumber min={1} max={7} style={fc} disabled={configLocked} />
        </Form.Item>
        <Form.Item
          name={['cephtools', 'image']}
          label="软件版本"
          rules={[{ required: true, message: '请输入版本镜像' }]}
        >
          <Input placeholder="quay.io/ceph/ceph:v19.2.3" style={fc} disabled={configLocked} />
        </Form.Item>
      </WizardBlock>

      <WizardBlock
        title="存储控制器"
        description="负责在集群中创建与管理统一存储服务，生产环境通常部署 1 个实例。"
      >
        <Form.Item name={['operator', 'replicas']} label="实例数量">
          <InputNumber min={1} max={3} style={fc} disabled={configLocked} />
        </Form.Item>
        <Form.Item
          name={['operator', 'image']}
          label="软件版本"
          rules={[{ required: true, message: '请输入版本镜像' }]}
        >
          <Input placeholder="docker.io/rook/ceph:v1.19.3" style={fc} disabled={configLocked} />
        </Form.Item>
      </WizardBlock>
    </>
  );

  const renderStepConfirm = () => {
    const v = getWizardFormValues();
    const nodeSummaryLines = (v?.cephCluster?.nodes || [])
      .filter((r) => r?.nodeName && normalizeDeviceNames(r.deviceNames).length > 0)
      .map(
        (r) =>
          `${r.nodeName}：${describeSelectedBlockDevices(blockDevicesRaw, r.nodeName, r.deviceNames)}`,
      );

    return (
      <>
        <WizardBlock title="配置摘要">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="存储节点">
              {nodeSummaryLines.length === 0 ? (
                '未配置'
              ) : (
                nodeSummaryLines.map((line, index) => (
                  <div key={index} style={index > 0 ? { marginTop: 6 } : undefined}>
                    {line}
                  </div>
                ))
              )}
            </Descriptions.Item>
            <Descriptions.Item label="管理 / 调度节点">
              {v?.cephCluster?.monCount ?? '—'} / {v?.cephCluster?.mgrCount ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="内置监控面板">
              {v?.cephCluster?.dashboardEnabled ? '启用' : '关闭'}
            </Descriptions.Item>
            <Descriptions.Item label="数据副本数">{v?.replicaSize ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="数据压缩">{formatCompressionLabel(v?.compressionMode)}</Descriptions.Item>
            <Descriptions.Item label="删除云硬盘时">
              {formatReclaimLabel(v?.storageClass?.reclaimPolicy)}
            </Descriptions.Item>
            <Descriptions.Item label="存储空间分配">
              {formatBindingLabel(v?.storageClass?.volumeBindingMode)}
            </Descriptions.Item>
            <Descriptions.Item label="在线扩容">
              {v?.storageClass?.allowVolumeExpansion ? '允许' : '禁止'}
            </Descriptions.Item>
          </Descriptions>
        </WizardBlock>

        <Collapse
          ghost
          items={
            configLocked
              ? []
              : [
            {
              key: 'expert',
              label: '专家模式（手动编辑完整配置）',
              children: (
                <Form.Item
                  name="valuesContentOverride"
                  extra="填写后将忽略向导中的全部选项，仅适用于需要完全自定义配置的场景。"
                >
                  <Input.TextArea
                    rows={8}
                    placeholder="留空则根据向导自动生成配置"
                    spellCheck={false}
                    style={fc}
                  />
                </Form.Item>
              ),
            },
          ]}
        />
      </>
    );
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return renderStepOsdStorage();
      case 1:
        return renderStepCluster();
      case 2:
        return renderStepPoolAndSc();
      case 3:
        return renderStepComponents();
      case 4:
        return renderStepConfirm();
      default:
        return null;
    }
  };

  const renderStatusAlert = () => {
    const refreshAction = (
      <Button
        size="small"
        type="text"
        icon={<ReloadOutlined />}
        loading={statusLoading}
        onClick={handleToolbarRefresh}
        aria-label="刷新"
      />
    );

    let type: 'success' | 'info' | 'warning' | 'error' = 'info';
    let message = '统一存储状态';

    if (statusLoading && status == null) {
      message = '正在获取统一存储状态…';
    } else if (!status) {
      return null;
    } else if (status.phase === 'progress') {
      message = '正在部署统一存储，通常需要数分钟，页面将自动刷新进度';
    } else if (status.phase === 'failed') {
      type = 'error';
      message = '部署失败，请检查集群事件或修正配置后重试';
    } else if (status.phase === 'success') {
      type = 'success';
      message = isRunningCluster
        ? '统一存储已就绪，仅支持扩容（新增节点或数据盘）'
        : '统一存储已就绪，可在下方向导中查看或修改配置';
    } else if (status.phase === 'not_installed') {
      type = 'warning';
      message = status.message || '尚未开启统一存储，请在下方向导中完成配置并提交';
    } else {
      message = status.message || '统一存储状态未知';
    }

    return (
      <Alert type={type} showIcon banner message={message} action={refreshAction} />
    );
  };

  return (
    <PageDetailSection title="开启统一存储" autoStyleInputs={false}>
      <Spin spinning={statusLoading && status == null}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {renderStatusAlert()}

          <Steps
            size="small"
            current={currentStep}
            items={[...WIZARD_STEPS]}
            onChange={handleStepChange}
          />

          <Form
            key={`${cloudId}-${formInitKey}`}
            form={form}
            layout="vertical"
            disabled={formDisabled}
            initialValues={formInitialValues}
            preserve
          >
            {renderStepContent()}

            <div
              style={{
                marginTop: 8,
                paddingTop: 16,
                borderTop: '1px solid #f0f0f0',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <Space wrap>
                {status?.config ? (
                  <Button
                    onClick={() => {
                      const values = buildHarvesterAddonFormValuesFromStatus(status);
                      setFormInitialValues(values);
                      form.setFieldsValue(values);
                      setFormInitKey((k) => k + 1);
                      setCurrentStep(0);
                      message.info('已恢复为当前集群配置');
                    }}
                  >
                    恢复当前集群配置
                  </Button>
                ) : null}
              </Space>
              <Space wrap>
                {currentStep > 0 ? <Button onClick={handlePrev}>上一步</Button> : null}
                {currentStep < WIZARD_STEPS.length - 1 ? (
                  <Button type="primary" onClick={() => void handleNext()}>
                    下一步
                  </Button>
                ) : (
                  <Button type="primary" loading={submitting} onClick={() => void openSubmitConfirm()}>
                    {submitActionLabel}
                  </Button>
                )}
              </Space>
            </div>
          </Form>
        </Space>
      </Spin>

      <Modal
        title={`确认${submitActionLabel}`}
        open={submitConfirmOpen}
        width={560}
        maskClosable={false}
        destroyOnClose
        okText={submitActionLabel}
        cancelText="取消"
        okButtonProps={{ disabled: !submitConfirmReady, loading: submitting }}
        onCancel={closeSubmitConfirm}
        onOk={() => void executeSubmit()}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {isRunningCluster
            ? '提交后将向集群应用扩容配置（仅新增 OSD），请确认已核对「配置摘要」并了解以下风险：'
            : '提交后将向集群应用统一存储配置，请确认已核对「配置摘要」并了解以下风险：'}
        </Typography.Paragraph>
        <ul style={{ margin: '0 0 16px', paddingLeft: 20 }}>
          {submitRiskItems.map((item) => (
            <li key={item} style={{ marginBottom: 8 }}>
              {item}
            </li>
          ))}
        </ul>
        <Checkbox
          checked={submitRiskAck}
          onChange={(e) => setSubmitRiskAck(e.target.checked)}
          style={{ marginBottom: 16 }}
        >
          我已阅读并理解上述风险
        </Checkbox>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="管理员密码" required style={{ marginBottom: 0 }}>
            <Input.Password
              placeholder="请输入当前登录管理员密码"
              value={submitAdminPassword}
              onChange={(e) => setSubmitAdminPassword(e.target.value)}
              onPressEnter={() => {
                if (submitConfirmReady && !submitting) void executeSubmit();
              }}
              autoComplete="current-password"
              disabled={submitting}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default CephHarvesterAddonSection;
