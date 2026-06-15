import React, { useEffect } from 'react';
import { App, Form, InputNumber, Modal } from 'antd';
import { updateHarvesterVolume } from 'services/harvesterApi';
import type { VolumeView } from '../lib/volumesSectionTypes';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';

export type VolumeResizeModalProps = {
  open: boolean;
  onCancel: () => void;
  cloudId: string;
  volume: VolumeView | null;
  onSuccess?: HarvesterSectionOnRefresh;
};

const VolumeResizeModal: React.FC<VolumeResizeModalProps> = ({
  open,
  onCancel,
  cloudId,
  volume,
  onSuccess,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ sizeGi: number }>();

  useEffect(() => {
    if (!open || !volume) return;
    form.resetFields();
    form.setFieldsValue({ sizeGi: volume.capacityBytes / 1024 ** 3 });
  }, [form, open, volume]);

  return (
    <Modal
      title="编辑配置"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="保存"
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
            await updateHarvesterVolume(cloudId, volume.namespace, volume.name, {
              sizeGi: Number(values.sizeGi),
            });
            message.success('更新成功');
            onCancel();
            onSuccess?.(true, true);
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err.message || '更新失败');
          }
        }}
      >
        <Form.Item label="容量(Gi)" name="sizeGi" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VolumeResizeModal;
