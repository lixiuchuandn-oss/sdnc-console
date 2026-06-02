import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import { rebootCloudProviderEcs } from 'services/api';
import { deleteHarvesterVolume, detachHarvesterVolumeFromVm } from 'services/harvesterApi';
import { pickDefaultStorageClassName } from 'utils/harvesterUtils';
import type { VolumeCreateSeed } from '../modals/VolumeCreateModal';
import {
  countVolumeBatchDeleteSuccess,
  isVolumeDeleteInUseError,
  resolveAttachedDiskName,
  resolveVmInstanceIds,
  resolveVmRebootTargetId,
  vmDisplayLabel,
  type VmAttachRecord,
} from '../lib/volumeDetachUtils';
import {
  checkIsVolumeSystemDisk,
  createVolumeSafeRead,
  volumeDisplayLabel,
} from '../lib/volumeSafeRead';
import { buildStorageClassSelectOptions } from '../lib/volumesStorageClassUtils';
import type { VolumeView } from '../lib/volumesSectionTypes';
import { volumeDetailRawRecord } from '../lib/volumesSectionUtils';
import { useStableBurstVolumeRefresh } from './useVolumesListPoll';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/ebsSectionRefresh';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import {
  confirmHighRiskDelete,
  confirmHighRiskOperation,
} from '../../shared/lib/highRiskConfirm';
import { DELETE_STORAGE_RISK_ITEMS } from '../../shared/lib/highRiskOperationPresets';

export type UseVolumesSectionActionsParams = {
  cloudId: string;
  vms?: unknown[];
  propStorageClasses?: unknown[];
  onRefresh?: HarvesterSectionOnRefresh;
  onRefreshImages?: HarvesterSectionOnRefresh;
  hasDisksWrite: boolean;
  ensureDisksWrite: () => boolean;
  isTenant?: boolean;
  dataSource: VolumeView[];
  selectedRowKeys: React.Key[];
  setSelectedRowKeys: (keys: React.Key[]) => void;
};

export function useVolumesSectionActions({
  cloudId,
  vms,
  propStorageClasses,
  onRefresh,
  onRefreshImages,
  hasDisksWrite,
  ensureDisksWrite,
  isTenant,
  dataSource,
  selectedRowKeys,
  setSelectedRowKeys,
}: UseVolumesSectionActionsParams) {
  const { message: msg, modal } = App.useApp();
  const safeRead = useMemo(() => createVolumeSafeRead(vms), [vms]);
  const burstRefreshVolumes = useStableBurstVolumeRefresh(onRefresh);

  const [createOpen, setCreateOpen] = useState(false);
  const [createModalNonce, setCreateModalNonce] = useState(0);
  const [volumeCreateSeed, setVolumeCreateSeed] = useState<VolumeCreateSeed | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachModalNonce, setAttachModalNonce] = useState(0);
  const [attachInitialInstanceId, setAttachInitialInstanceId] = useState<string | undefined>();
  const [exportOpen, setExportOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneModalNonce, setCloneModalNonce] = useState(0);

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<unknown>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');
  const [detailOpsMode, setDetailOpsMode] = useState(false);

  const [currentRecord, setCurrentRecord] = useState<VolumeView | null>(null);
  const [storageClasses, setStorageClasses] = useState<unknown[]>([]);

  useEffect(() => {
    if (propStorageClasses) setStorageClasses(propStorageClasses);
  }, [propStorageClasses]);

  const defaultStorageClassName = useMemo(
    () => pickDefaultStorageClassName(storageClasses),
    [storageClasses],
  );

  const createVolumeStorageClassOptions = useMemo(
    () => buildStorageClassSelectOptions(storageClasses),
    [storageClasses],
  );

  const openVolumeDetail = useCallback((record: VolumeView, tab = 'detail', opsMode = false) => {
    setDetailRecord(volumeDetailRawRecord(record));
    setDetailActiveTab(tab);
    setDetailOpsMode(opsMode);
    setDetailVisible(true);
  }, []);

  const handleOpenVolumeDetail = useCallback(
    (record: VolumeView, tab = 'detail') => openVolumeDetail(record, tab, false),
    [openVolumeDetail],
  );

  const handleOpenOpsDrawer = useCallback(
    (record: VolumeView, tab = 'detail') => openVolumeDetail(record, tab, true),
    [openVolumeDetail],
  );

  const handleBatchDelete = useCallback(() => {
    if (!ensureDisksWrite()) return;
    if (selectedRowKeys.length === 0) return;
    const targets = dataSource.filter((v) => selectedRowKeys.includes(v.key));

    void confirmHighRiskOperation({
      title: '批量删除确认',
      description: `即将删除 ${targets.length} 个云盘：${targets.map(volumeDisplayLabel).join(', ')}`,
      riskItems: DELETE_STORAGE_RISK_ITEMS,
      requireTypeConfirm: false,
      confirmText: '删除',
      operationSummary: `确认批量删除 ${targets.length} 个云盘`,
      onConfirm: async () => {
        try {
          const results = await Promise.allSettled(
            targets.map((t) => deleteHarvesterVolume(cloudId, t.namespace, t.name)),
          );
          const { ok, fail } = countVolumeBatchDeleteSuccess(results);
          if (ok > 0) msg.success(`成功删除 ${ok} 个云盘`);
          if (fail > 0) msg.error(`${fail} 个云盘删除失败`);
          setSelectedRowKeys([]);
          burstRefreshVolumes();
        } catch (e: unknown) {
          const err = e as { message?: string };
          msg.error(err.message || '批量删除失败');
          throw e;
        }
      },
    }).catch(() => undefined);
  }, [
    burstRefreshVolumes,
    cloudId,
    dataSource,
    ensureDisksWrite,
    msg,
    selectedRowKeys,
    setSelectedRowKeys,
  ]);

  const handleAttach = useCallback(
    (r: VolumeView) => {
      if (!ensureDisksWrite()) return;
      if (!vms || (vms as unknown[]).length === 0) {
        void runHarvesterSectionRefresh(onRefresh, { force: true });
      }
      const vm = safeRead.attachedVm(r) as VmAttachRecord | undefined;
      setCurrentRecord(r);
      setAttachInitialInstanceId(vm ? String(vm.id || vm.InstanceId || '') : undefined);
      setAttachModalNonce((n) => n + 1);
      setAttachOpen(true);
    },
    [ensureDisksWrite, onRefresh, safeRead, vms],
  );

  const handleBranchCloneToCreateVolume = useCallback((seed: VolumeCreateSeed) => {
    setVolumeCreateSeed(seed);
    setCreateModalNonce((n) => n + 1);
    setCreateOpen(true);
  }, []);

  const handleDetach = useCallback(
    async (r: VolumeView) => {
      if (!ensureDisksWrite()) return;
      if (!vms || (vms as unknown[]).length === 0) {
        void runHarvesterSectionRefresh(onRefresh, { force: true });
        msg.loading('正在同步云主机数据，请稍后重试...', 1);
        return;
      }

      const vm = safeRead.attachedVm(r) as VmAttachRecord | undefined;
      if (!vm) {
        msg.warning('无法找到关联的云主机，请确认数据已同步');
        return;
      }

      if (checkIsVolumeSystemDisk(r, vm)) {
        msg.warning('系统盘不支持通过此入口卸载，如需变更请使用重建/镜像等高级操作。');
        return;
      }

      const diskName = resolveAttachedDiskName(vm, r.name);
      if (!diskName) {
        modal.confirm({
          title: '无法确定挂载的磁盘名称',
          content:
            '请先在虚机内卸载该云盘（umount/移除磁盘），以避免数据损坏。是否重启虚拟机以完成卸载？',
          okText: '重启虚拟机',
          cancelText: '取消',
          onOk: async () => {
            try {
              const resolvedId = resolveVmRebootTargetId(vm);
              if (!resolvedId) {
                msg.error('实例标识缺失，无法重启');
                return;
              }
              await rebootCloudProviderEcs(cloudId, resolvedId);
              msg.success('已触发重启');
            } catch (e: unknown) {
              const err = e as { message?: string };
              msg.error(err.message || '重启失败');
            }
          },
        });
        return;
      }

      const { resolvedId, iidNameOnly } = resolveVmInstanceIds(vm);
      modal.confirm({
        title: '确认卸载',
        content: `将从云主机 ${vm.InstanceName || vm.InstanceId} 卸载云盘 ${r.name}`,
        onOk: async () => {
          try {
            try {
              await detachHarvesterVolumeFromVm(cloudId, resolvedId, { name: String(diskName) });
            } catch (e: unknown) {
              const err = e as { message?: string };
              if (String(err?.message).includes('NotFound')) {
                await detachHarvesterVolumeFromVm(cloudId, iidNameOnly, { name: String(diskName) });
              } else {
                throw e;
              }
            }
            msg.success('卸载成功');
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            const err = e as { message?: string };
            msg.error(err.message || '卸载失败');
          }
        },
      });
    },
    [cloudId, ensureDisksWrite, modal, msg, onRefresh, safeRead, vms],
  );

  const buildRowActionItems = useCallback(
    (r: VolumeView) => {
      const vm = safeRead.attachedVm(r) as VmAttachRecord | undefined;
      const isSystemDisk = checkIsVolumeSystemDisk(r, vm);
      const vmLabel = vm ? vmDisplayLabel(vm) : '';
      const diskLabel = r.alias ? `${r.alias}（${r.name}）` : r.name;

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
        items.push(
          { key: 'volume_detail', label: '云盘详情', onClick: () => handleOpenVolumeDetail(r, 'detail') },
          { key: 'detail', label: '查看YAML', onClick: () => handleOpenOpsDrawer(r, 'detail') },
        );
      }

      items.push(
        {
          key: 'edit',
          label: '编辑配置',
          disabled: !hasDisksWrite,
          onClick: () => {
            if (!ensureDisksWrite()) return;
            setCurrentRecord(r);
            setEditOpen(true);
          },
        },
        {
          key: 'attach',
          label: '挂载到虚拟机',
          disabled: !!vm || !hasDisksWrite,
          onClick: () => handleAttach(r),
        },
        {
          key: 'export',
          label: '导出为镜像',
          disabled: !hasDisksWrite,
          onClick: () => {
            if (!ensureDisksWrite()) return;
            setCurrentRecord(r);
            setExportOpen(true);
          },
        },
        {
          key: 'snapshot',
          label: '创建快照',
          disabled: !hasDisksWrite,
          onClick: () => {
            if (!ensureDisksWrite()) return;
            setCurrentRecord(r);
            setSnapshotOpen(true);
          },
        },
        {
          key: 'clone',
          label: '克隆云盘',
          disabled: !hasDisksWrite,
          onClick: () => {
            if (!ensureDisksWrite()) return;
            setCurrentRecord(r);
            setCloneModalNonce((n) => n + 1);
            setCloneOpen(true);
          },
        },
        { type: 'divider', key: 'divider-data-ops' },
      );

      if (vm) {
        items.push({
          key: 'detach',
          label: '从云主机卸载',
          danger: true,
          disabled: isSystemDisk || !hasDisksWrite,
          onClick: () => void handleDetach(r),
        });
      }

      items.push({
        key: 'delete',
        label: '删除',
        danger: true,
        disabled: !hasDisksWrite,
        onClick: () => {
          if (!ensureDisksWrite()) return;
          void confirmHighRiskDelete({
            title: '确认删除云盘',
            resourceLabel: '云盘',
            name: r.name,
            description: `确定要删除云盘「${diskLabel}」吗？删除后无法恢复。`,
            riskItems: DELETE_STORAGE_RISK_ITEMS,
            extra: vm ? (
              <div style={{ color: '#d48806' }}>
                该云盘仍挂载在云主机：{vmLabel}，请先卸载后再删除。
              </div>
            ) : undefined,
            precheck: async () => {
              if (vm) {
                return {
                  ok: false,
                  error: `该云盘已挂载到云主机：${vmLabel}，请先卸载后再删除`,
                };
              }
              return { ok: true };
            },
            onConfirm: async () => {
              try {
                await deleteHarvesterVolume(cloudId, r.namespace, r.name);
                msg.success('删除成功');
                burstRefreshVolumes();
              } catch (e: unknown) {
                const err = e as { message?: string };
                msg.error(
                  isVolumeDeleteInUseError(err.message || '', !!vm)
                    ? `删除失败，当前云盘被云主机实例 ${vmLabel} 使用`
                    : err.message || '删除失败',
                );
                throw e;
              }
            },
          }).catch(() => undefined);
        },
      });

      return filterMenuItemsForReadOnly(items as any[], hasDisksWrite);
    },
    [
      burstRefreshVolumes,
      cloudId,
      ensureDisksWrite,
      handleAttach,
      handleDetach,
      handleOpenOpsDrawer,
      handleOpenVolumeDetail,
      hasDisksWrite,
      isTenant,
      msg,
      safeRead,
    ],
  );

  return {
    safeRead,
    storageClasses,
    defaultStorageClassName,
    createVolumeStorageClassOptions,
    createOpen,
    setCreateOpen,
    createModalNonce,
    setCreateModalNonce,
    volumeCreateSeed,
    setVolumeCreateSeed,
    attachOpen,
    setAttachOpen,
    attachModalNonce,
    attachInitialInstanceId,
    exportOpen,
    setExportOpen,
    snapshotOpen,
    setSnapshotOpen,
    editOpen,
    setEditOpen,
    cloneOpen,
    setCloneOpen,
    cloneModalNonce,
    detailVisible,
    setDetailVisible,
    detailRecord,
    detailActiveTab,
    setDetailActiveTab,
    detailOpsMode,
    currentRecord,
    handleOpenVolumeDetail,
    handleOpenOpsDrawer,
    handleBatchDelete,
    handleBranchCloneToCreateVolume,
    buildRowActionItems,
    onRefreshImages,
  };
}
