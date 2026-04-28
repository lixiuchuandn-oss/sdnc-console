/**
 * Harvester - 卷快照恢复弹窗
 *
 * 基于 VolumeSnapshot 创建新 PVC：
 * - K8s 资源名自动生成（id-vol-xxxxxxxxxxx，与创建卷一致），满足 DNS 子域规则；
 * - 用户填写「云盘名称」为展示别名，写入 annotations['tower.io/alias']，支持中文；
 * - 容量由快照原始大小决定；存储类可选。
 */
import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { restoreHarvesterVolumeSnapshot, fetchHarvesterStorageClasses } from '../../../../../../services/harvesterApi';
import { isSystemStorageClass } from '../../../../../../utils/harvesterUtils';

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
  resource: any;
}

/** 与 VolumeCreateModal / 云盘创建一致的 PVC metadata.name 生成规则 */
function generateVolumePvcName(): string {
  let suffix = Math.random().toString(36).substring(2);
  while (suffix.length < 11) suffix += Math.random().toString(36).substring(2);
  return `id-vol-${suffix.substring(0, 11)}`;
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
        alias: '',
      });
      loadStorageClasses();
    }
  }, [visible, resource, form]);

  const loadStorageClasses = async () => {
    try {
      setScLoading(true);
      const res = await fetchHarvesterStorageClasses(cloudId);
      const rawItems = res?.data?.items || [];
      const items = rawItems.filter((sc: any) => !isSystemStorageClass(sc?.metadata?.name || sc?.name || ''));
      setStorageClasses(items);

      const currentSc = form.getFieldValue('storageClassName');
      if (!currentSc && items.length > 0) {
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

      const alias = String(values.alias ?? '').trim();
      await restoreHarvesterVolumeSnapshot(
        cloudId,
        resource.namespace,
        resource.name,
        {
          name: generateVolumePvcName(),
          storageClassName: values.storageClassName,
          alias,
        }
      );

      message.success('快照恢复任务已提交');
      onSuccess();
    } catch (e: any) {
      if (e?.errorFields) return;
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
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
      >
        <Form.Item label="源快照">
          <Input value={resource.name} disabled />
        </Form.Item>

        <Form.Item
          name="alias"
          label="新云盘名称"
          rules={[
            { required: true, message: '请输入新云盘名称' },
            { whitespace: true, message: '新云盘名称不能为空' },
            { max: 200, message: '名称过长' },
          ]}
          extra="即列表中的展示名称（别名），可为中文；系统将自动生成符合 Kubernetes 规范的云盘 ID"
        >
          <Input placeholder="例如：数据盘-恢复副本" />
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
      </Form>
    </Modal>
  );
};

export default VolumeSnapshotRestoreModal;
