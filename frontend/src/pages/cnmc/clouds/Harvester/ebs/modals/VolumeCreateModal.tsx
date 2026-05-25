/**
 * Harvester · 创建云盘弹窗
 * 由 VolumesSection 工具栏「创建云盘」或克隆流程打开。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Input, Select, InputNumber, App, Modal } from 'antd';
import { createHarvesterVolume, fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';
import { parseHarvesterNamespaceNames } from '../lib/parseHarvesterNamespaceNames';
import { generateVolumePvcName } from '../lib/volumePvcNameUtils';

export type VolumeCreateSeed = Partial<{
  alias: string;
  namespace: string;
  sizeGi: number;
  accessModes: string;
  volumeMode: string;
  storageClassName: string;
}>;

type VolumeCreateFormValues = {
  alias: string;
  namespace: string;
  sizeGi: number;
  accessModes: string | string[];
  volumeMode: string;
  storageClassName?: string;
};

export type VolumeCreateModalProps = {
  open: boolean;
  openNonce: number;
  onCancel: () => void;
  cloudId: string;
  nsOptions: { value: string; label: string }[];
  storageClassOptions: { value: string; label: string }[];
  defaultStorageClassName?: string;
  onNamespacesListFetched?: (names: string[]) => void;
  onSuccess?: (force?: boolean, silent?: boolean) => void;
  seed?: VolumeCreateSeed | null;
  isTenant?: boolean;
};

const DEFAULT_VOLUME_SIZE_GIB = 40;

const VolumeCreateModal: React.FC<VolumeCreateModalProps> = ({
  open,
  openNonce,
  onCancel,
  cloudId,
  nsOptions,
  storageClassOptions,
  defaultStorageClassName,
  onNamespacesListFetched,
  onSuccess,
  seed,
  isTenant = false,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<VolumeCreateFormValues>();
  const [creating, setCreating] = useState(false);

  const seedRef = useRef(seed);
  seedRef.current = seed;
  const onNamespacesListFetchedRef = useRef(onNamespacesListFetched);
  onNamespacesListFetchedRef.current = onNamespacesListFetched;

  const refreshNamespaces = useCallback(async () => {
    try {
      const res = await fetchHarvesterNamespaces(cloudId, true, true);
      const items =
        (res as { data?: { items?: unknown[] }; items?: unknown[] })?.data?.items ||
        (res as { items?: unknown[] })?.items ||
        [];
      onNamespacesListFetchedRef.current?.(parseHarvesterNamespaceNames(items));
    } catch {
      /* 父级仍可能使用已缓存的 nsOptions */
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open) return;
    void refreshNamespaces();
    form.resetFields();
    const s = seedRef.current;
    const firstNs = nsOptions[0]?.value;
    const ns = !isTenant ? (s?.namespace ?? firstNs ?? undefined) : 'default';
    form.setFieldsValue({
      alias: s?.alias ?? '',
      namespace: ns,
      sizeGi: s?.sizeGi ?? DEFAULT_VOLUME_SIZE_GIB,
      accessModes: s?.accessModes ?? 'ReadWriteMany',
      volumeMode: s?.volumeMode ?? 'Block',
      storageClassName: s?.storageClassName ?? defaultStorageClassName,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 避免 nsOptions 异步补丁触发整表重置
  }, [open, openNonce, isTenant, defaultStorageClassName, form, refreshNamespaces]);

  useEffect(() => {
    if (!open || isTenant) return;
    const cur = form.getFieldValue('namespace');
    if (cur) return;
    const first = nsOptions[0]?.value;
    if (first) form.setFieldValue('namespace', first);
  }, [open, isTenant, nsOptions, form]);

  useEffect(() => {
    if (!open) return;
    const current = form.getFieldValue('storageClassName');
    if (!current && defaultStorageClassName) {
      form.setFieldsValue({ storageClassName: defaultStorageClassName });
    }
  }, [open, openNonce, form, defaultStorageClassName]);

  const handleFinish = useCallback(
    async (v: VolumeCreateFormValues) => {
      try {
        setCreating(true);
        const modes = Array.isArray(v.accessModes)
          ? v.accessModes
          : v.accessModes
            ? [v.accessModes]
            : ['ReadWriteMany'];

        const payload = {
          namespace: !isTenant ? String(v.namespace || '') : 'default',
          name: generateVolumePvcName(),
          sizeGi: Number(v.sizeGi || 0),
          accessModes: modes,
          volumeMode: String(v.volumeMode || 'Block'),
          storageClassName: String(v.storageClassName || '') || undefined,
          annotations: {
            'tower.io/alias': v.alias || '',
          },
        };
        await createHarvesterVolume(cloudId, payload);
        message.success('创建成功');
        onCancel();
        onSuccess?.(true, true);
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err.message || '创建失败');
      } finally {
        setCreating(false);
      }
    },
    [cloudId, isTenant, message, onCancel, onSuccess],
  );

  return (
    <Modal
      title="创建云盘"
      open={open}
      centered
      destroyOnHidden
      width={600}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={creating}
      okText="创建"
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item label="名称" name="alias" rules={[{ required: true }]}>
          <Input placeholder="例如: 测试pvc" />
        </Form.Item>

        <Form.Item label="项目" name="namespace" rules={[{ required: true, message: '请选择项目' }]}>
          {!isTenant ? (
            <Select
              showSearch
              options={nsOptions}
              style={{ width: '100%' }}
              onOpenChange={(dropdownOpen) => {
                if (dropdownOpen) void refreshNamespaces();
              }}
            />
          ) : (
            <Input disabled style={{ width: '100%' }} />
          )}
        </Form.Item>

        <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item label="访问模式" name="accessModes" initialValue="ReadWriteMany">
          <Select
            options={[
              { value: 'ReadWriteOnce', label: 'RWO' },
              { value: 'ReadWriteMany', label: 'RWX' },
              { value: 'ReadOnlyMany', label: 'ROX' },
            ]}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="云盘类型" name="volumeMode" initialValue="Block">
          <Select
            options={[
              { value: 'Block', label: 'Block' },
              { value: 'Filesystem', label: 'Filesystem' },
            ]}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item label="存储类" name="storageClassName">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="选择存储类"
            options={storageClassOptions}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VolumeCreateModal;
