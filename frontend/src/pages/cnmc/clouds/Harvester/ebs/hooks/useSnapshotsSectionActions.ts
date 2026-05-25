import React, { useCallback, useState } from 'react';
import { Modal, message } from 'antd';
import { deleteHarvesterSnapshot } from 'services/harvesterApi';
import {
  snapshotDetailRawRecord,
  snapshotDisplayLabel,
  type SnapshotListRow,
} from '../lib/snapshotsSectionUtils';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';

export type UseSnapshotsSectionActionsParams = {
  cloudId: string;
  dataSource: SnapshotListRow[];
  hasSnapshotsWrite: boolean;
  isTenant?: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  selectedRowKeys: React.Key[];
  setSelectedRowKeys: (keys: React.Key[]) => void;
};

export function useSnapshotsSectionActions({
  cloudId,
  dataSource,
  hasSnapshotsWrite,
  isTenant,
  onRefresh,
  selectedRowKeys,
  setSelectedRowKeys,
}: UseSnapshotsSectionActionsParams) {
  const [restoreVisible, setRestoreVisible] = useState(false);
  const [restoreRecord, setRestoreRecord] = useState<SnapshotListRow | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<unknown>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const handleRestore = useCallback(
    (record: SnapshotListRow) => {
      if (!hasSnapshotsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      setRestoreRecord(record);
      setRestoreVisible(true);
    },
    [hasSnapshotsWrite],
  );

  const handleOpenDrawer = useCallback((record: SnapshotListRow, tab = 'detail') => {
    setDetailRecord(snapshotDetailRawRecord(record));
    setDetailActiveTab(tab);
    setDetailVisible(true);
  }, []);

  const handleDelete = useCallback(
    (record: SnapshotListRow) => {
      if (!hasSnapshotsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除快照 ${snapshotDisplayLabel(record)} (${record.name}) 吗？`,
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteHarvesterSnapshot(cloudId, record.namespace, record.name);
            message.success('删除成功');
            onRefresh?.(true);
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err.message || '删除失败');
          }
        },
      });
    },
    [cloudId, hasSnapshotsWrite, onRefresh],
  );

  const handleBatchDelete = useCallback(() => {
    if (!hasSnapshotsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter((s) => selectedRowKeys.includes(s.key));

    Modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${targets.length} 个快照：${targets.map(snapshotDisplayLabel).join(', ')}`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const results = await Promise.allSettled(
            targets.map((t) => deleteHarvesterSnapshot(cloudId, t.namespace, t.name)),
          );
          const ok = results.filter((x) => x.status === 'fulfilled').length;
          const fail = results.length - ok;
          if (ok > 0) message.success(`成功删除 ${ok} 个快照`);
          if (fail > 0) message.error(`${fail} 个快照删除失败`);
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: unknown) {
          const err = e as { message?: string };
          message.error(err.message || '批量删除失败');
        }
      },
    });
  }, [cloudId, dataSource, hasSnapshotsWrite, onRefresh, selectedRowKeys, setSelectedRowKeys]);

  const buildRowActionItems = useCallback(
    (record: SnapshotListRow) => {
      const items: Array<
        | {
            key: string;
            label: React.ReactNode;
            disabled?: boolean;
            danger?: boolean;
            onClick?: () => void;
          }
        | { type: 'divider'; key?: string }
      > = [];
      if (!isTenant) {
        items.push({
          key: 'detail',
          label: '查看YAML',
          onClick: () => handleOpenDrawer(record, 'detail'),
        });
        items.push({ type: 'divider', key: 'divider-yaml-ops' });
      }
      items.push(
        {
          key: 'restore',
          label: '恢复',
          onClick: () => handleRestore(record),
          disabled: !record.readyToUse || !hasSnapshotsWrite,
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => handleDelete(record),
          disabled: !hasSnapshotsWrite,
        },
      );
      return items;
    },
    [handleDelete, handleOpenDrawer, handleRestore, hasSnapshotsWrite, isTenant],
  );

  return {
    restoreVisible,
    setRestoreVisible,
    restoreRecord,
    detailVisible,
    setDetailVisible,
    detailRecord,
    detailActiveTab,
    setDetailActiveTab,
    handleBatchDelete,
    buildRowActionItems,
  };
}
