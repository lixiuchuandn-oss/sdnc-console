/**
 * Harvester EBS — 克隆虚拟卷（含「仅元数据」转创建卷分支）
 * 路径: `ebs/modals/VolumeCloneModal.tsx`
 *
 * 【页面位置】云详情「虚拟云盘」表格行操作 →「克隆虚拟卷」
 */
import React, { useCallback, useEffect, useState } from 'react';
import { App, Checkbox, Form, Input } from 'antd';
import StdFormModal from '../../../../../components/StdFormModal';
import { cloneHarvesterVolume } from '../../../../../services/harvesterApi';
import type { VolumeCreateSeed } from './VolumeCreateModal';

export type VolumeCloneSource = {
  namespace: string;
  name: string;
  capacityBytes: number;
  storageClass: string;
  accessModes: string[];
  volumeMode: string;
};

export type VolumeCloneModalProps = {
  open: boolean;
  openNonce: number;
  onCancel: () => void;
  cloudId: string;
  mode: 'standard' | 'ops';
  source: VolumeCloneSource | null;
  storageClasses: any[];
  nsOptions: { value: string; label: string }[];
  onCloneSuccess?: () => void;
  /** 取消「克隆数据」时关闭本弹窗并打开创建卷，传入预填 seed */
  onBranchToCreateVolume: (seed: VolumeCreateSeed) => void;
};

const VolumeCloneModal: React.FC<VolumeCloneModalProps> = ({
  open,
  openNonce,
  onCancel,
  cloudId,
  mode,
  source,
  storageClasses,
  nsOptions,
  onCloneSuccess,
  onBranchToCreateVolume,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !source) return;
    form.resetFields();
    form.setFieldsValue({
      cloneData: true,
      newName: `${source.name}-clone`,
    });
  }, [open, openNonce, source, form]);

  const handleFinish = useCallback(
    async (v: any) => {
      if (!source) return;
      try {
        setSubmitting(true);
        if (v.cloneData) {
          await cloneHarvesterVolume(cloudId, source.namespace, source.name, {
            newName: v.newName,
            sizeGi: source.capacityBytes / 1024 ** 3,
            storageClassName: source.storageClass,
            accessModes: source.accessModes || ['ReadWriteOnce'],
            volumeMode: source.volumeMode || 'Block',
          });
          message.success('克隆成功');
          onCancel();
          onCloneSuccess?.();
        } else {
          const scNames = storageClasses.map((s) => s?.metadata?.name || s?.name).filter(Boolean);
          const defaultSc =
            scNames.find((n) => n.toLowerCase() === 'longhorn') ||
            scNames.find((n) => n.toLowerCase().includes('longhorn')) ||
            scNames[0];
          const defaultNs =
            mode === 'ops'
              ? (nsOptions.length > 0 ? nsOptions[0].value : source.namespace)
              : 'default';
          onCancel();
          onBranchToCreateVolume({
            alias: v.newName,
            namespace: defaultNs,
            sizeGi: source.capacityBytes / 1024 ** 3,
            accessModes: 'ReadWriteMany',
            volumeMode: 'Block',
            storageClassName: source.storageClass || defaultSc,
          });
        }
      } catch (e: any) {
        message.error(e.message || '操作失败');
      } finally {
        setSubmitting(false);
      }
    },
    [
      cloudId,
      message,
      mode,
      nsOptions,
      onBranchToCreateVolume,
      onCancel,
      onCloneSuccess,
      source,
      storageClasses,
    ],
  );

  return (
    <StdFormModal
      title="克隆虚拟卷"
      open={open}
      onCancel={onCancel}
      confirmLoading={submitting}
      okText="创建"
      form={form}
      onFinish={handleFinish}
    >

      <Form.Item
        name="newName"
        label="名称"
        rules={[
          {
            required: true,
            message: '请输入新卷名称',
            validator: (_, value) => {
              const cloneData = form.getFieldValue('cloneData');
              if (cloneData && !value) {
                return Promise.reject(new Error('请输入新卷名称'));
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Input placeholder="请输入新卷名称" />
      </Form.Item>
      <Form.Item name="cloneData" valuePropName="checked">
        <Checkbox>克隆虚拟卷数据</Checkbox>
      </Form.Item>
    </StdFormModal>
  );
};

export default VolumeCloneModal;
