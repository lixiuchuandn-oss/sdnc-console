/**
 * Harvester · 创建云盘弹窗
 * 由 VolumesSection 工具栏「创建云盘」或克隆流程打开。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Input, Select, InputNumber, App, Modal } from 'antd';
import { createHarvesterVolume, fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
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
  tenantDefaultNamespace?: string;
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
  tenantDefaultNamespace,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<VolumeCreateFormValues>();
  const [creating, setCreating] = useState(false);
  const [createNsOptions, setCreateNsOptions] = useState<{ value: string; label: string }[]>([]);

  const seedRef = useRef(seed);
  seedRef.current = seed;
  const onNamespacesListFetchedRef = useRef(onNamespacesListFetched);
  onNamespacesListFetchedRef.current = onNamespacesListFetched;

  const toNamespaceSelectOptions = useCallback((names: string[]) => {
    const list = names.filter((n) => n && !isSystemNamespace(n));
    return list.sort().map((n) => ({ value: n, label: n }));
  }, []);

  const resolveTenantNamespace = useCallback(
    (namespaces: string[]): string => {
      const preferred = String(tenantDefaultNamespace || '').trim();
      if (preferred && namespaces.includes(preferred)) return preferred;
      return namespaces[0] || preferred || '';
    },
    [tenantDefaultNamespace],
  );

  const refreshNamespaces = useCallback(async () => {
    if (isTenant) return;
    try {
      const res = await fetchHarvesterNamespaces(cloudId, true, true);
      const names = parseHarvesterNamespaceNames(res);
      onNamespacesListFetchedRef.current?.(names);
      const opts = toNamespaceSelectOptions(names);
      if (opts.length > 0) {
        setCreateNsOptions(opts);
      }
    } catch {
      /* 父级仍可能使用已缓存的 nsOptions */
    }
  }, [cloudId, isTenant, toNamespaceSelectOptions]);

  useEffect(() => {
    if (!open) return;
    if (!isTenant) {
      setCreateNsOptions(nsOptions);
      void refreshNamespaces();
    }
    form.resetFields();
    const s = seedRef.current;
    const firstNs = nsOptions[0]?.value;
    const tenantNsList = nsOptions.map((o) => o.value);
    const initialNs = isTenant
      ? (() => {
          const seedNs = String(s?.namespace || '').trim();
          if (seedNs && tenantNsList.includes(seedNs)) return seedNs;
          const picked = resolveTenantNamespace(tenantNsList);
          return picked || undefined;
        })()
      : (s?.namespace ?? firstNs ?? undefined);
    form.setFieldsValue({
      alias: s?.alias ?? '',
      namespace: initialNs,
      sizeGi: s?.sizeGi ?? DEFAULT_VOLUME_SIZE_GIB,
      accessModes: s?.accessModes ?? 'ReadWriteMany',
      volumeMode: s?.volumeMode ?? 'Block',
      storageClassName: s?.storageClassName ?? defaultStorageClassName,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 避免 nsOptions 异步补丁触发整表重置
  }, [
    open,
    openNonce,
    isTenant,
    tenantDefaultNamespace,
    defaultStorageClassName,
    form,
    nsOptions,
    refreshNamespaces,
    resolveTenantNamespace,
  ]);

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
          namespace: String(v.namespace || ''),
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
    [cloudId, message, onCancel, onSuccess],
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
          <Select
            showSearch
            optionFilterProp="label"
            options={
              isTenant
                ? nsOptions
                : createNsOptions.length > 0
                  ? createNsOptions
                  : nsOptions
            }
            style={{ width: '100%' }}
            onOpenChange={(dropdownOpen) => {
              if (dropdownOpen && !isTenant) void refreshNamespaces();
            }}
          />
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
