/**
 * 集群 · 存储服务 · 统一存储配置（Cloudmap `cluster/harvester_addon`）。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Steps,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import type { FormListOperation } from 'antd/es/form';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import {
  canReadStorageConfigPage,
  CLOUD_STORAGE_ADDON_WRITE,
  CLOUD_STORAGE_CONFIG_PAGE_WRITE,
  LEGACY_CLOUD_STORAGE_DRS_WRITE,
  LEGACY_CLOUD_UNIFIED_STORAGE_POOLS_WRITE,
} from '../../../../../../constants/unifiedStoragePermissions';
import { useStorageDrsData } from '../../cluster/hooks/useStorageDrsData';
import StorageDrsPolicyPanel from '../../cluster/sections/storageDrs/StorageDrsPolicyPanel';
import StorageDrsTasksPanel from '../../cluster/sections/storageDrs/StorageDrsTasksPanel';
import type { HarvesterSectionOnRefresh } from '../lib/cephSectionRefresh';
import { useHarvesterAddonSection } from '../hooks/useHarvesterAddonSection';
import type { HarvesterAddonFormValues } from '../hooks/harvesterAddonFormTypes';
import AddonConfigDetailPanel from './harvesterAddon/AddonConfigDetailPanel';
import AddonStatusOverview from './harvesterAddon/AddonStatusOverview';
import CephStorageNetworkCard, {
  type CephStorageNetworkEditorHandle,
} from './harvesterAddon/CephStorageNetworkCard';
import { confirmHighRiskOperation } from '../../shared/lib/highRiskConfirm';
import { CEPH_STORAGE_NETWORK_CHANGE_RISK_ITEMS } from '../../shared/lib/highRiskOperationPresets';
import ConfigSummaryDescriptions from './harvesterAddon/ConfigSummaryDescriptions';
import CephPoolSection from './CephPoolSection';
import FormSection from './harvesterAddon/FormSection';
import HarvesterAddonAdvancedCollapse from './harvesterAddon/HarvesterAddonAdvancedCollapse';
import HarvesterAddonWizardFormStack from './harvesterAddon/HarvesterAddonWizardFormStack';
import HarvesterAddonOperateTabShell, {
  OperateTabRefreshButton,
} from './harvesterAddon/HarvesterAddonOperateTabShell';
import HarvesterAddonWizardStepShell from './harvesterAddon/HarvesterAddonWizardStepShell';
import NodeDiskAssignmentEditor from './harvesterAddon/NodeDiskAssignmentEditor';
import WizardFooter from './harvesterAddon/WizardFooter';
import {
  COMPRESSION_OPTIONS,
  OSD_STORE_OPTIONS,
  RECLAIM_POLICY_OPTIONS,
  VOLUME_BINDING_OPTIONS,
  WIZARD_CARD_BODY_STYLES,
  ADDON_WIZARD_CARD_CLASS,
  WIZARD_STEP_INFO_MESSAGES,
  WIZARD_STEPS,
  WIZARD_STEPS_STYLE,
  OPERATE_TAB_BODY_STYLE,
  OPERATE_TAB_EXTRA_ALERT_STYLE,
  OPERATE_TAB_FIELD_COL_PROPS,
  OPERATE_TAB_FIELD_COL_THIRD_PROPS,
  OPERATE_TAB_FIELD_ROW_GUTTER,
  type HarvesterAddonOperateTabKey,
} from './harvesterAddon/addonUiConstants';
import { addHarvesterAddonNodeRow } from './harvesterAddon/nodeDiskAssignmentUtils';

export type CephHarvesterAddonSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  /** 嵌入存储配置 Hub 时省略外层壳层与 Hero */
  embedInHub?: boolean;
  /** Hub 扁平 Tab：仅渲染当前 operateTab 面板，不嵌套 Tabs */
  flatMode?: boolean;
  /** 未部署集群：仅渲染开通向导 */
  wizardOnly?: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  /** 存储池 Tab 刷新（池层 loadTabResource） */
  poolsOnRefresh?: HarvesterSectionOnRefresh;
  onDeployed?: () => void;
  /** 已部署集群默认打开的 Tab（如历史 storage_drs / storage_pools 书签） */
  initialOperateTab?: HarvesterAddonOperateTabKey;
};

const CephHarvesterAddonSection: React.FC<CephHarvesterAddonSectionProps> = ({
  cloudId,
  checkPerm,
  embedInHub = false,
  flatMode = false,
  wizardOnly = false,
  onRefresh,
  poolsOnRefresh,
  onDeployed,
  initialOperateTab,
}) => {
  const canRead = embedInHub ? true : canReadStorageConfigPage(checkPerm);
  const canWrite =
    checkPerm(CLOUD_STORAGE_CONFIG_PAGE_WRITE) ||
    checkPerm(CLOUD_STORAGE_ADDON_WRITE) ||
    checkPerm(LEGACY_CLOUD_STORAGE_DRS_WRITE) ||
    checkPerm(LEGACY_CLOUD_UNIFIED_STORAGE_POOLS_WRITE) ||
    checkPerm('clouds.unified-storage:write');

  const [form] = Form.useForm<HarvesterAddonFormValues>();
  const expandListOpsRef = useRef<FormListOperation | null>(null);
  const wizardListOpsRef = useRef<FormListOperation | null>(null);
  const storageNetworkRef = useRef<CephStorageNetworkEditorHandle | null>(null);
  const operateStorageNetworkRef = useRef<CephStorageNetworkEditorHandle | null>(null);
  const [storageNetworkBusy, setStorageNetworkBusy] = useState({ loading: false, saving: false });

  const ctrl = useHarvesterAddonSection({
    cloudId,
    form,
    onRefresh,
    onDeployed,
    storageNetworkRef,
    initialOperateTab,
  });

  const {
    loading: sdrsLoading,
    overview: sdrsOverview,
    error: sdrsError,
    reload: reloadSdrs,
  } = useStorageDrsData(cloudId, canRead && ctrl.isRunningCluster);

  const sdrsTasks = useMemo(() => sdrsOverview?.tasksRecent ?? [], [sdrsOverview?.tasksRecent]);

  const handleSdrsRefresh = useCallback(() => {
    void reloadSdrs(true);
  }, [reloadSdrs]);

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
    <HarvesterAddonWizardFormStack>
      <FormSection
        title="数据保护"
        description="决定块存储数据的冗余份数。生产环境通常使用 3 副本以兼顾可靠性与性能。"
      >
        <Row gutter={OPERATE_TAB_FIELD_ROW_GUTTER}>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
            <Form.Item
              name="replicaSize"
              label="数据副本数"
              rules={[{ required: true, message: '请输入副本数' }]}
              extra="修改后会同步更新管理/调度节点副本数量。"
            >
              <InputNumber
                min={1}
                max={7}
                disabled={ctrl.configLocked}
                onChange={ctrl.handleReplicaSizeChange}
              />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
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
        <Row gutter={OPERATE_TAB_FIELD_ROW_GUTTER}>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
            <Form.Item name={['storageClass', 'reclaimPolicy']} label="删除云硬盘时">
              <Select options={RECLAIM_POLICY_OPTIONS} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
            <Form.Item name={['storageClass', 'volumeBindingMode']} label="存储空间分配时机">
              <Select options={VOLUME_BINDING_OPTIONS} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
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

      <HarvesterAddonAdvancedCollapse>
        <Form.Item
          name="requireSafeReplicaSize"
          label="启用严格副本数校验"
          valuePropName="checked"
          extra="关闭后允许使用非标准副本数组合，仅在有明确规划时调整。"
        >
          <Switch checkedChildren="启用" unCheckedChildren="关闭" disabled={ctrl.configLocked} />
        </Form.Item>
      </HarvesterAddonAdvancedCollapse>
    </HarvesterAddonWizardFormStack>
  );

  const renderStepCluster = () => (
    <HarvesterAddonWizardFormStack>
      <FormSection title="集群服务">
        <Row gutter={OPERATE_TAB_FIELD_ROW_GUTTER}>
          <Col {...OPERATE_TAB_FIELD_COL_THIRD_PROPS}>
            <Form.Item name={['cephCluster', 'monCount']} label="管理节点数量">
              <InputNumber min={1} max={7} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_THIRD_PROPS}>
            <Form.Item name={['cephCluster', 'mgrCount']} label="调度服务数量">
              <InputNumber min={1} max={7} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_THIRD_PROPS}>
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

      <HarvesterAddonAdvancedCollapse description="影响单盘上的存储进程划分，一般无需修改。">
        <Row gutter={OPERATE_TAB_FIELD_ROW_GUTTER}>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
            <Form.Item name={['cephCluster', 'osdsPerDevice']} label="每盘存储进程数">
              <Input disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
            <Form.Item name={['cephCluster', 'osdObjectstore']} label="磁盘存储引擎">
              <Select options={OSD_STORE_OPTIONS} disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
            <Form.Item name={['cephCluster', 'metadataDevice']} label="集群级元数据盘（可选）">
              <Input placeholder="留空使用默认" disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
          <Col {...OPERATE_TAB_FIELD_COL_PROPS}>
            <Form.Item
              name={['cephCluster', 'allowMultipleMonPerNode']}
              label="允许同一节点部署多个管理节点"
              valuePropName="checked"
            >
              <Switch checkedChildren="允许" unCheckedChildren="禁止" disabled={ctrl.configLocked} />
            </Form.Item>
          </Col>
        </Row>
      </HarvesterAddonAdvancedCollapse>
    </HarvesterAddonWizardFormStack>
  );

  const renderStepConfirm = () => (
    <HarvesterAddonWizardFormStack>
      <FormSection title="配置摘要">
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
    </HarvesterAddonWizardFormStack>
  );

  const renderStepStorageNetwork = () => (
    <CephStorageNetworkCard
      ref={storageNetworkRef}
      cloudId={cloudId}
      variant="wizard"
      readOnly={ctrl.formDisabled}
      onBusyChange={setStorageNetworkBusy}
    />
  );

  const renderWizardStepContent = () => {
    switch (ctrl.currentStep) {
      case 0:
        return renderStepStorageNetwork();
      case 1:
        return (
          <NodeDiskAssignmentEditor
            form={form}
            nodeOptions={ctrl.nodeOptions}
            blockDevicesRaw={ctrl.blockDevicesRaw}
            metaLoading={ctrl.metaLoading}
            disabled={ctrl.formDisabled}
            baselineConfig={ctrl.baselineConfig}
            onRefresh={() => void ctrl.loadMeta(true)}
            expansionMode
            listOpsRef={wizardListOpsRef}
          />
        );
      case 2:
        return renderStepCluster();
      case 3:
        return renderStepPoolAndSc();
      case 4:
        return renderStepConfirm();
      default:
        return null;
    }
  };

  const renderWizardStepAlertActions = () => {
    if (ctrl.currentStep === 0) {
      return (
        <OperateTabRefreshButton
          loading={storageNetworkBusy.loading}
          disabled={ctrl.formDisabled}
          onClick={() => void storageNetworkRef.current?.reload()}
        />
      );
    }
    if (ctrl.currentStep === 1) {
      return (
        <>
          <OperateTabRefreshButton
            label="刷新磁盘"
            loading={ctrl.metaLoading}
            disabled={ctrl.formDisabled}
            onClick={() => void ctrl.loadMeta(true)}
          />
          <Button
            type="default"
            disabled={
              ctrl.formDisabled ||
              ctrl.nodeOptions.length === 0 ||
              ctrl.nodeOptions.every((o) => ctrl.expandUsedNodeNames.has(o.value))
            }
            onClick={() => {
              const add = wizardListOpsRef.current?.add;
              if (add) addHarvesterAddonNodeRow(add, ctrl.nodeOptions, ctrl.watchedExpandNodes);
            }}
          >
            添加节点
          </Button>
        </>
      );
    }
    return null;
  };

  const renderProvisionWizard = () => (
    <Card size="small" className={ADDON_WIZARD_CARD_CLASS} styles={WIZARD_CARD_BODY_STYLES}>
      <Steps
        current={ctrl.currentStep}
        items={WIZARD_STEPS.map((step) => ({ title: step.title, description: step.description }))}
        onChange={ctrl.handleStepChange}
        style={WIZARD_STEPS_STYLE}
      />
      <HarvesterAddonWizardStepShell
        infoMessage={WIZARD_STEP_INFO_MESSAGES[ctrl.currentStep]}
        alertActions={renderWizardStepAlertActions()}
      >
        {renderWizardStepContent()}
      </HarvesterAddonWizardStepShell>

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

  const operateTabItems = [
        {
          key: 'config',
          label: '配置详情',
          children: (
            <AddonConfigDetailPanel
              values={ctrl.getWizardFormValues()}
              blockDevicesRaw={ctrl.blockDevicesRaw}
              storageNetwork={ctrl.storageNetwork}
            />
          ),
        },
        {
          key: 'storage_pools',
          label: '存储池',
          children: (
            <div style={OPERATE_TAB_BODY_STYLE}>
              <CephPoolSection
                cloudId={cloudId}
                applicationsScope="cloud"
                onRefresh={poolsOnRefresh}
              />
            </div>
          ),
        },
        {
          key: 'expand',
          label: '扩容存储',
          children: (
            <HarvesterAddonOperateTabShell
              infoMessage="扩容仅可新增存储节点或数据盘；已纳入集群的磁盘不可移除或改配。"
              alertActions={
                <>
                  <OperateTabRefreshButton
                    label="刷新磁盘"
                    loading={ctrl.metaLoading}
                    disabled={ctrl.formDisabled}
                    onClick={() => void ctrl.loadMeta(true)}
                  />
                  <Button
                    type="default"
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
                </>
              }
              submit={{
                label: ctrl.submitActionLabel,
                loading: ctrl.submitting,
                disabled: ctrl.formDisabled,
                canWrite: true,
                onClick: () => void ctrl.openSubmitConfirm(),
              }}
            >
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
            </HarvesterAddonOperateTabShell>
          ),
        },
        {
          key: 'storage_network',
          label: '变更存储网',
          children: (
            <HarvesterAddonOperateTabShell
              infoMessage="配置专用存储网络；未启用时与集群管理网络共用。变更仅对新部署或扩容生效。"
              alertActions={
                <OperateTabRefreshButton
                  loading={storageNetworkBusy.loading}
                  disabled={!canWrite}
                  onClick={() => void operateStorageNetworkRef.current?.reload()}
                />
              }
              submit={{
                label: '保存存储网配置',
                loading: storageNetworkBusy.saving,
                canWrite,
                disabled: storageNetworkBusy.loading,
                onClick: () => {
                  void confirmHighRiskOperation({
                    title: '确认保存存储网配置',
                    description: '保存后将更新集群存储网络设定，请确认参数无误并了解以下风险：',
                    riskItems: CEPH_STORAGE_NETWORK_CHANGE_RISK_ITEMS,
                    confirmDanger: false,
                    confirmText: '保存存储网配置',
                    impactAckLabel: '我已阅读并理解上述风险',
                    onConfirm: async () => {
                      const saved = await operateStorageNetworkRef.current?.validateAndSave();
                      if (saved === false) {
                        throw new Error('保存存储网配置失败');
                      }
                    },
                  }).catch(() => {
                    /* 用户取消 */
                  });
                },
              }}
            >
              <CephStorageNetworkCard
                ref={operateStorageNetworkRef}
                cloudId={cloudId}
                variant="operate"
                readOnly={!canWrite}
                onBusyChange={setStorageNetworkBusy}
              />
            </HarvesterAddonOperateTabShell>
          ),
        },
        {
          key: 'sdrs_policy',
          label: 'SDRS 策略',
          children: (
            <>
              {sdrsError ? (
                <Alert
                  type="error"
                  showIcon
                  message={sdrsError}
                  style={OPERATE_TAB_EXTRA_ALERT_STYLE}
                />
              ) : null}
              <StorageDrsPolicyPanel
                cloudId={cloudId}
                canWrite={canWrite}
                loading={sdrsLoading}
                overview={sdrsOverview}
                onRefresh={handleSdrsRefresh}
              />
            </>
          ),
        },
        {
          key: 'sdrs_tasks',
          label: `任务日志 (${sdrsTasks.length})`,
          children: (
            <>
              {sdrsError ? (
                <Alert type="error" showIcon message={sdrsError} style={{ marginBottom: 16 }} />
              ) : null}
              <StorageDrsTasksPanel
                cloudId={cloudId}
                canWrite={canWrite}
                loading={sdrsLoading}
                tasks={sdrsTasks}
                onRefresh={handleSdrsRefresh}
              />
            </>
          ),
        },
  ] as const;

  const renderOperatePanel = () => {
    if (flatMode) {
      const active = operateTabItems.find((item) => item.key === ctrl.operateTabKey);
      return active?.children ?? null;
    }
    return (
      <Tabs
        activeKey={ctrl.operateTabKey}
        onChange={(key) => ctrl.setOperateTabKey(key as HarvesterAddonOperateTabKey)}
        items={operateTabItems.map(({ key, label, children }) => ({ key, label, children }))}
      />
    );
  };

  const body = (
    <>
      {!embedInHub ? (
        <AddonStatusOverview
          status={ctrl.status}
          loading={ctrl.statusLoading}
          isRunningCluster={ctrl.isRunningCluster}
        />
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
        {wizardOnly
          ? renderProvisionWizard()
          : ctrl.isRunningCluster
            ? renderOperatePanel()
            : renderProvisionWizard()}
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
    </>
  );

  if (!canRead) {
    if (embedInHub) {
      return <Alert type="warning" showIcon message="无权限查看存储配置" />;
    }
    return (
      <PageDetailSection contentPadding={16}>
        <Alert type="warning" showIcon message="无权限查看存储配置" />
      </PageDetailSection>
    );
  }

  if (embedInHub) {
    return body;
  }

  return (
    <PageDetailSection contentPadding={16} autoStyleInputs={false}>
      {body}
    </PageDetailSection>
  );
};

export default CephHarvesterAddonSection;
