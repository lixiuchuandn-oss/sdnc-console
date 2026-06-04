/**
 * 虚拟机 · 部署集（pod 标签 + 由部署集策略生成的亲和/反亲和）：详情「调度策略」入口。
 */
import React, { useEffect, useState } from 'react';
import { Button, Drawer, Flex, Form, message } from 'antd';
import { buildVmReconfigureSubmitCtx } from '../../lib/vmMutation/vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from '../../lib/vmMutation/vmReconfigureSubmitTypes';
import { useVmManageDrawerCssVars } from '../shared/lib/useVmManageDrawerCssVars';
import { useVmSpecPostSubmit } from '../vm-spec-config/lib/useVmSpecPostSubmit';
import ChangePodAffinityFields from './ChangePodAffinityFields';
import { submitVmReconfigureChangePodAffinity } from './lib/submitPodAffinity';
import { isVmFixedHostScheduling } from '../../lib/vmDeploymentSet';
import type { DeploymentSetRow } from 'services/harvester/deploymentSets';

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
  const [deploymentSets, setDeploymentSets] = useState<DeploymentSetRow[]>([]);
  const vmManageCssVars = useVmManageDrawerCssVars();
  const activeRecord = latestVm || vmData;
  const fixedHost = isVmFixedHostScheduling(activeRecord);

  const { openRestartConfirm, fetchAggregatedVm } = useVmSpecPostSubmit({
    cloudId,
    record: vmData,
    latestVm,
    setLatestVm,
  });

  const vmIdentity =
    vmData?.metadata?.uid ||
    `${vmData?.metadata?.namespace || ''}/${vmData?.metadata?.name || ''}`;

  useEffect(() => {
    if (!open || !vmData) return;
    form.resetFields();
  }, [open, vmIdentity, vmData, form]);

  const handleSubmit = async () => {
    if (!hasEcsWrite) return;
    if (fixedHost) {
      message.warning('指定主机模式下不支持部署集');
      return;
    }
    const vmName = activeRecord?.metadata?.name;
    const namespace = activeRecord?.metadata?.namespace;
    if (!vmName || !namespace) {
      message.error('缺少虚拟机名称或命名空间');
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
      await submitVmReconfigureChangePodAffinity(ctx, values, vmName, namespace, {
        activeRecord: latestVm || vmData,
        deploymentSets,
      });
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
      width={480}
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
            disabled={!hasEcsWrite || fixedHost}
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
            cloudId={cloudId}
            onDeploymentSetsLoaded={setDeploymentSets}
          />
        </Form>
      </div>
    </Drawer>
  );
};

export default VmPodAffinityDrawer;
