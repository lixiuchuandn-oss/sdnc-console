/**
 * =============================================================================
 * Harvester / 虚拟云盘（EBS）—「创建云盘」弹窗
 * 路径: `ebs/modals/VolumeCreateModal.tsx`
 *
 * 【在云详情中的位置】
 * 由 `VolumesSection`（云详情 Tab「虚拟云盘」）工具栏「创建云盘」打开；亦可在「克隆云盘 → 不克隆数据」
 * 流程中作为第二步表单出现。
 *
 * 【职责边界】
 * - 仅负责 PVC 创建表单与 `createHarvesterVolume` 调用；
 * - 命名空间列表由父组件聚合（本组件通过接口拉取后 `onNamespacesListFetched` 回传）。
 * 目录约定见：`deployment/修改纪要_Harvester前端目录结构_域优先与shared.md`
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// 依赖：React / Ant Design / 工程内 UI 与 API
// -----------------------------------------------------------------------------
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form, Input, Select, InputNumber, App, Modal } from 'antd';
import { createHarvesterVolume, fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

// -----------------------------------------------------------------------------
// 类型：预填字段（例如从「克隆」跳转创建时传入）
// -----------------------------------------------------------------------------
export type VolumeCreateSeed = Partial<{
  alias: string;
  namespace: string;
  sizeGi: number;
  accessModes: string;
  volumeMode: string;
  storageClassName: string;
}>;

// -----------------------------------------------------------------------------
// 类型：弹窗 Props（与父组件 `VolumesSection` 状态对接）
// -----------------------------------------------------------------------------
export type VolumeCreateModalProps = {
  open: boolean;
  /** 父组件每次打开前自增，与 `open` 共同决定「新一轮」表单重置（避免仅依赖 open 时序问题） */
  openNonce: number;
  onCancel: () => void;
  cloudId: string;
  nsOptions: { value: string; label: string }[];
  storageClassOptions: { value: string; label: string }[];
  defaultStorageClassName?: string;
  onNamespacesListFetched?: (names: string[]) => void;
  onSuccess?: (force?: boolean, silent?: boolean) => void;
  seed?: VolumeCreateSeed | null;
};

// -----------------------------------------------------------------------------
// 工具：生成 Tower 侧 PVC 资源名（与原 VolumesSection 逻辑一致）
// -----------------------------------------------------------------------------
function generateVolumePvcName(): string {
  let suffix = Math.random().toString(36).substring(2);
  while (suffix.length < 11) suffix += Math.random().toString(36).substring(2);
  return `id-vol-${suffix.substring(0, 11)}`;
}

/** 无 seed 或未带 sizeGi 时的默认容量（GiB，与表单「容量(GB)」一致） */
const DEFAULT_VOLUME_SIZE_GIB = 40;

// -----------------------------------------------------------------------------
// 组件：创建云盘 Modal（表单主体 + 提交）
// -----------------------------------------------------------------------------
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
}) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  // --- Ant Design App 上下文（message 等）---
  const { message } = App.useApp();

  // --- 表单实例 / 提交中状态 ---
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);

  // --- Ref：seed 与回调随渲染更新，但不驱动「整表重置」effect 重复执行 ---
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const onNamespacesListFetchedRef = useRef(onNamespacesListFetched);
  onNamespacesListFetchedRef.current = onNamespacesListFetched;

  // --- 拉取集群命名空间并通知父组件（用于刷新工具栏/下拉数据源）---
  const refreshNamespaces = useCallback(async () => {
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId, true, true);
      const items: any[] = res?.data?.items || res?.items || [];
      const list = items.map((x: any) => x?.metadata?.name || x?.name).filter((s: any) => !!s);
      onNamespacesListFetchedRef.current?.(list);
    } catch {
      /* 静默失败：父级仍可能使用已缓存的 nsOptions */
    }
  }, [cloudId]);

  // --- 打开弹窗（open + openNonce）：拉取 NS、重置并写入初始值 ---
  // 说明：不把 `nsOptions`/`seed` 列入依赖，避免异步 options 更新时把用户已编辑内容清空；
  // `seedRef` 与当前渲染的 `nsOptions[0]` 仅在「打开瞬间」读取即可。
  useEffect(() => {
    if (!open) return;
    void refreshNamespaces();
    form.resetFields();
    const s = seedRef.current;
    const firstNs = nsOptions[0]?.value;
    const ns = hasOpsView ? (s?.namespace ?? firstNs ?? undefined) : 'default';
    form.setFieldsValue({
      alias: s?.alias ?? '',
      namespace: ns,
      sizeGi: s?.sizeGi ?? DEFAULT_VOLUME_SIZE_GIB,
      accessModes: s?.accessModes ?? 'ReadWriteMany',
      volumeMode: s?.volumeMode ?? 'Block',
      storageClassName: s?.storageClassName ?? defaultStorageClassName,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上：避免 nsOptions 异步补丁触发整表重置
  }, [open, openNonce, hasOpsView, defaultStorageClassName, form, refreshNamespaces]);

  // --- 具备运维视图权限：首轮父级 nsOptions 仍为空时，待 options 到达后补默认 namespace ---
  useEffect(() => {
    if (!open || !hasOpsView) return;
    const cur = form.getFieldValue('namespace');
    if (cur) return;
    const first = nsOptions[0]?.value;
    if (first) form.setFieldValue('namespace', first);
  }, [open, hasOpsView, nsOptions, form]);

  // --- 默认存储类：若当前未选且集群有推荐值，则填入 ---
  useEffect(() => {
    if (!open) return;
    const current = form.getFieldValue('storageClassName');
    if (!current && defaultStorageClassName) {
      form.setFieldsValue({ storageClassName: defaultStorageClassName });
    }
  }, [open, openNonce, form, defaultStorageClassName]);

  // --- 提交：组装 API payload（无运维视图权限时强制 default 命名空间）---
  const handleFinish = useCallback(
    async (v: any) => {
      try {
        setCreating(true);
        const modes = Array.isArray(v.accessModes)
          ? v.accessModes
          : v.accessModes
            ? [v.accessModes]
            : ['ReadWriteMany'];

        const payload = {
          namespace: hasOpsView ? String(v.namespace || '') : 'default',
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
      } catch (e: any) {
        message.error(e.message || '创建失败');
      } finally {
        setCreating(false);
      }
    },
    [cloudId, hasOpsView, message, onCancel, onSuccess],
  );

  // --- 渲染：Modal + Form（云详情弹层）---
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
      {/* 区块：展示名 → 写入 annotations['tower.io/alias'] */}
      <Form.Item label="名称" name="alias" rules={[{ required: true }]}>
        <Input placeholder="例如: 测试pvc" />
      </Form.Item>

      {/* 区块：命名空间 — 有运维视图权限可选；否则只读 default */}
      <Form.Item label="命名空间" name="namespace" rules={[{ required: true }]}>
        {hasOpsView ? (
          <Select
            showSearch
            options={nsOptions}
            style={{ width: '100%' }}
            onOpenChange={async (dropdownOpen) => {
              if (dropdownOpen) await refreshNamespaces();
            }}
          />
        ) : (
          <Input disabled style={{ width: '100%' }} />
        )}
      </Form.Item>

      {/* 区块：容量 */}
      <Form.Item label="容量(GB)" name="sizeGi" rules={[{ required: true }]}>
        <InputNumber min={1} style={{ width: '100%' }} />
      </Form.Item>

      {/* 区块：访问模式 RWO/RWX/ROX */}
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

      {/* 区块：Block / Filesystem */}
      <Form.Item label="云盘类型" name="volumeMode" initialValue="Block">
        <Select
          options={[
            { value: 'Block', label: 'Block' },
            { value: 'Filesystem', label: 'Filesystem' },
          ]}
          style={{ width: '100%' }}
        />
      </Form.Item>

      {/* 区块：StorageClass（选项由父组件根据集群 StorageClass 列表生成） */}
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
