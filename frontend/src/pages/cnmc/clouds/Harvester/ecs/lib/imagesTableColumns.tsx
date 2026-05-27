import React from 'react';
import { Modal, Progress, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { OsIcon } from 'components/OsIcon';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import { isImagePublicByScenario, resolveVmImageKind } from 'utils/harvesterUtils';
import { resolveImageListStateKey } from './vmImageStatus';
import {
  formatImageSizeGb,
  getImageActualFileBytes,
  getImageCreatedMs,
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  getImageStatusText,
  type ImageListRecord,
} from './imagesSectionUtils';

export type ImagesTableActions = {
  isTenant: boolean;
  hasImagesWrite: boolean;
  ensureImagesWrite: () => boolean;
  onOpenYaml: (record: ImageListRecord) => void;
  onEditLabels: (record: ImageListRecord) => void;
  onDeleteRow: (record: ImageListRecord) => void;
};

function renderImageStatusTag(r?: ImageListRecord | string): React.ReactElement {
  const stateKey = typeof r === 'string' ? r : resolveImageListStateKey(r);
  const k = String(stateKey || '').toLowerCase();
  const sourceType =
    typeof r !== 'string'
      ? ((r?.sourceType || (r?.spec as Record<string, unknown> | undefined)?.sourceType) as
          | string
          | undefined)
      : undefined;
  const text = getImageStatusText(stateKey, sourceType);
  const color = (() => {
    if (k === 'ready') return 'green';
    if (k === 'failed') return 'red';
    if (k === 'imported') return 'success';
    if (k === 'downloading') return 'blue';
    if (k === 'uploading') return 'blue';
    if (k === 'importing') return 'blue';
    if (k === 'exporting') return 'blue';
    if (k === 'cancelled') return 'default';
    if (k === 'pending') return 'gold';
    return undefined;
  })();
  return <Tag color={color}>{text}</Tag>;
}

export function buildImagesTableColumns(actions: ImagesTableActions): ColumnsType<ImageListRecord> {
  const { isTenant, hasImagesWrite, ensureImagesWrite, onOpenYaml, onEditLabels, onDeleteRow } =
    actions;

  return [
    {
      title: '镜像名称',
      key: 'display_name',
      fixed: 'left',
      render: (_: unknown, r: ImageListRecord) => {
        const meta = r?.metadata as Record<string, unknown> | undefined;
        const labels = (meta?.labels || {}) as Record<string, string>;
        const spec = r?.spec as Record<string, unknown> | undefined;
        const disp =
          r?.displayName ||
          spec?.displayName ||
          labels['harvesterhci.io/imageDisplayName'] ||
          r?.name ||
          meta?.name ||
          '-';
        const nameForIcon = String(
          r?.displayName ||
            spec?.displayName ||
            labels['harvesterhci.io/imageDisplayName'] ||
            r?.name ||
            meta?.name ||
            '',
        );
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <OsIcon osName={nameForIcon} style={{ flexShrink: 0, fontSize: 16 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {String(disp)}
            </span>
          </span>
        );
      },
    },
    {
      title: '镜像ID',
      key: 'resource_name',
      render: (_: unknown, r: ImageListRecord) => {
        const meta = r?.metadata as Record<string, unknown> | undefined;
        return (
          <span className="text-secondary">{String(r?.name || meta?.name || '-')}</span>
        );
      },
    },
    ...(!isTenant
      ? [
          {
            title: '命名空间',
            key: 'namespace',
            render: (_: unknown, r: ImageListRecord) => getImageRowNamespace(r),
          },
          {
            title: '作用域',
            key: 'scope',
            render: (_: unknown, r: ImageListRecord) =>
              isImagePublicByScenario(r) ? '公共镜像' : '私有镜像',
          },
        ]
      : []),
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, r: ImageListRecord) => renderImageStatusTag(r),
    },
    {
      title: '进度',
      key: 'progress',
      render: (_: unknown, r: ImageListRecord) => {
        const status = r?.status as Record<string, unknown> | undefined;
        const progress = Number(status?.progress ?? r?.progress);
        if (!Number.isFinite(progress) || progress <= 0) return '-';
        return (
          <Progress
            percent={Math.round(progress)}
            size="small"
            status={progress >= 100 ? 'success' : 'active'}
          />
        );
      },
    },
    {
      title: '镜像类型',
      key: 'image_kind',
      render: (_: unknown, r: ImageListRecord) => {
        const kind = resolveVmImageKind(r);
        const text = kind === 'iso' ? 'ISO' : kind === 'disk' ? 'Qcow2' : '其他';
        const color = kind === 'iso' ? 'pink' : kind === 'disk' ? 'blue' : undefined;
        return <Tag color={color}>{text}</Tag>;
      },
    },
    {
      title: '虚拟大小',
      key: 'vsize',
      render: (_: unknown, r: ImageListRecord) => {
        const status = r?.status as Record<string, unknown> | undefined;
        const spec = r?.spec as Record<string, unknown> | undefined;
        const vsize = r?.virtualSize ?? status?.virtualSize ?? spec?.virtualSize;
        if (vsize == null || vsize === '') return '-';
        const num = typeof vsize === 'string' ? Number(vsize) : (vsize as number);
        return Number.isFinite(num) && Number(num) > 0 ? formatImageSizeGb(num) : '-';
      },
    },
    {
      title: '实际大小',
      key: 'actual_size',
      render: (_: unknown, r: ImageListRecord) => {
        const bytes = getImageActualFileBytes(r);
        return bytes != null ? formatImageSizeGb(bytes) : '-';
      },
    },
    ...(!isTenant
      ? [
          {
            title: '存储类',
            key: 'sc',
            render: (_: unknown, r: ImageListRecord) => {
              const status = r?.status as Record<string, unknown> | undefined;
              const spec = r?.spec as Record<string, unknown> | undefined;
              return String(
                r?.storageClassName || spec?.storageClassName || status?.storageClassName || '-',
              );
            },
          },
        ]
      : []),
    {
      title: '创建时间',
      key: 'created_at',
      sorter: (a: ImageListRecord, b: ImageListRecord) => getImageCreatedMs(a) - getImageCreatedMs(b),
      defaultSortOrder: 'descend' as const,
      render: (_: unknown, r: ImageListRecord) => {
        const meta = r?.metadata as Record<string, unknown> | undefined;
        const t = meta?.creationTimestamp || r?.createdAt;
        return t ? new Date(String(t)).toLocaleString() : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: unknown, r: ImageListRecord) => {
        const name = getImageRowId(r);
        const alias = getImageDisplayAlias(r);
        const deleteLabel = alias ? `${alias} (${name})` : name;

        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasImagesWrite }}
            items={[
              ...(!isTenant
                ? [{ key: 'yaml', label: '查看YAML', onClick: () => onOpenYaml(r) }]
                : []),
              {
                key: 'editLabels',
                label: '编辑标签',
                disabled: !hasImagesWrite,
                onClick: () => onEditLabels(r),
              },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                disabled: !hasImagesWrite,
                onClick: () =>
                  Modal.confirm({
                    title: '确认删除镜像？',
                    content: `确定要删除镜像 ${deleteLabel} 吗？此操作不可恢复。`,
                    onOk: () => {
                      if (!ensureImagesWrite()) return;
                      void onDeleteRow(r);
                    },
                  }),
              },
            ]}
          />
        );
      },
    },
  ];
}
