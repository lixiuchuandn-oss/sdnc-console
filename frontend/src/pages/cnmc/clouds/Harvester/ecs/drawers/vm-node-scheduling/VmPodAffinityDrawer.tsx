/**
 * 虚拟机 · 虚拟机间亲和/反亲和（podAffinity / podAntiAffinity）：详情「调度策略」入口。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Flex, Form, message } from 'antd';
import type { PodAffinityEditorHandle } from '../../../containers/components/workloadForm/editors/PodAffinityEditor';
import { fetchHarvesterNamespaces } from 'services/harvester/clusterInventory';
import { buildVmReconfigureSubmitCtx } from '../../lib/vmMutation/vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from '../../lib/vmMutation/vmReconfigureSubmitTypes';
import { useVmManageDrawerCssVars } from '../shared/lib/useVmManageDrawerCssVars';
import { useVmSpecPostSubmit } from '../vm-spec-config/lib/useVmSpecPostSubmit';
import ChangePodAffinityFields from './ChangePodAffinityFields';
import { submitVmReconfigureChangePodAffinity } from './lib/submitPodAffinity';
import '../shared/styles/vmManageDrawer.css';

export type VmPodAffinityDrawerProps = {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  latestVm: any;
  setLatestVm: (v: any) => void;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
};

const noopEnsureNads = async () => [] as any[];
const noopMaybePromptRestart = async () => {};

const VmPodAffinityDrawer: React.FC<VmPodAffinityDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  latestVm,
  setLatestVm,
  hasEcsWrite,
  onApplied,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const podAffinityRef = useRef<PodAffinityEditorHandle>(null);
  const podAntiAffinityRef = useRef<PodAffinityEditorHandle>(null);
  const vmManageCssVars = useVmManageDrawerCssVars();
  const activeRecord = latestVm || vmData;

  const { openRestartConfirm, fetchAggregatedVm } = useVmSpecPostSubmit({
    cloudId,
    record: vmData,
    latestVm,
    setLatestVm,
  });

  const vmIdentity =
    vmData?.metadata?.uid ||
    `${vmData?.metadata?.namespace || ''}/${vmData?.metadata?.name || ''}`;

  const namespacesOptions = useMemo(() => {
    const vmNs = activeRecord?.metadata?.namespace;
    const merged = new Set<string>(namespaceOptions);
    if (vmNs) merged.add(String(vmNs));
    return Array.from(merged).sort();
  }, [namespaceOptions, activeRecord?.metadata?.namespace]);

  useEffect(() => {
    if (!open || !cloudId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res: any = await fetchHarvesterNamespaces(cloudId, false, true);
        const items = res?.data?.items || res?.items || [];
        const names = items
          .map((ns: any) => ns?.metadata?.name)
          .filter((n: string) => n && String(n).trim());
        if (!cancelled) setNamespaceOptions(names);
      } catch {
        if (!cancelled) setNamespaceOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cloudId]);

  useEffect(() => {
    if (!open || !vmData) return;
    form.resetFields();
  }, [open, vmIdentity, vmData, form]);

  const handleSubmit = async () => {
    if (!hasEcsWrite) return;
    const vmName = activeRecord?.metadata?.name;
    const namespace = activeRecord?.metadata?.namespace;
    if (!vmName || !namespace) {
      message.error('缺少虚拟机名称或命名空间');
      return;
    }

    const hasLabelErrors =
      podAffinityRef.current?.getHasLabelErrors() ||
      podAntiAffinityRef.current?.getHasLabelErrors();
    if (hasLabelErrors) {
      message.error('请修正标签键/值格式后再提交');
      return;
    }

    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const ctx = buildVmReconfigureSubmitCtx({
        form,
        cloudId,
        record: vmData,
        latestVm,
        activeRecord: latestVm || vmData,
        selectedKey: 'change_pod_affinity',
        gpuResources: [],
        usbResources: [],
        setLatestVm,
        ensureNadsLoaded: noopEnsureNads,
        openRestartConfirm,
        maybePromptRestart: noopMaybePromptRestart,
        fetchAggregatedVm,
        onOk: onApplied,
        onClose,
      });
      await submitVmReconfigureChangePodAffinity(ctx, values, vmName, namespace);
      await onApplied?.();
      onClose?.();
    } catch (e: any) {
      if (
        e instanceof VmReconfigureSubmitSkipFinalize ||
        e?.name === 'VmReconfigureSubmitSkipFinalize'
      ) {
        return;
      }
      if (e?.errorFields) return;
      message.error(e?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      placement="right"
      width={880}
      open={open}
      onClose={onClose}
      closable={false}
      destroyOnHidden
      zIndex={1150}
      push={{ distance: 180 }}
      styles={{
        header: { display: 'none' },
        body: { padding: 24 },
      }}
      footer={
        <Flex justify="flex-end" gap="small" style={{ width: '100%' }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!hasEcsWrite}
            onClick={() => void handleSubmit()}
          >
            提交
          </Button>
        </Flex>
      }
    >
      <div className="vmManageDrawer" style={vmManageCssVars}>
        <Form form={form} layout="vertical" wrapperCol={{ span: 24 }}>
          <ChangePodAffinityFields
            form={form}
            record={activeRecord}
            namespacesOptions={namespacesOptions}
            podAffinityRef={podAffinityRef}
            podAntiAffinityRef={podAntiAffinityRef}
          />
        </Form>
      </div>
    </Drawer>
  );
};

export default VmPodAffinityDrawer;
