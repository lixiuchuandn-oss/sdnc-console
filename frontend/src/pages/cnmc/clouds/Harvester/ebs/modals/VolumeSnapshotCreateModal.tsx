import React, { useEffect } from 'react';
import { App, Form, Input, Modal } from 'antd';
import { createHarvesterVolumeSnapshot } from 'services/harvesterApi';
import { resolveVolumeSnapshotClassName } from 'utils/harvesterUtils';
import { generateVolumeSnapshotAlias } from '../lib/volumesStorageClassUtils';
import type { VolumeView } from '../lib/volumesSectionTypes';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';

export type VolumeSnapshotCreateModalProps = {
  open: boolean;
  onCancel: () => void;
  cloudId: string;
  volume: VolumeView | null;
  storageClasses: unknown[];
  onSuccess?: HarvesterSectionOnRefresh;
};

const VolumeSnapshotCreateModal: React.FC<VolumeSnapshotCreateModalProps> = ({
  open,
  onCancel,
  cloudId,
  volume,
  storageClasses,
  onSuccess,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string }>();

  useEffect(() => {
    if (!open || !volume) return;
    form.resetFields();
    form.setFieldsValue({ name: generateVolumeSnapshotAlias(volume.name) });
  }, [form, open, volume]);

  return (
    <Modal
      title="创建快照"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="创建"
      centered
      destroyOnHidden
      width={600}
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          if (!volume) return;
          try {
            const id = `id-vs-${Math.random().toString(36).substring(2, 13)}`;
            await createHarvesterVolumeSnapshot(cloudId, volume.namespace, volume.name, {
              name: id,
              snapshotClassName: resolveVolumeSnapshotClassName(volume.storageClass, storageClasses),
              alias: values.name,
            });
            message.success('创建成功');
            onCancel();
            onSuccess?.(true, true);
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err.message || '创建失败');
          }
        }}
      >
        <Form.Item
          rules={[{ required: true, message: '请输入快照名称' }]}
          label="快照名称"
          name="name"
        >
          <Input placeholder="留空自动生成" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VolumeSnapshotCreateModal;
