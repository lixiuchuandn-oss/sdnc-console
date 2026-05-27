import React, { useCallback, useEffect, useState } from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { attachHarvesterVolumeToVmByName } from 'services/harvesterApi';
import type { VmAttachRecord } from '../lib/volumeDetachUtils';
import { vmNamespaceOf } from '../lib/volumeVmAttachUtils';

export type VolumeAttachModalProps = {
  open: boolean;
  openNonce: number;
  onCancel: () => void;
  cloudId: string;
  pvcNamespace: string;
  pvcName: string;
  vms: unknown[];
  initialInstanceId?: string;
  onSuccess?: (force?: boolean) => void;
};

type AttachFormValues = { instanceId: string };

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
  const [form] = Form.useForm<AttachFormValues>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initialInstanceId) {
      form.setFieldsValue({ instanceId: initialInstanceId });
    }
  }, [open, openNonce, initialInstanceId, form]);

  const vmOptions = (vms || [])
    .filter((vm: unknown) => {
      if (!pvcNamespace) return false;
      return vmNamespaceOf(vm) === String(pvcNamespace);
    })
    .map((vm: unknown) => {
      const row = vm as VmAttachRecord;
      const alias = row.metadata?.annotations?.['tower.io/alias'] || (row.alias as string) || '';
      const name =
        row.metadata?.name ||
        (row.name as string) ||
        (row.InstanceName as string) ||
        row.id ||
        row.InstanceId ||
        '';
      const displayName = alias ? `${alias} (${name})` : name;
      return {
        value: row.id || row.InstanceId,
        label: displayName,
      };
    });

  const handleFinish = useCallback(
    async (values: AttachFormValues) => {
      try {
        setSubmitting(true);
        const vm = (vms || []).find(
          (x: unknown) => {
            const row = x as VmAttachRecord;
            return String(row.id || row.InstanceId) === values.instanceId;
          },
        ) as VmAttachRecord | undefined;
        if (!vm) {
          message.error('未找到云主机');
          return;
        }

        const vmName = vm.metadata?.name || (vm.name as string) || (vm.InstanceName as string) || '';
        const finalName =
          vmName ||
          (String(vm.InstanceId || '').includes('/')
            ? String(vm.InstanceId).split('/').pop()
            : vm.InstanceId) ||
          '';
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
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err.message || '挂载失败');
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
