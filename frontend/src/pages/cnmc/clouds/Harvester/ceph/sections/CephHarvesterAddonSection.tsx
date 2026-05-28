/**
 * 集群 · 存储服务 · 统一存储配置（Cloudmap `cluster/harvester_addon`）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Tabs,
  Typography,
  message,
} from 'antd';
import type { FormListOperation } from 'antd/es/form';
import { PlusOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import {
  applyCephHarvesterAddon,
  fetchCephHarvesterAddon,
  type CephHarvesterAddonStatusResponse,
} from '../../../../../../services/cephApi';
import { fetchBlockDevices, fetchNodeResources } from '../../../../../../services/monitoringApi';
import {
  mergeCephSectionOnRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cephSectionRefresh';
import {
  buildDefaultHarvesterAddonFormValues,
  buildHarvesterAddonFormValuesFromStatus,
  formValuesToApplyConfig,
  parseNodeNameOptions,
  validateAddonConfig,
  validateRunningClusterConfigChange,
  type CephHarvesterAddonFormValues,
} from '../lib/cephHarvesterAddon';
import AddonStatusOverview from './harvesterAddon/AddonStatusOverview';
import ConfigSummaryDescriptions from './harvesterAddon/ConfigSummaryDescriptions';
import FormSection from './harvesterAddon/FormSection';
import NodeDiskAssignmentEditor from './harvesterAddon/NodeDiskAssignmentEditor';
import {
  COMPRESSION_OPTIONS,
  EXPANSION_SUBMIT_RISK_ITEMS,
  OSD_STORE_OPTIONS,
  RECLAIM_POLICY_OPTIONS,
  SUBMIT_RISK_ITEMS,
  VOLUME_BINDING_OPTIONS,
  WIZARD_STEPS,
  OPERATE_TAB_BODY_STYLE,
  OPERATE_TAB_INFO_ALERT_PROPS,
} from './harvesterAddon/addonUiConstants';
import { addHarvesterAddonNodeRow } from './harvesterAddon/nodeDiskAssignmentUtils';

export type CephHarvesterAddonSectionProps = {
  cloudId: string;
  onRefresh?: HarvesterSectionOnRefresh;
  onDeployed?: () => void;
};

type FormValues = CephHarvesterAddonFormValues & {
  valuesContentOverride?: string;
};

function summarizeNodeDevices(nodes: FormValues['cephCluster']['nodes'] | undefined): {
  duplicateNodeNames: string[];
} {
  const nodeNames = (nodes || []).map((r) => r?.nodeName).filter(Boolean) as string[];
  const duplicateNodeNames = [
    ...new Set(nodeNames.filter((name, index) => nodeNames.indexOf(name) !== index)),
  ];
  return { duplicateNodeNames };
}

const WizardFooter: React.FC<{
  left?: React.ReactNode;
  children: React.ReactNode;
}> = ({ left, children }) => (
  <div
    style={{
      marginTop: 8,
      padding: '16px 0 0',
      borderTop: '1px solid rgba(0,0,0,.06)',
      display: 'flex',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
    }}
  >
    <Space wrap>{left}</Space>
    <Space wrap>{children}</Space>
  </div>
);

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
  const [operateTabKey, setOperateTabKey] = useState<'expand' | 'config'>('expand');
  const [statusLoading, setStatusLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitRiskAck, setSubmitRiskAck] = useState(false);
  const [submitAdminPassword, setSubmitAdminPassword] = useState('');
  const [metaLoading, setMetaLoading] = useState(false);
  const [expertDrawerOpen, setExpertDrawerOpen] = useState(false);
  const expandListOpsRef = useRef<FormListOperation | null>(null);
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

  const loadMeta = useCallback(async (force?: boolean) => {
    if (!cloudId) return;
    setMetaLoading(true);
    try {
      const shouldForce = force !== false;
      const [nodeRes, bdRes] = await Promise.all([
        fetchNodeResources(cloudId, { force: shouldForce }),
        fetchBlockDevices(cloudId, { force: shouldForce }),
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

  const reloadSection = useCallback(
    async (force?: boolean) => {
      const shouldForce = force !== false;
      await Promise.all([loadStatus(shouldForce), loadMeta(shouldForce)]);
    },
    [loadMeta, loadStatus],
  );

  const sectionOnRefresh = useMemo(
    () => mergeCephSectionOnRefresh(reloadSection, onRefresh),
    [onRefresh, reloadSection],
  );

  useEffect(() => {
    prevPhaseRef.current = null;
    setCurrentStep(0);
    setOperateTabKey('expand');
    const defaults = buildDefaultHarvesterAddonFormValues();
    setFormInitialValues(defaults);
    setFormInitKey((k) => k + 1);
    void sectionOnRefresh(true);
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

  const submitConfirmReady = submitRiskAck && submitAdminPassword.trim().length > 0;

  const openSubmitConfirm = async () => {
    if (!cloudId) return;
    if (status?.phase === 'progress') {
      message.warning('统一存储正在部署中，请待完成后再提交配置变更');
      return;
    }
    try {
      if (isRunningCluster) {
        await validateWizardStep(0);
      } else {
        for (let step = 0; step < WIZARD_STEPS.length - 1; step += 1) {
          await validateWizardStep(step);
        }
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
  const watchedExpandNodes = Form.useWatch(['cephCluster', 'nodes'], form);
  const expandUsedNodeNames = useMemo(
    () =>
      new Set(
        (watchedExpandNodes || []).map((r) => r?.nodeName).filter(Boolean) as string[],
      ),
    [watchedExpandNodes],
  );
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
        setExpertDrawerOpen(false);
        setStatus(res.data);
        prevPhaseRef.current = res.data.phase;
        applyStatusToForm(res.data);
        message.success(
          res.data.applied === 'created' ? '已提交开启统一存储' : '已更新统一存储配置',
        );
        if (res.data.phase === 'success') onDeployedRef.current?.();
        else if (res.data.phase === 'progress') void loadStatus(true, { silent: true });
        return;
      }

      const config = formValuesToApplyConfig(values);
      const validationError = validateAddonConfig(config);
      if (validationError) {
        message.warning(validationError);
        setCurrentStep(0);
        setOperateTabKey('expand');
        return;
      }

      if (isRunningCluster && status.config) {
        const expansionError = validateRunningClusterConfigChange(status.config, config);
        if (expansionError) {
          message.warning(expansionError);
          setOperateTabKey('expand');
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
      else if (res.data.phase === 'progress') void loadStatus(true, { silent: true });
    } catch {
      /* 表单校验 */
    } finally {
      setSubmitting(false);
    }
  };

  const renderHiddenFields = () => (
    <>
      <Form.Item name={['cephCluster', 'cephVersionImage']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={['cephCluster', 'allowUnsupported']} hidden valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['cephtools', 'replicas']} hidden>
        <InputNumber />
      </Form.Item>
      <Form.Item name={['cephtools', 'image']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={['operator', 'replicas']} hidden>
        <InputNumber />
      </Form.Item>
      <Form.Item name={['operator', 'image']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={['storageClass', 'jobImage']} hidden>
        <Input />
      </Form.Item>
    </>
  );

  const renderStepPoolAndSc = () => (
    <>
      <FormSection
        title="数据保护"
        description="决定块存储数据的冗余份数。生产环境通常使用 3 副本以兼顾可靠性与性能。"
      >
        <Row gutter={[24, 0]}>
          <Col xs={24} md={12} lg={10}>
            <Form.Item
              name="replicaSize"
              label="数据副本数"
              rules={[{ required: true, message: '请输入副本数' }]}
              extra="修改后会同步更新管理/调度节点副本数量。"
            >
              <InputNumber
                min={1}
                max={7}
                style={{ width: '100%' }}
                disabled={configLocked}
                onChange={handleReplicaSizeChange}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} lg={10}>
            <Form.Item name="compressionMode" label="数据压缩">
              <Select options={COMPRESSION_OPTIONS} disabled={configLocked} />
            </Form.Item>
          </Col>
        </Row>
      </FormSection>

      <FormSection
        title="云硬盘行为"
        description="创建块存储云硬盘时的默认回收、扩容与分配策略。"
      >
        <Row gutter={[24, 0]}>
          <Col xs={24} md={12} lg={10}>
            <Form.Item name={['storageClass', 'reclaimPolicy']} label="删除云硬盘时">
              <Select options={RECLAIM_POLICY_OPTIONS} disabled={configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} lg={10}>
            <Form.Item name={['storageClass', 'volumeBindingMode']} label="存储空间分配时机">
              <Select options={VOLUME_BINDING_OPTIONS} disabled={configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} lg={10}>
            <Form.Item
              name={['storageClass', 'allowVolumeExpansion']}
              label="允许在线扩容"
              valuePropName="checked"
            >
              <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={configLocked} />
            </Form.Item>
          </Col>
        </Row>
      </FormSection>

      <Collapse
        ghost
        items={[
          {
            key: 'advanced',
            label: '高级选项',
            children: (
              <FormSection title="严格副本数校验" description="一般保持默认即可。">
                <Form.Item
                  name="requireSafeReplicaSize"
                  label="启用严格副本数校验"
                  valuePropName="checked"
                  extra="关闭后允许使用非标准副本数组合，仅在有明确规划时调整。"
                >
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" disabled={configLocked} />
                </Form.Item>
              </FormSection>
            ),
          },
        ]}
      />
    </>
  );

  const renderStepCluster = () => (
    <>
      <FormSection
        title="集群管理"
        description="管理节点负责维护存储集群元数据与调度；数量通常与数据副本数一致。"
      >
        <Row gutter={[24, 0]}>
          <Col xs={24} md={8} lg={6}>
            <Form.Item name={['cephCluster', 'monCount']} label="管理节点数量">
              <InputNumber min={1} max={7} style={{ width: '100%' }} disabled={configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8} lg={6}>
            <Form.Item name={['cephCluster', 'mgrCount']} label="调度服务数量">
              <InputNumber min={1} max={7} style={{ width: '100%' }} disabled={configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8} lg={6}>
            <Form.Item
              name={['cephCluster', 'dashboardEnabled']}
              label="内置监控面板"
              valuePropName="checked"
            >
              <Switch checkedChildren="启用" unCheckedChildren="关闭" disabled={configLocked} />
            </Form.Item>
          </Col>
        </Row>
      </FormSection>

      <Collapse
        ghost
        items={[
          {
            key: 'advanced',
            label: '高级选项',
            children: (
              <FormSection title="磁盘布局" description="影响单盘上的存储进程划分，一般无需修改。">
                <Row gutter={[24, 0]}>
                  <Col xs={24} md={12} lg={10}>
                    <Form.Item name={['cephCluster', 'osdsPerDevice']} label="每盘存储进程数">
                      <Input disabled={configLocked} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={10}>
                    <Form.Item name={['cephCluster', 'osdObjectstore']} label="磁盘存储引擎">
                      <Select options={OSD_STORE_OPTIONS} disabled={configLocked} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={10}>
                    <Form.Item name={['cephCluster', 'metadataDevice']} label="集群级元数据盘（可选）">
                      <Input placeholder="留空使用默认" disabled={configLocked} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={10}>
                    <Form.Item
                      name={['cephCluster', 'allowMultipleMonPerNode']}
                      label="允许同一节点部署多个管理节点"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={configLocked} />
                    </Form.Item>
                  </Col>
                </Row>
              </FormSection>
            ),
          },
        ]}
      />
    </>
  );

  const renderStepConfirm = () => (
    <>
      <FormSection title="配置摘要" description="提交前请核对以下参数。">
        <ConfigSummaryDescriptions values={getWizardFormValues()} blockDevicesRaw={blockDevicesRaw} column={2} />
      </FormSection>
      {!configLocked ? (
        <Typography.Link onClick={() => setExpertDrawerOpen(true)} style={{ fontSize: 13 }}>
          专家模式（手动编辑 YAML）
        </Typography.Link>
      ) : null}
    </>
  );

  const renderProvisionWizard = () => (
    <Card size="small" styles={{ body: { padding: '20px 24px 8px' } }}>
      <Steps
        current={currentStep}
        items={WIZARD_STEPS.map((step) => ({ title: step.title, description: step.description }))}
        onChange={handleStepChange}
        style={{ marginBottom: 28 }}
      />
      {currentStep === 0 ? (
        <NodeDiskAssignmentEditor
          form={form}
          nodeOptions={nodeOptions}
          blockDevicesRaw={blockDevicesRaw}
          metaLoading={metaLoading}
          disabled={formDisabled}
          baselineConfig={baselineConfig}
          onRefresh={() => void loadMeta(true)}
        />
      ) : null}
      {currentStep === 1 ? renderStepCluster() : null}
      {currentStep === 2 ? renderStepPoolAndSc() : null}
      {currentStep === 3 ? renderStepConfirm() : null}

      <WizardFooter>
        {currentStep > 0 ? <Button onClick={handlePrev}>上一步</Button> : <span />}
        {currentStep < WIZARD_STEPS.length - 1 ? (
          <Button type="primary" onClick={() => void handleNext()}>
            下一步
          </Button>
        ) : (
          <Button type="primary" loading={submitting} onClick={() => void openSubmitConfirm()}>
            {submitActionLabel}
          </Button>
        )}
      </WizardFooter>
    </Card>
  );

  const renderOperatePanel = () => (
    <Tabs
      activeKey={operateTabKey}
      onChange={(key) => setOperateTabKey(key as 'expand' | 'config')}
      items={[
        {
          key: 'expand',
          label: '扩容存储',
          children: (
            <>
              <Alert
                {...OPERATE_TAB_INFO_ALERT_PROPS}
                message="扩容：新增节点与数据盘"
                description="仅可新增存储节点或勾选新数据盘；已部署的 OSD 不可移除或改配。"
                action={
                  <Space wrap size={8}>
                    <Button loading={metaLoading} disabled={formDisabled} onClick={() => void loadMeta(true)}>
                      刷新磁盘
                    </Button>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      disabled={
                        formDisabled ||
                        nodeOptions.length === 0 ||
                        nodeOptions.every((o) => expandUsedNodeNames.has(o.value))
                      }
                      onClick={() => {
                        const add = expandListOpsRef.current?.add;
                        if (add) addHarvesterAddonNodeRow(add, nodeOptions, watchedExpandNodes);
                      }}
                    >
                      添加节点
                    </Button>
                  </Space>
                }
              />
              <div style={OPERATE_TAB_BODY_STYLE}>
                <NodeDiskAssignmentEditor
                  form={form}
                  nodeOptions={nodeOptions}
                  blockDevicesRaw={blockDevicesRaw}
                  metaLoading={metaLoading}
                  disabled={formDisabled}
                  baselineConfig={baselineConfig}
                  onRefresh={() => void loadMeta(true)}
                  expansionMode
                  listOpsRef={expandListOpsRef}
                />
              </div>
              <WizardFooter>
                <span />
                <Button type="primary" loading={submitting} onClick={() => void openSubmitConfirm()}>
                  {submitActionLabel}
                </Button>
              </WizardFooter>
            </>
          ),
        },
        {
          key: 'config',
          label: '配置详情',
          children: (
            <>
              <Alert
                {...OPERATE_TAB_INFO_ALERT_PROPS}
                message="集群级参数已锁定"
                description="副本数、管理节点、镜像版本等已在首次部署时确定。如需调整请联系运维在维护窗口处理；日常仅支持在「扩容存储」中新增节点或数据盘。"
              />
              <div style={OPERATE_TAB_BODY_STYLE}>
                <ConfigSummaryDescriptions
                  values={getWizardFormValues()}
                  blockDevicesRaw={blockDevicesRaw}
                  column={2}
                />
              </div>
            </>
          ),
        },
      ]}
    />
  );

  return (
    <PageDetailSection contentPadding={16} autoStyleInputs>
      <AddonStatusOverview
        status={status}
        loading={statusLoading}
        isRunningCluster={isRunningCluster}
      />

      {status?.phase === 'failed' ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="上次部署未成功"
          description={status.message || '请修正配置后重新提交，或在集群侧查看 Addon / Rook 事件。'}
        />
      ) : null}

      <Form
        key={`${cloudId}-${formInitKey}`}
        form={form}
        layout="vertical"
        disabled={formDisabled}
        initialValues={formInitialValues}
        preserve
      >
        {renderHiddenFields()}
        {isRunningCluster ? renderOperatePanel() : renderProvisionWizard()}
      </Form>

      <Drawer
        title="专家模式"
        width={640}
        open={expertDrawerOpen}
        destroyOnClose
        onClose={() => setExpertDrawerOpen(false)}
        extra={
          <Button type="primary" loading={submitting} onClick={() => void openSubmitConfirm()}>
            {submitActionLabel}
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="手动 YAML 将绕过向导校验"
          description="仅适用于需要完全自定义 rook-ceph Addon values 的场景。填写后将忽略向导中的全部选项，错误配置需自行承担后果。"
        />
        <Form.Item
          name="valuesContentOverride"
          label="Addon values（YAML）"
          extra="留空则根据向导自动生成配置。"
        >
          <Input.TextArea rows={18} placeholder="留空则根据向导自动生成配置" spellCheck={false} />
        </Form.Item>
      </Drawer>

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
            ? '提交后将向集群应用扩容配置（仅新增 OSD），请确认已核对配置摘要并了解以下风险：'
            : '提交后将向集群应用统一存储配置，请确认已核对配置摘要并了解以下风险：'}
        </Typography.Paragraph>
        {String(getWizardFormValues().valuesContentOverride || '').trim() ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="将使用专家模式 YAML 提交"
            description="向导中的选项将被忽略，请确认 YAML 内容正确。"
          />
        ) : (
          <div style={{ marginBottom: 16 }}>
            <ConfigSummaryDescriptions
              values={getWizardFormValues()}
              blockDevicesRaw={blockDevicesRaw}
              column={1}
            />
          </div>
        )}
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
