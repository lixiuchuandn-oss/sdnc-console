/**
 * 集群 · 存储服务 · 统一存储配置（Cloudmap `cluster/harvester_addon`）。
 */
import React, { useRef } from 'react';
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
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import type { FormListOperation } from 'antd/es/form';
import { PlusOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import type { HarvesterSectionOnRefresh } from '../lib/cephSectionRefresh';
import { useHarvesterAddonSection } from '../hooks/useHarvesterAddonSection';
import type { HarvesterAddonFormValues } from '../hooks/harvesterAddonFormTypes';
import AddonStatusOverview from './harvesterAddon/AddonStatusOverview';
import AddonSubmitConfirmModal from './harvesterAddon/AddonSubmitConfirmModal';
import CephStorageNetworkCard, {
  type CephStorageNetworkEditorHandle,
} from './harvesterAddon/CephStorageNetworkCard';
import ConfigSummaryDescriptions from './harvesterAddon/ConfigSummaryDescriptions';
import FormSection from './harvesterAddon/FormSection';
import NodeDiskAssignmentEditor from './harvesterAddon/NodeDiskAssignmentEditor';
import WizardFooter from './harvesterAddon/WizardFooter';
import {
  COMPRESSION_OPTIONS,
  OSD_STORE_OPTIONS,
  RECLAIM_POLICY_OPTIONS,
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

const CephHarvesterAddonSection: React.FC<CephHarvesterAddonSectionProps> = ({
  cloudId,
  onRefresh,
  onDeployed,
}) => {
  const [form] = Form.useForm<HarvesterAddonFormValues>();
  const expandListOpsRef = useRef<FormListOperation | null>(null);
  const storageNetworkRef = useRef<CephStorageNetworkEditorHandle | null>(null);

  const ctrl = useHarvesterAddonSection({
    cloudId,
    form,
    onRefresh,
    onDeployed,
    storageNetworkRef,
  });

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
                disabled={ctrl.configLocked}
                onChange={ctrl.handleReplicaSizeChange}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} lg={10}>
            <Form.Item name="compressionMode" label="数据压缩">
              <Select options={COMPRESSION_OPTIONS} disabled={ctrl.configLocked} />
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
              <Select options={RECLAIM_POLICY_OPTIONS} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} lg={10}>
            <Form.Item name={['storageClass', 'volumeBindingMode']} label="存储空间分配时机">
              <Select options={VOLUME_BINDING_OPTIONS} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} lg={10}>
            <Form.Item
              name={['storageClass', 'allowVolumeExpansion']}
              label="允许在线扩容"
              valuePropName="checked"
            >
              <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={ctrl.configLocked} />
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
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" disabled={ctrl.configLocked} />
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
              <InputNumber min={1} max={7} style={{ width: '100%' }} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8} lg={6}>
            <Form.Item name={['cephCluster', 'mgrCount']} label="调度服务数量">
              <InputNumber min={1} max={7} style={{ width: '100%' }} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8} lg={6}>
            <Form.Item
              name={['cephCluster', 'dashboardEnabled']}
              label="内置监控面板"
              valuePropName="checked"
            >
              <Switch checkedChildren="启用" unCheckedChildren="关闭" disabled={ctrl.configLocked} />
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
                      <Input disabled={ctrl.configLocked} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={10}>
                    <Form.Item name={['cephCluster', 'osdObjectstore']} label="磁盘存储引擎">
                      <Select options={OSD_STORE_OPTIONS} disabled={ctrl.configLocked} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={10}>
                    <Form.Item name={['cephCluster', 'metadataDevice']} label="集群级元数据盘（可选）">
                      <Input placeholder="留空使用默认" disabled={ctrl.configLocked} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} lg={10}>
                    <Form.Item
                      name={['cephCluster', 'allowMultipleMonPerNode']}
                      label="允许同一节点部署多个管理节点"
                      valuePropName="checked"
                    >
                      <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={ctrl.configLocked} />
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
        <ConfigSummaryDescriptions
          values={ctrl.getWizardFormValues()}
          blockDevicesRaw={ctrl.blockDevicesRaw}
          column={2}
        />
      </FormSection>
      {!ctrl.configLocked ? (
        <Typography.Link onClick={() => ctrl.setExpertDrawerOpen(true)} style={{ fontSize: 13 }}>
          专家模式（手动编辑 YAML）
        </Typography.Link>
      ) : null}
    </>
  );

  const renderStepStorageNetwork = () => (
    <CephStorageNetworkCard
      ref={storageNetworkRef}
      cloudId={cloudId}
      variant="wizard"
      readOnly={ctrl.formDisabled}
    />
  );

  const renderProvisionWizard = () => (
    <Card size="small" styles={{ body: { padding: '20px 24px 8px' } }}>
      <Steps
        current={ctrl.currentStep}
        items={WIZARD_STEPS.map((step) => ({ title: step.title, description: step.description }))}
        onChange={ctrl.handleStepChange}
        style={{ marginBottom: 28 }}
      />
      {ctrl.currentStep === 0 ? renderStepStorageNetwork() : null}
      {ctrl.currentStep === 1 ? (
        <NodeDiskAssignmentEditor
          form={form}
          nodeOptions={ctrl.nodeOptions}
          blockDevicesRaw={ctrl.blockDevicesRaw}
          metaLoading={ctrl.metaLoading}
          disabled={ctrl.formDisabled}
          baselineConfig={ctrl.baselineConfig}
          onRefresh={() => void ctrl.loadMeta(true)}
        />
      ) : null}
      {ctrl.currentStep === 2 ? renderStepCluster() : null}
      {ctrl.currentStep === 3 ? renderStepPoolAndSc() : null}
      {ctrl.currentStep === 4 ? renderStepConfirm() : null}

      <WizardFooter>
        {ctrl.currentStep > 0 ? <Button onClick={ctrl.handlePrev}>上一步</Button> : <span />}
        {ctrl.currentStep < WIZARD_STEPS.length - 1 ? (
          <Button type="primary" onClick={() => void ctrl.handleNext()}>
            下一步
          </Button>
        ) : (
          <Button type="primary" loading={ctrl.submitting} onClick={() => void ctrl.openSubmitConfirm()}>
            {ctrl.submitActionLabel}
          </Button>
        )}
      </WizardFooter>
    </Card>
  );

  const renderOperatePanel = () => (
    <Tabs
      activeKey={ctrl.operateTabKey}
      onChange={(key) => ctrl.setOperateTabKey(key as 'expand' | 'config')}
      items={[
        {
          key: 'expand',
          label: '扩容存储',
          children: (
            <>
              <Alert
                {...OPERATE_TAB_INFO_ALERT_PROPS}
                message="扩容：新增节点与数据盘"
                description="仅可新增存储节点或勾选新数据盘；已纳入集群的磁盘不可移除或改配。"
                action={
                  <Space wrap size={8}>
                    <Button
                      loading={ctrl.metaLoading}
                      disabled={ctrl.formDisabled}
                      onClick={() => void ctrl.loadMeta(true)}
                    >
                      刷新磁盘
                    </Button>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      disabled={
                        ctrl.formDisabled ||
                        ctrl.nodeOptions.length === 0 ||
                        ctrl.nodeOptions.every((o) => ctrl.expandUsedNodeNames.has(o.value))
                      }
                      onClick={() => {
                        const add = expandListOpsRef.current?.add;
                        if (add) addHarvesterAddonNodeRow(add, ctrl.nodeOptions, ctrl.watchedExpandNodes);
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
                  nodeOptions={ctrl.nodeOptions}
                  blockDevicesRaw={ctrl.blockDevicesRaw}
                  metaLoading={ctrl.metaLoading}
                  disabled={ctrl.formDisabled}
                  baselineConfig={ctrl.baselineConfig}
                  onRefresh={() => void ctrl.loadMeta(true)}
                  expansionMode
                  listOpsRef={expandListOpsRef}
                />
              </div>
              <WizardFooter>
                <span />
                <Button type="primary" loading={ctrl.submitting} onClick={() => void ctrl.openSubmitConfirm()}>
                  {ctrl.submitActionLabel}
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
                  values={ctrl.getWizardFormValues()}
                  blockDevicesRaw={ctrl.blockDevicesRaw}
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
    <PageDetailSection contentPadding={16} autoStyleInputs onRefresh={ctrl.handleToolbarRefresh}>
      <AddonStatusOverview
        status={ctrl.status}
        loading={ctrl.statusLoading}
        isRunningCluster={ctrl.isRunningCluster}
      />

      {ctrl.isRunningCluster ? (
        <CephStorageNetworkCard cloudId={cloudId} readOnly variant="card" />
      ) : null}

      {ctrl.status?.phase === 'failed' ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="上次部署未成功"
          description={ctrl.status.message || '请修正配置后重新提交，或在集群侧查看部署事件与日志。'}
        />
      ) : null}

      <Form
        key={`${cloudId}-${ctrl.formInitKey}`}
        form={form}
        layout="vertical"
        disabled={ctrl.formDisabled}
        initialValues={ctrl.formInitialValues}
        preserve
      >
        {renderHiddenFields()}
        {ctrl.isRunningCluster ? renderOperatePanel() : renderProvisionWizard()}
      </Form>

      <Drawer
        title="专家模式"
        width={640}
        open={ctrl.expertDrawerOpen}
        destroyOnClose
        onClose={() => ctrl.setExpertDrawerOpen(false)}
        extra={
          <Button type="primary" loading={ctrl.submitting} onClick={() => void ctrl.openSubmitConfirm()}>
            {ctrl.submitActionLabel}
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="手动 YAML 将绕过向导校验"
          description="仅适用于需要完全自定义部署参数的场景。填写后将忽略向导中的全部选项，错误配置需自行承担后果。"
        />
        <Form.Item
          name="valuesContentOverride"
          label="部署参数（YAML）"
          extra="留空则根据向导自动生成配置。"
        >
          <Input.TextArea rows={18} placeholder="留空则根据向导自动生成配置" spellCheck={false} />
        </Form.Item>
      </Drawer>

      <AddonSubmitConfirmModal
        open={ctrl.submitConfirmOpen}
        title={`确认${ctrl.submitActionLabel}`}
        okText={ctrl.submitActionLabel}
        isRunningCluster={ctrl.isRunningCluster}
        submitting={ctrl.submitting}
        submitConfirmReady={ctrl.submitConfirmReady}
        submitRiskAck={ctrl.submitRiskAck}
        onSubmitRiskAckChange={ctrl.setSubmitRiskAck}
        submitAdminPassword={ctrl.submitAdminPassword}
        onSubmitAdminPasswordChange={ctrl.setSubmitAdminPassword}
        submitRiskItems={ctrl.submitRiskItems}
        values={ctrl.getWizardFormValues()}
        blockDevicesRaw={ctrl.blockDevicesRaw}
        onCancel={ctrl.closeSubmitConfirm}
        onOk={() => void ctrl.executeSubmit()}
      />
    </PageDetailSection>
  );
};

export default CephHarvesterAddonSection;
