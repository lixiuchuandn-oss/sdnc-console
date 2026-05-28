import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form, message } from 'antd';
import type { FormInstance } from 'antd/es/form';
import {
  applyCephHarvesterAddon,
  fetchCephHarvesterAddon,
  type CephHarvesterAddonStatusResponse,
} from '../../../../../../services/cephApi';
import { fetchBlockDevices, fetchNodeResources } from '../../../../../../services/monitoringApi';
import type { CephStorageNetworkEditorHandle } from '../sections/harvesterAddon/CephStorageNetworkCard';
import {
  EXPANSION_SUBMIT_RISK_ITEMS,
  SUBMIT_RISK_ITEMS,
  WIZARD_STEPS,
} from '../sections/harvesterAddon/addonUiConstants';
import {
  createHarvesterToolbarRefresh,
  mergeCephSectionOnRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cephSectionRefresh';
import {
  buildAllNodesEmptyDeviceRows,
  buildDefaultHarvesterAddonFormValues,
  buildHarvesterAddonFormValuesFromStatus,
  formValuesToApplyConfig,
  isCephHarvesterAddonRunning,
  isDefaultEmptyWizardNodeRows,
  parseNodeNameOptions,
  validateAddonConfig,
  validateRunningClusterConfigChange,
} from '../lib/cephHarvesterAddon';
import { summarizeNodeDevices, type HarvesterAddonFormValues } from './harvesterAddonFormTypes';

export type UseHarvesterAddonSectionParams = {
  cloudId: string;
  form: FormInstance<HarvesterAddonFormValues>;
  onRefresh?: HarvesterSectionOnRefresh;
  onDeployed?: () => void;
  storageNetworkRef: React.RefObject<CephStorageNetworkEditorHandle | null>;
};

export function useHarvesterAddonSection({
  cloudId,
  form,
  onRefresh,
  onDeployed,
  storageNetworkRef,
}: UseHarvesterAddonSectionParams) {
  const [formInitKey, setFormInitKey] = useState(0);
  const [formInitialValues, setFormInitialValues] = useState<HarvesterAddonFormValues>(() =>
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
  const [status, setStatus] = useState<CephHarvesterAddonStatusResponse | null>(null);
  const [nodeOptions, setNodeOptions] = useState<{ label: string; value: string }[]>([]);
  const [blockDevicesRaw, setBlockDevicesRaw] = useState<unknown>(null);

  const pollRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<CephHarvesterAddonStatusResponse['phase'] | null>(null);
  const disabledNodesSeededRef = useRef(false);
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
      if (res.phase === 'disabled') {
        disabledNodesSeededRef.current = false;
        const currentNodes = form.getFieldValue(['cephCluster', 'nodes']) as
          | HarvesterAddonFormValues['cephCluster']['nodes']
          | undefined;
        if (!isDefaultEmptyWizardNodeRows(currentNodes)) {
          return;
        }
      }
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

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(sectionOnRefresh),
    [sectionOnRefresh],
  );

  useEffect(() => {
    prevPhaseRef.current = null;
    disabledNodesSeededRef.current = false;
    setCurrentStep(0);
    setOperateTabKey('expand');
    const defaults = buildDefaultHarvesterAddonFormValues();
    setFormInitialValues(defaults);
    setFormInitKey((k) => k + 1);
    void sectionOnRefresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 cloudId 切换时初始化
  }, [cloudId]);

  useEffect(() => {
    if (status?.phase !== 'disabled') {
      disabledNodesSeededRef.current = false;
      return;
    }
    if (disabledNodesSeededRef.current || nodeOptions.length === 0 || metaLoading) return;
    const currentNodes = form.getFieldValue(['cephCluster', 'nodes']) as
      | HarvesterAddonFormValues['cephCluster']['nodes']
      | undefined;
    if (!isDefaultEmptyWizardNodeRows(currentNodes)) return;

    const base = buildHarvesterAddonFormValuesFromStatus({ phase: 'disabled' });
    const nodes = buildAllNodesEmptyDeviceRows(nodeOptions);
    const next = {
      ...base,
      cephCluster: { ...base.cephCluster, nodes },
    };
    form.setFieldsValue(next);
    setFormInitialValues(next);
    setFormInitKey((k) => k + 1);
    disabledNodesSeededRef.current = true;
  }, [form, metaLoading, nodeOptions, status?.phase]);

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

  const isRunningCluster = isCephHarvesterAddonRunning(status);
  const watchedExpandNodes = Form.useWatch(['cephCluster', 'nodes'], form);
  const expandUsedNodeNames = useMemo(
    () =>
      new Set(
        (watchedExpandNodes || []).map((r) => r?.nodeName).filter(Boolean) as string[],
      ),
    [watchedExpandNodes],
  );
  const formDisabled = submitting || metaLoading || status?.phase === 'progress';
  const configLocked = isRunningCluster;
  const baselineConfig = isRunningCluster ? status?.config ?? null : null;
  const submitActionLabel = isRunningCluster
    ? '提交扩容'
    : status?.exists
      ? '保存并应用'
      : '开启统一存储';
  const submitRiskItems = isRunningCluster ? EXPANSION_SUBMIT_RISK_ITEMS : SUBMIT_RISK_ITEMS;
  const submitConfirmReady = submitRiskAck && submitAdminPassword.trim().length > 0;

  const getWizardFormValues = useCallback((): HarvesterAddonFormValues => {
    return form.getFieldsValue(true) as HarvesterAddonFormValues;
  }, [form]);

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
    [form, storageNetworkRef],
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

  const closeSubmitConfirm = useCallback(() => {
    setSubmitConfirmOpen(false);
    setSubmitRiskAck(false);
    setSubmitAdminPassword('');
  }, []);

  const openSubmitConfirm = useCallback(async () => {
    if (!cloudId) return;
    if (status?.phase === 'progress') {
      message.warning('统一存储正在部署中，请待完成后再提交配置变更');
      return;
    }
    try {
      if (isRunningCluster) {
        await validateWizardStep(1);
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
  }, [cloudId, isRunningCluster, status?.phase, validateWizardStep]);

  const executeSubmit = useCallback(async () => {
    const password = submitAdminPassword.trim();
    if (!cloudId || !submitRiskAck || !password) {
      message.warning('请勾选风险确认并输入管理员密码');
      return;
    }
    setSubmitting(true);
    try {
      if (!isRunningCluster) {
        const saved = await storageNetworkRef.current?.validateAndSave();
        if (saved === false) {
          setCurrentStep(0);
          return;
        }
      }

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
        else void runHarvesterSectionRefresh(sectionOnRefresh, { force: true, silent: true });
        return;
      }

      const config = formValuesToApplyConfig(values);
      const validationError = validateAddonConfig(config);
      if (validationError) {
        message.warning(validationError);
        if (!isRunningCluster) setCurrentStep(1);
        setOperateTabKey('expand');
        return;
      }

      if (isRunningCluster && status?.config) {
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
      else void runHarvesterSectionRefresh(sectionOnRefresh, { force: true, silent: true });
    } catch {
      /* 表单校验 */
    } finally {
      setSubmitting(false);
    }
  }, [
    applyStatusToForm,
    closeSubmitConfirm,
    cloudId,
    getWizardFormValues,
    isRunningCluster,
    sectionOnRefresh,
    status?.config,
    storageNetworkRef,
    submitAdminPassword,
    submitRiskAck,
  ]);

  return {
    formInitKey,
    formInitialValues,
    currentStep,
    operateTabKey,
    setOperateTabKey,
    statusLoading,
    submitting,
    submitConfirmOpen,
    submitRiskAck,
    setSubmitRiskAck,
    submitAdminPassword,
    setSubmitAdminPassword,
    metaLoading,
    expertDrawerOpen,
    setExpertDrawerOpen,
    status,
    nodeOptions,
    blockDevicesRaw,
    handleToolbarRefresh,
    loadMeta,
    isRunningCluster,
    expandUsedNodeNames,
    formDisabled,
    configLocked,
    baselineConfig,
    submitActionLabel,
    submitRiskItems,
    submitConfirmReady,
    getWizardFormValues,
    handleNext,
    handlePrev,
    handleStepChange,
    handleReplicaSizeChange,
    closeSubmitConfirm,
    openSubmitConfirm,
    executeSubmit,
    watchedExpandNodes,
  };
}
