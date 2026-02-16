/**
 * Harvester - 卷快照恢复弹窗
 *
 * 负责基于 VolumeSnapshot 创建新的 PVC：
 * - 默认用 `restore-{snapshotName}-{timestamp}` 作为新卷名称；
 * - 加载可用存储类列表，并优先选择默认存储类或 Longhorn；
 * - 支持覆写容量（size），否则使用快照原始大小。
 */
import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { restoreHarvesterVolumeSnapshot, fetchHarvesterStorageClasses } from '../../../../services/harvesterApi';

/**
 * 组件入参
 * - visible: 弹窗是否可见
 * - onCancel: 关闭回调
 * - onSuccess: 恢复任务创建成功回调
 * - cloudId: 云 ID
 * - resource: 源快照记录
 */
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

  // 弹窗打开时重置表单，填充默认名称/容量，并加载存储类列表
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

  // 加载存储类列表，并尽量自动选择默认存储类或 Longhorn
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

  /**
   * 校验表单并提交卷快照恢复任务：
   * - 必选：新卷名称；
   * - 可选：存储类、容量；
   * - 容量留空则在后端使用快照原始大小。
   */
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
