/**
 * Harvester EBS — 将 PVC 挂载到云主机
 * 路径: `ebs/modals/VolumeAttachModal.tsx`
 *
 * 【页面位置】云详情「虚拟云盘」表格行操作 →「挂载到虚拟机」
 *
 * 【命名空间与筛选】
 * 命名空间仅由当前云盘（PVC）的 `metadata.namespace` 决定（经父组件传入 `pvcNamespace`）；
 * 云主机下拉只列出**与该命名空间一致**的虚拟机，不做跨命名空间挂载。
 *
 * 界面不单独展示命名空间字段；筛选仍仅依据 PVC 所在命名空间。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { attachHarvesterVolumeToVmByName } from '../../../../../../services/harvesterApi';

export type VolumeAttachModalProps = {
  open: boolean;
  /** 与 `open` 同步递增，用于同一条 PVC 重复打开时重置表单 */
  openNonce: number;
  onCancel: () => void;
  cloudId: string;
  /** 当前云盘（PVC）所在命名空间；云主机列表仅与此命名空间匹配 */
  pvcNamespace: string;
  /** 当前云盘（PVC）名称 */
  pvcName: string;
  vms: any[];
  /** 若云盘已挂在某 VM 上，可预填该实例 id（Tower/后端字段：InstanceId 或 id） */
  initialInstanceId?: string;
  onSuccess?: (force?: boolean) => void;
};

/** 与列表筛选、提交校验使用同一套字段，避免各写各的导致不一致 */
function vmNamespaceOf(vm: any): string {
  return String(
    vm?.metadata?.namespace ??
      vm?.namespace ??
      vm?.extra?.namespace ??
      vm?.Extra?.Namespace ??
      '',
  );
}

const VolumeAttachModal: React.FC<VolumeAttachModalProps> = ({
  open,
  openNonce,
  onCancel,
  cloudId,
  pvcNamespace,
  pvcName,
  vms,
  initialInstanceId,
  onSuccess,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initialInstanceId) {
      form.setFieldsValue({ instanceId: initialInstanceId });
    }
  }, [open, openNonce, initialInstanceId, form]);

  const vmOptions = (vms || [])
    .filter((vm: any) => {
      if (!pvcNamespace) return false;
      return vmNamespaceOf(vm) === String(pvcNamespace);
    })
    .map((vm: any) => {
      const alias = vm.metadata?.annotations?.['tower.io/alias'] || vm.alias || '';
      const name = vm.metadata?.name || vm.name || vm.InstanceName || vm.id || vm.InstanceId || '';
      const displayName = alias ? `${alias} (${name})` : name;
      return {
        value: vm.id || vm.InstanceId,
        label: displayName,
      };
    });

  const handleFinish = useCallback(
    async (v: any) => {
      try {
        setSubmitting(true);
        const vm = (vms || []).find((x: any) => (x.id || x.InstanceId) === v.instanceId);
        if (!vm) {
          message.error('未找到云主机');
          return;
        }

        const vmName = vm.metadata?.name || vm.name || vm.InstanceName || '';
        const finalName =
          vmName || (vm.InstanceId?.includes('/') ? vm.InstanceId.split('/').pop() : vm.InstanceId) || '';
        const vmNamespace = vmNamespaceOf(vm);

        if (!finalName) {
          message.error('云主机名称无效');
          return;
        }
        if (!vmNamespace) {
          message.error('云主机命名空间无效');
          return;
        }
        if (vmNamespace !== String(pvcNamespace)) {
          message.error('仅可将云盘挂载到与其同命名空间下的云主机');
          return;
        }

        const computedDiskName = pvcName.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 63);

        await attachHarvesterVolumeToVmByName(cloudId, vmNamespace, finalName, {
          diskName: computedDiskName,
          pvcNamespace,
          pvcName,
        });
        message.success('挂载成功');
        onCancel();
        onSuccess?.(true);
      } catch (e: any) {
        message.error(e.message || '挂载失败');
      } finally {
        setSubmitting(false);
      }
    },
    [cloudId, message, onCancel, onSuccess, pvcName, pvcNamespace, vms],
  );

  return (
    <Modal
      title="挂载到云主机"
      open={open}
      centered
      destroyOnHidden
      width={600}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      okText="挂载"
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
      <Form.Item label="云主机" name="instanceId" rules={[{ required: true }]}>
        <Select
          showSearch
          placeholder="选择云主机"
          options={vmOptions}
          style={{ width: '100%' }}
          notFoundContent={
            pvcNamespace ? '此命名空间下暂无可选云主机' : '云盘命名空间未知，无法列出云主机'
          }
        />
      </Form.Item>
      <Form.Item label="虚拟云盘">
        <Input value={pvcName} disabled />
      </Form.Item>
      </Form>
    </Modal>
  );
};

export default VolumeAttachModal;
