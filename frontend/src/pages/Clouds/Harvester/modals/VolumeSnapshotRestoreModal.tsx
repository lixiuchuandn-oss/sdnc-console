import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { restoreHarvesterVolumeSnapshot, fetchHarvesterStorageClasses } from '../../../../services/harvesterApi';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  resource: any; // The snapshot record
}

const VolumeSnapshotRestoreModal: React.FC<Props> = ({
  visible,
  onCancel,
  onSuccess,
  cloudId,
  resource
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [scLoading, setScLoading] = useState(false);

  useEffect(() => {
    if (visible && resource) {
      form.resetFields();
      form.setFieldsValue({
        name: `restore-${resource.name}-${Math.floor(Date.now() / 1000)}`,
        size: resource.restoreSize, // Pre-fill with restore size
      });
      loadStorageClasses();
    }
  }, [visible, resource, form]);

  const loadStorageClasses = async () => {
    try {
      setScLoading(true);
      const res = await fetchHarvesterStorageClasses(cloudId);
      const items = res?.data?.items || [];
      setStorageClasses(items);
      
      // Auto-select 'longhorn' if available and no selection
      const currentSc = form.getFieldValue('storageClassName');
      if (!currentSc && items.length > 0) {
         // Priority: 1. Default Class, 2. Longhorn, 3. First one
         const def = items.find((sc: any) => sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true');
         if (def) {
            form.setFieldsValue({ storageClassName: def.metadata.name });
         } else {
             const longhorn = items.find((sc: any) => sc.metadata?.name?.includes('longhorn'));
             if (longhorn) {
                form.setFieldsValue({ storageClassName: longhorn.metadata.name });
             }
         }
      }
    } catch (e) {
      console.warn('Failed to load storage classes', e);
    } finally {
      setScLoading(false);
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      await restoreHarvesterVolumeSnapshot(
        cloudId,
        resource.namespace,
        resource.name,
        {
          name: values.name,
          storageClassName: values.storageClassName,
          size: values.size, 
        }
      );

      message.success('快照恢复任务已提交');
      onSuccess();
    } catch (e: any) {
      message.error(`恢复失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!resource) return null;

  return (
    <Modal
      title="恢复卷快照"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
      >
        <Form.Item label="源快照">
          <Input value={resource.name} disabled />
        </Form.Item>

        <Form.Item
          name="name"
          label="新卷名称"
          rules={[{ required: true, message: '请输入新卷名称' }]}
          extra="将创建一个以此名称命名的新持久卷申领 (PVC)"
        >
          <Input placeholder="请输入新卷名称" />
        </Form.Item>

        <Form.Item
          name="storageClassName"
          label="存储类"
          extra="如果不指定，将使用集群默认存储类"
        >
          <Select
            loading={scLoading}
            placeholder="请选择存储类"
            allowClear
            options={storageClasses.map(sc => ({
              label: sc.metadata?.name,
              value: sc.metadata?.name
            }))}
          />
        </Form.Item>
        
        <Form.Item
          name="size"
          label="容量"
          extra={`快照原始大小: ${resource.restoreSize || '未知'}`}
        >
           <Input placeholder="例如: 10Gi (留空则使用快照原始大小)" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VolumeSnapshotRestoreModal;
