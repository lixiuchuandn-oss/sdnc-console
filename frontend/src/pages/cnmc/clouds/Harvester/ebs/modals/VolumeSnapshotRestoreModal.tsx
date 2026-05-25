/**
 * Harvester · 云盘快照恢复弹窗
 * 基于 VolumeSnapshot 创建新 PVC；展示名写入 tower.io/alias，资源名自动生成。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { restoreHarvesterVolumeSnapshot, fetchHarvesterStorageClasses } from '../../../../../../services/harvesterApi';
import { pickDefaultStorageClassName } from '../../../../../../utils/harvesterUtils';
import { generateVolumePvcName } from '../lib/volumePvcNameUtils';
import type { SnapshotListRow } from '../lib/snapshotsSectionUtils';
import {
  buildStorageClassSelectOptions,
  pickExportTargetStorageClass,
} from '../lib/volumesStorageClassUtils';

type RestoreFormValues = {
  alias: string;
  storageClassName?: string;
};

type Props = {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  resource: SnapshotListRow | null;
};

const VolumeSnapshotRestoreModal: React.FC<Props> = ({
  visible,
  onCancel,
  onSuccess,
  cloudId,
  resource,
}) => {
  const [form] = Form.useForm<RestoreFormValues>();
  const [loading, setLoading] = useState(false);
  const [storageClassOptions, setStorageClassOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [scLoading, setScLoading] = useState(false);

  const loadStorageClasses = useCallback(async () => {
    try {
      setScLoading(true);
      const res = await fetchHarvesterStorageClasses(cloudId);
      const rawItems = (res as { data?: { items?: unknown[] } })?.data?.items || [];
      const options = buildStorageClassSelectOptions(rawItems);
      setStorageClassOptions(options);

      const currentSc = form.getFieldValue('storageClassName');
      if (!currentSc) {
        const defaultSc =
          pickDefaultStorageClassName(rawItems) || pickExportTargetStorageClass(rawItems);
        if (defaultSc) form.setFieldsValue({ storageClassName: defaultSc });
      }
    } catch {
      setStorageClassOptions([]);
    } finally {
      setScLoading(false);
    }
  }, [cloudId, form]);

  useEffect(() => {
    if (!visible || !resource) return;
    form.resetFields();
    form.setFieldsValue({ alias: '' });
    void loadStorageClasses();
  }, [visible, resource, form, loadStorageClasses]);

  const handleOk = async () => {
    if (!resource) return;
    try {
      const values = await form.validateFields();
      setLoading(true);

      const alias = String(values.alias ?? '').trim();
      await restoreHarvesterVolumeSnapshot(cloudId, resource.namespace, resource.name, {
        name: generateVolumePvcName(),
        storageClassName: values.storageClassName,
        alias,
      });

      onSuccess();
    } catch (e: unknown) {
      const err = e as { errorFields?: unknown; message?: string };
      if (err?.errorFields) return;
      message.error(`恢复失败: ${err.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!resource) return null;

  return (
    <Modal
      title="恢复云盘快照"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
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
          extra="卷模式与源云盘一致（Block/Filesystem）；访问模式为 ReadWriteMany。不指定存储类时使用集群默认。"
        >
          <Select
            loading={scLoading}
            placeholder="请选择存储类"
            allowClear
            showSearch
            optionFilterProp="label"
            options={storageClassOptions}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VolumeSnapshotRestoreModal;
