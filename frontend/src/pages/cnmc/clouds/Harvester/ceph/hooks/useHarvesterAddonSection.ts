import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { Form, message } from 'antd';
import type { FormInstance } from 'antd/es/form';
import { useSearchParams } from 'react-router-dom';
import { applyCephHarvesterAddon } from '../../../../../../services/cephApi';
import { confirmHighRiskOperation } from '../../shared/lib/highRiskConfirm';
import type { CephStorageNetworkEditorHandle } from '../sections/harvesterAddon/CephStorageNetworkCard';
import {
  EXPANSION_SUBMIT_RISK_ITEMS,
  SUBMIT_RISK_ITEMS,
  WIZARD_STEPS,
  parseHarvesterAddonOperateTabKey,
  type HarvesterAddonOperateTabKey,
} from '../sections/harvesterAddon/addonUiConstants';
import { buildAddonSubmitConfirmExtra } from '../sections/harvesterAddon/AddonSubmitConfirmExtra';
import { runHarvesterSectionRefresh, type HarvesterSectionOnRefresh } from '../lib/cephSectionRefresh';
import {
  createMetadataDeviceSizeLookup,
  formValuesToApplyConfig,
  validateAddonConfig,
  validateNodeMetadataDeviceRows,
  validateRunningClusterConfigChange,
} from '../lib/cephHarvesterAddon';
import { summarizeNodeDevices, type HarvesterAddonFormValues } from './harvesterAddonFormTypes';
import { useHarvesterAddonSectionData } from './useHarvesterAddonSectionData';

export type UseHarvesterAddonSectionParams = {
  cloudId: string;
  form: FormInstance<HarvesterAddonFormValues>;
  onRefresh?: HarvesterSectionOnRefresh;
  onDeployed?: () => void;
  storageNetworkRef: RefObject<CephStorageNetworkEditorHandle | null>;
  initialOperateTab?: HarvesterAddonOperateTabKey;
};

export function useHarvesterAddonSection({
  cloudId,
  form,
  onRefresh,
  onDeployed,
  storageNetworkRef,
  initialOperateTab,
}: UseHarvesterAddonSectionParams) {
  const data = useHarvesterAddonSectionData({ cloudId, form, onRefresh, onDeployed });
  const [searchParams] = useSearchParams();
  const operateTabFromQuery = parseHarvesterAddonOperateTabKey(searchParams.get('operateTab'));

  const [currentStep, setCurrentStep] = useState(0);
  const [operateTabKey, setOperateTabKey] = useState<HarvesterAddonOperateTabKey>('config');
  const [submitting, setSubmitting] = useState(false);
  const [expertDrawerOpen, setExpertDrawerOpen] = useState(false);

  useEffect(() => {
    setCurrentStep(0);
    setOperateTabKey(initialOperateTab ?? operateTabFromQuery ?? 'config');
  }, [cloudId, initialOperateTab, operateTabFromQuery]);

  const watchedExpandNodes = Form.useWatch(['cephCluster', 'nodes'], form);
  const expandUsedNodeNames = useMemo(
    () =>
      new Set(
        (watchedExpandNodes || []).map((r) => r?.nodeName).filter(Boolean) as string[],
      ),
    [watchedExpandNodes],
  );
  const formDisabled = submitting || data.metaLoading || data.status?.phase === 'progress';
  const configLocked = data.isRunningCluster;
  const submitActionLabel = data.isRunningCluster
    ? '提交扩容'
    : data.status?.exists
      ? '保存并应用'
      : '开启统一存储';
  const submitRiskItems = data.isRunningCluster ? EXPANSION_SUBMIT_RISK_ITEMS : SUBMIT_RISK_ITEMS;

  const getWizardFormValues = useCallback((): HarvesterAddonFormValues => {
    return form.getFieldsValue(true) as HarvesterAddonFormValues;
  }, [form]);

  const lookupMetadataDeviceSizeMB = useMemo(
    () => createMetadataDeviceSizeLookup(data.blockDevicesRaw),
    [data.blockDevicesRaw],
  );

  const validateWizardStep = useCallback(
    async (step: number) => {
      if (step === 0) {
        const saved = await storageNetworkRef.current?.validateAndSave();
        if (saved === false) {
          throw new Error('请完成存储网配置');
        }
        return;
      }
      if (step === 1) {
        const nodes = form.getFieldValue(['cephCluster', 'nodes']) as
          | HarvesterAddonFormValues['cephCluster']['nodes']
          | undefined;
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
        const metadataPaths = nodes.flatMap((row, index) => {
          if (!String(row?.metadataDevice ?? '').trim()) return [];
          return [['cephCluster', 'nodes', index, 'databaseSizeMB'] as const];
        });
        if (metadataPaths.length > 0) {
          await form.validateFields(metadataPaths);
        }
        const metadataError = validateNodeMetadataDeviceRows(nodes, lookupMetadataDeviceSizeMB);
        if (metadataError) {
          throw new Error(metadataError);
        }
        return;
      }
      if (step === 2) {
        await form.validateFields([
          ['cephCluster', 'monCount'],
          ['cephCluster', 'mgrCount'],
          ['cephCluster', 'dashboardEnabled'],
        ]);
        return;
      }
      if (step === 3) {
        await form.validateFields([
          'replicaSize',
          'compressionMode',
          ['storageClass', 'reclaimPolicy'],
          ['storageClass', 'allowVolumeExpansion'],
          ['storageClass', 'volumeBindingMode'],
        ]);
      }
    },
    [form, lookupMetadataDeviceSizeMB, storageNetworkRef],
  );

  const handleNext = useCallback(async () => {
    try {
      await validateWizardStep(currentStep);
      setCurrentStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
    } catch (e) {
      if (e instanceof Error && e.message) message.warning(e.message);
    }
  }, [currentStep, validateWizardStep]);

  const handlePrev = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleStepChange = useCallback((next: number) => {
    setCurrentStep((current) => (next < current ? next : current));
  }, []);

  const handleReplicaSizeChange = useCallback(
    (value: number | null) => {
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
    },
    [form],
  );

  const executeSubmit = useCallback(
    async (password: string) => {
      if (!cloudId || !password) {
        message.warning('请输入管理员密码');
        return;
      }
      setSubmitting(true);
      try {
        if (!data.isRunningCluster) {
          const saved = await storageNetworkRef.current?.validateAndSave();
          if (saved === false) {
            setCurrentStep(0);
            throw new Error('storage network save failed');
          }
        }

        const values = getWizardFormValues();
        const overrideYaml = String(values.valuesContentOverride || '').trim();

        if (data.isRunningCluster && overrideYaml) {
          message.warning('已运行集群不支持专家 YAML 覆盖，请使用向导扩容');
          throw new Error('expert yaml not allowed');
        }

        if (overrideYaml) {
          const res = await applyCephHarvesterAddon(cloudId, {
            valuesContent: overrideYaml,
            password,
          });
          if (!res.ok || !res.data) {
            message.error(res.error || '提交失败');
            throw new Error(res.error || '提交失败');
          }
          setExpertDrawerOpen(false);
          data.setStatus(res.data);
          data.prevPhaseRef.current = res.data.phase;
          data.applyStatusToForm(res.data);
          message.success(
            res.data.applied === 'created' ? '已提交开启统一存储' : '已更新存储配置',
          );
          if (res.data.phase === 'success') onDeployed?.();
          else void runHarvesterSectionRefresh(data.sectionOnRefresh, { force: true, silent: true });
          return;
        }

        const config = formValuesToApplyConfig(values);
        const validationError = validateAddonConfig(config, {
          lookupMetadataDeviceSizeMB,
        });
        if (validationError) {
          message.warning(validationError);
          if (!data.isRunningCluster) setCurrentStep(1);
          setOperateTabKey('expand');
          throw new Error(validationError);
        }

        if (data.isRunningCluster && data.status?.config) {
          const expansionError = validateRunningClusterConfigChange(data.status.config, config);
          if (expansionError) {
            message.warning(expansionError);
            setOperateTabKey('expand');
            throw new Error(expansionError);
          }
        }

        const res = await applyCephHarvesterAddon(cloudId, { config, password });
        if (!res.ok || !res.data) {
          message.error(res.error || '提交失败');
          throw new Error(res.error || '提交失败');
        }
        data.setStatus(res.data);
        data.prevPhaseRef.current = res.data.phase;
        data.applyStatusToForm(res.data);
        message.success(
          res.data.applied === 'created'
            ? '已提交开启统一存储'
            : data.isRunningCluster
              ? '已提交扩容'
              : '已更新存储配置',
        );
        if (res.data.phase === 'success') onDeployed?.();
        else void runHarvesterSectionRefresh(data.sectionOnRefresh, { force: true, silent: true });
      } finally {
        setSubmitting(false);
      }
    },
    [
      cloudId,
      data,
      getWizardFormValues,
      lookupMetadataDeviceSizeMB,
      onDeployed,
      storageNetworkRef,
    ],
  );

  const openSubmitConfirm = useCallback(async () => {
    if (!cloudId) return;
    if (data.status?.phase === 'progress') {
      message.warning('统一存储正在部署中，请待完成后再提交配置变更');
      return;
    }
    try {
      if (data.isRunningCluster) {
        await validateWizardStep(1);
      } else {
        for (let step = 0; step < WIZARD_STEPS.length - 1; step += 1) {
          await validateWizardStep(step);
        }
      }
      const values = getWizardFormValues();
      void confirmHighRiskOperation({
        title: `确认${submitActionLabel}`,
        description: data.isRunningCluster
          ? '提交后将向集群应用扩容配置（仅新增数据盘），请确认已核对配置摘要并了解以下风险：'
          : '提交后将向集群应用存储配置，请确认已核对配置摘要并了解以下风险：',
        riskItems: submitRiskItems,
        extra: buildAddonSubmitConfirmExtra(values, data.blockDevicesRaw),
        requireAdminPassword: true,
        confirmDanger: false,
        confirmText: submitActionLabel,
        impactAckLabel: '我已阅读并理解上述风险',
        onConfirm: async ({ adminPassword }) => {
          await executeSubmit(adminPassword ?? '');
        },
      }).catch(() => {
        /* 用户取消 */
      });
    } catch (e) {
      if (e instanceof Error && e.message) message.warning(e.message);
    }
  }, [
    cloudId,
    data.blockDevicesRaw,
    data.isRunningCluster,
    data.status?.phase,
    executeSubmit,
    getWizardFormValues,
    submitActionLabel,
    submitRiskItems,
    validateWizardStep,
  ]);

  return {
    formInitKey: data.formInitKey,
    formInitialValues: data.formInitialValues,
    currentStep,
    operateTabKey,
    setOperateTabKey,
    statusLoading: data.statusLoading,
    submitting,
    metaLoading: data.metaLoading,
    expertDrawerOpen,
    setExpertDrawerOpen,
    status: data.status,
    nodeOptions: data.nodeOptions,
    blockDevicesRaw: data.blockDevicesRaw,
    loadMeta: data.loadMeta,
    isRunningCluster: data.isRunningCluster,
    expandUsedNodeNames,
    formDisabled,
    configLocked,
    baselineConfig: data.baselineConfig,
    storageNetwork: data.storageNetwork,
    submitActionLabel,
    getWizardFormValues,
    handleNext,
    handlePrev,
    handleStepChange,
    handleReplicaSizeChange,
    openSubmitConfirm,
    watchedExpandNodes,
  };
}
