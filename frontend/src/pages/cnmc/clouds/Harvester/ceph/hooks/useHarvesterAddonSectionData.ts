/**
 * 统一存储配置：Addon 状态、节点/BlockDevice 元数据拉取与轮询。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormInstance } from 'antd/es/form';
import {
  fetchCephHarvesterAddon,
  type CephHarvesterAddonStatusResponse,
} from '../../../../../../services/cephApi';
import { fetchBlockDevices, fetchNodeResources } from '../../../../../../services/monitoringApi';
import {
  mergeCephSectionOnRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cephSectionRefresh';
import {
  buildAllNodesEmptyDeviceRows,
  buildDefaultHarvesterAddonFormValues,
  buildHarvesterAddonFormValuesFromStatus,
  isCephHarvesterAddonRunning,
  isDefaultEmptyWizardNodeRows,
  parseNodeNameOptions,
} from '../lib/cephHarvesterAddon';
import type { HarvesterAddonFormValues } from './harvesterAddonFormTypes';

export type UseHarvesterAddonSectionDataParams = {
  cloudId: string;
  form: FormInstance<HarvesterAddonFormValues>;
  onRefresh?: HarvesterSectionOnRefresh;
  onDeployed?: () => void;
};

export function useHarvesterAddonSectionData({
  cloudId,
  form,
  onRefresh,
  onDeployed,
}: UseHarvesterAddonSectionDataParams) {
  const [formInitKey, setFormInitKey] = useState(0);
  const [formInitialValues, setFormInitialValues] = useState<HarvesterAddonFormValues>(() =>
    buildDefaultHarvesterAddonFormValues(),
  );
  const [statusLoading, setStatusLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
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

  useEffect(() => {
    prevPhaseRef.current = null;
    disabledNodesSeededRef.current = false;
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
  const baselineConfig = isRunningCluster ? status?.config ?? null : null;

  return {
    formInitKey,
    setFormInitKey,
    formInitialValues,
    setFormInitialValues,
    statusLoading,
    metaLoading,
    status,
    setStatus,
    nodeOptions,
    blockDevicesRaw,
    loadMeta,
    sectionOnRefresh,
    applyStatusToForm,
    prevPhaseRef,
    isRunningCluster,
    baselineConfig,
  };
}
