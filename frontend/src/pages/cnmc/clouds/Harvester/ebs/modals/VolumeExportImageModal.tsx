import React, { useEffect } from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { exportHarvesterImageFromVolume } from 'services/harvesterApi';
import type { StorageClassOption } from '../lib/volumesStorageClassUtils';
import { pickExportTargetStorageClass } from '../lib/volumesStorageClassUtils';
import type { VolumeView } from '../lib/volumesSectionTypes';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';

export type VolumeExportImageModalProps = {
  open: boolean;
  onCancel: () => void;
  cloudId: string;
  volume: VolumeView | null;
  storageClassOptions: StorageClassOption[];
  defaultStorageClassName?: string;
  storageClasses: unknown[];
  onSuccess?: HarvesterSectionOnRefresh;
};

const VolumeExportImageModal: React.FC<VolumeExportImageModalProps> = ({
  open,
  onCancel,
  cloudId,
  volume,
  storageClassOptions,
  defaultStorageClassName,
  storageClasses,
  onSuccess,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ displayName: string; targetStorageClassName?: string }>();

  useEffect(() => {
    if (!open || !volume) return;
    form.resetFields();
    form.setFieldsValue({
      displayName: volume.name,
      targetStorageClassName: pickExportTargetStorageClass(storageClasses, defaultStorageClassName),
    });
  }, [defaultStorageClassName, form, open, storageClasses, volume]);

  return (
    <Modal
      title="导出为镜像"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="导出"
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
            await exportHarvesterImageFromVolume(cloudId, volume.namespace, volume.name, {
              displayName: values.displayName,
              targetStorageClassName: values.targetStorageClassName,
            });
            message.success('导出镜像任务已提交，在云主机镜像列表能看到导出的镜像数据');
            onCancel();
            onSuccess?.(true, true);
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err.message || '导出失败');
          }
        }}
      >
        <Form.Item label="镜像名称" name="displayName" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="存储类" name="targetStorageClassName">
          <Select allowClear options={storageClassOptions} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VolumeExportImageModal;
