import React from 'react';
import { Modal, Progress, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { OsIcon } from 'components/OsIcon';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import { isImagePublicByScenario, resolveVmImageKind } from 'utils/harvesterUtils';
import { resolveImageListStateKey, resolveVmImageImportFailureMessage } from './vmImageStatus';
import {
  formatImageSizeGb,
  getImageActualFileBytes,
  getImageStorageClassName,
  getImageListDisplayVirtualSizeBytes,
  getImageCreatedMs,
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  getImageStatusText,
  type ImageListRecord,
} from './imagesSectionUtils';
import type { HarvesterImageUploadTask } from '../../../../../../services/harvesterApi';
import {
  canShowTowerUploadSyncAction,
  imageListLocalUploadDeleteConfirmContent,
  isLocalUploadImageRow,
  getImageRowDeleteBlockedMessage,
  isTowerUploadVirtualRow,
  resolveImageListDisplayProgress,
  shouldDeleteClusterImageForLocalUploadRow,
} from './imagesSectionActions';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';

export type ImagesTableActions = {
  isTenant: boolean;
  hasImagesWrite: boolean;
  ensureImagesWrite: () => boolean;
  vms?: readonly ImageListRecord[];
  uploadTasks?: readonly HarvesterImageUploadTask[];
  onOpenYaml: (record: ImageListRecord) => void;
  onEditLabels: (record: ImageListRecord) => void;
  onDeleteRow: (record: ImageListRecord) => void;
  onSyncUploadTask?: (record: ImageListRecord) => void;
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
    if (k === 'pending_sync') return 'gold';
    if (k === 'downloading') return 'blue';
    if (k === 'syncing') return 'blue';
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
  const {
    isTenant,
    hasImagesWrite,
    ensureImagesWrite,
    onOpenYaml,
    onEditLabels,
    onDeleteRow,
    onSyncUploadTask,
    uploadTasks = [],
    vms = [],
  } = actions;

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
            title: '项目',
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
      render: (_: unknown, r: ImageListRecord) => {
        const stateKey = resolveImageListStateKey(r);
        const failMsg = stateKey === 'failed' ? resolveVmImageImportFailureMessage(r) : undefined;
        return (
          <div style={{ maxWidth: 280 }}>
            {renderImageStatusTag(r)}
            {failMsg ? (
              <Typography.Text
                type="danger"
                style={{ fontSize: 12, display: 'block', marginTop: 4 }}
                ellipsis={{ tooltip: failMsg }}
              >
                {failMsg}
              </Typography.Text>
            ) : null}
          </div>
        );
      },
    },
    {
      title: '进度',
      key: 'progress',
      render: (_: unknown, r: ImageListRecord) => {
        const stateKey = resolveImageListStateKey(r);
        const progress = resolveImageListDisplayProgress(r);
        if (progress == null) {
          return '-';
        }
        const isReady = stateKey === 'ready';
        return (
          <Progress
            percent={Math.round(progress)}
            size="small"
            status={isReady || progress >= 100 ? 'success' : 'active'}
            format={isReady ? () => '完成' : undefined}
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
        const vsize = getImageListDisplayVirtualSizeBytes(r);
        if (vsize == null) return '-';
        return formatImageSizeGb(vsize);
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
              const sc = getImageStorageClassName(r);
              return sc || '-';
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
        const virtual = isTowerUploadVirtualRow(r);
        const localUpload = isLocalUploadImageRow(r);
        const deleteClusterImage = localUpload && shouldDeleteClusterImageForLocalUploadRow(r);
        const canSync = canShowTowerUploadSyncAction(r, uploadTasks);
        const deleteBlockedMessage = getImageRowDeleteBlockedMessage(r, vms);
        const deleteDisabled = !hasImagesWrite || Boolean(deleteBlockedMessage);

        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={filterMenuItemsForReadOnly([
              ...(canSync
                ? [
                    {
                      key: 'sync',
                      label: '同步',
                      disabled: !hasImagesWrite,
                      onClick: () => {
                        if (!ensureImagesWrite()) return;
                        onSyncUploadTask?.(r);
                      },
                    },
                    { type: 'divider' as const },
                  ]
                : []),
              ...(!isTenant && !virtual
                ? [{ key: 'yaml', label: '查看YAML', onClick: () => onOpenYaml(r) }]
                : []),
              {
                key: 'editLabels',
                label: '编辑标签',
                disabled: !hasImagesWrite || virtual,
                onClick: () => onEditLabels(r),
              },
              { type: 'divider' },
              {
                key: 'delete',
                label: deleteBlockedMessage ? (
                  <Tooltip title={deleteBlockedMessage}>
                    <span>删除</span>
                  </Tooltip>
                ) : (
                  '删除'
                ),
                danger: true,
                disabled: deleteDisabled,
                onClick: () =>
                  Modal.confirm({
                    title: localUpload
                      ? deleteClusterImage
                        ? '确认删除镜像？'
                        : '确认删除镜像暂存数据？'
                      : '确认删除镜像？',
                    content: localUpload
                      ? imageListLocalUploadDeleteConfirmContent(r)
                      : `确定要删除镜像 ${deleteLabel} 吗？此操作不可恢复。`,
                    onOk: async () => {
                      if (!ensureImagesWrite()) return;
                      await onDeleteRow(r);
                    },
                  }),
              },
            ], hasImagesWrite)}
          />
        );
      },
    },
  ];
}
