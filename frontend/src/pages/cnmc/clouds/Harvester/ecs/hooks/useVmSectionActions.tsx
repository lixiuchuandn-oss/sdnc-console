import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import {
  InfoCircleOutlined,
  SafetyCertificateFilled,
  WarningOutlined,
} from '@ant-design/icons';
import { stopCloudProviderEcs } from '../../../../../../services/api';
import {
  fetchHarvesterNads,
  fetchHarvesterNodes,
  fetchHarvesterVncUrl,
  patchHarvesterVm,
} from '../../../../../../services/harvesterApi';
import {
  assignVmDesktopUsers,
  fetchPoolGatewayAccess,
} from '../../../../../../services/guacamoleApi';
import { useCloudDesktopPermission } from '../../../../../../hooks/useCloudDesktopPermission';
import type { VmListSafeRead } from '../lib/vmSafeRead';
import { getVmInstanceId } from '../lib/vmSectionUtils';
import { runHarvesterSectionRefresh } from '../../shared/lib/harvesterSectionRefresh';
import { confirmHighRiskOperation } from '../../shared/lib/highRiskConfirm';
import { VM_RECYCLE_RISK_ITEMS } from '../../shared/lib/highRiskOperationPresets';
import { buildHarvesterVncPageUrl } from '../lib/harvesterVncPageUrl';
import {
  assessVmMigrateEligibility,
  buildVmAliasPatch,
  buildVmImportantTogglePatch,
  isVmDeletionProtected,
  listVmPvcClaimNames,
  mapBatchVmOperation,
  partitionVmBatchRecycleTargets,
  resolveVmNsName,
  summarizeBatchRecycleMessage,
} from '../lib/vmSectionActions';

export type UseVmSectionActionsParams = {
  vms: any[];
  cloudId: string;
  safeRead: VmListSafeRead;
  onRefresh: (force?: boolean) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onDelete: (iid: string, deleteVolumes?: boolean, isBatch?: boolean) => void;
};

export function useVmSectionActions({
  vms,
  cloudId,
  safeRead: SafeRead,
  onRefresh,
  onStop,
  onReboot,
  onDelete,
}: UseVmSectionActionsParams) {
  const { modal, message } = App.useApp();
  const { canRead: canReadDesktop } = useCloudDesktopPermission();
  const getIid = getVmInstanceId;

  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);
  const [metadataActiveTab, setMetadataActiveTab] = useState('detail');

  const [migrateModalVisible, setMigrateModalVisible] = useState(false);
  const [currentMigrateVm, setCurrentMigrateVm] = useState<any>(null);

  const [vmBackupModalVisible, setVmBackupModalVisible] = useState(false);
  const [vmBackupModalType, setVmBackupModalType] = useState<'backup' | 'snapshot'>('backup');
  const [vmBackupModalVm, setVmBackupModalVm] = useState<any>(null);

  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [cloneSourceVm, setCloneSourceVm] = useState<any>(null);

  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasVm, setAliasVm] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);

  const [desktopGatewayReady, setDesktopGatewayReady] = useState(false);
  const [desktopModalOpen, setDesktopModalOpen] = useState(false);
  const [desktopModalVm, setDesktopModalVm] = useState<any>(null);
  const [desktopSubmitting, setDesktopSubmitting] = useState(false);

  useEffect(() => {
    if (!cloudId || !canReadDesktop) {
      setDesktopGatewayReady(false);
      return;
    }
    let cancelled = false;
    void fetchPoolGatewayAccess(cloudId)
      .then((res) => {
        if (!cancelled) setDesktopGatewayReady(!!res?.ready);
      })
      .catch(() => {
        if (!cancelled) setDesktopGatewayReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId, canReadDesktop]);

  const guessDesktopDefaults = useCallback(
    (r: any) => {
      const os =
        SafeRead.os(r) || SafeRead.imageDisplayName(r) || SafeRead.name(r) || '';
      const isWin = /windows|win/i.test(os);
      return {
        username: isWin ? 'Administrator' : 'root',
        protocol: 'auto',
      };
    },
    [SafeRead],
  );

  const handleAssignDesktop = useCallback(
    (r: any) => {
      if (!desktopGatewayReady) {
        message.warning('请先在系统设置注册云桌面网关，并为本资源池启用接入');
        return;
      }
      const ip = SafeRead.ip(r);
      if (!ip) {
        message.warning('暂无 IP，请确认 Guest Agent 与网络配置');
        return;
      }
      setDesktopModalVm(r);
      setDesktopModalOpen(true);
    },
    [SafeRead, desktopGatewayReady, message],
  );

  const handleSubmitDesktopAssign = useCallback(
    async (values: {
      desktop_user_ids: string[];
      username: string;
      password: string;
      protocol?: string;
    }) => {
      const r = desktopModalVm;
      if (!r) return;
      const iid = getIid(r);
      const { ns, name } = resolveVmNsName(iid, r, SafeRead);
      if (!ns || !name) {
        message.error('无法解析虚拟机坐标');
        return;
      }
      setDesktopSubmitting(true);
      try {
        await assignVmDesktopUsers({
          cloud_id: cloudId,
          namespace: ns,
          resource_id: name,
          desktop_user_ids: values.desktop_user_ids,
          protocol: values.protocol,
          username: values.username,
          ...(String(values.password || '').trim()
            ? { password: String(values.password).trim() }
            : {}),
        });
        message.success('已分配云桌面用户，对方可用统一密码登录云桌面网关');
        setDesktopModalOpen(false);
        setDesktopModalVm(null);
      } catch (e: any) {
        message.error(e?.message || '分配失败');
      } finally {
        setDesktopSubmitting(false);
      }
    },
    [cloudId, desktopModalVm, SafeRead, message, getIid],
  );

  const drawerRecord = useMemo(() => {
    if (!currentMetadata) return null;
    const currentId = getIid(currentMetadata);
    return vms.find((v) => getIid(v) === currentId) || currentMetadata;
  }, [vms, currentMetadata, getIid]);

  const handleShowVmDetail = useCallback((record: any, tab: string = 'detail') => {
    setCurrentMetadata(record);
    setMetadataActiveTab(tab);
    setMetadataModalVisible(true);
  }, []);

  const handleWebVnc = useCallback(
    async (r: any) => {
      const iid = getIid(r);
      try {
        const { ns, name } = resolveVmNsName(iid, r, SafeRead);
        if (ns && name) {
          const url = buildHarvesterVncPageUrl(cloudId, ns, name);
          window.open(url, '_blank');
          return;
        }
        const j = await fetchHarvesterVncUrl(cloudId, iid);
        const url = j?.data?.VncUrl || j?.data?.vncUrl || j?.data?.url;
        if (url) {
          window.open(url, '_blank');
          return;
        }
        message.warning('该实例暂不支持 VNC');
      } catch (e: any) {
        message.error(e?.message || '获取VNC地址失败');
      }
    },
    [cloudId, SafeRead, message, getIid],
  );

  const handleBackup = useCallback((r: any) => {
    setVmBackupModalVm(r);
    setVmBackupModalType('backup');
    setVmBackupModalVisible(true);
  }, []);

  const handleSnapshot = useCallback((r: any) => {
    setVmBackupModalVm(r);
    setVmBackupModalType('snapshot');
    setVmBackupModalVisible(true);
  }, []);

  const handleClone = useCallback((r: any) => {
    setCloneSourceVm(r);
    setCloneModalVisible(true);
  }, []);

  const handleToggleImportant = useCallback(
    async (r: any) => {
      const finalizers = r?.metadata?.finalizers || [];
      const isProtected = finalizers.includes('tower.io/deletion-protection');
      const ns = SafeRead.namespace(r);
      const name = SafeRead.vmId(r);
      const patchBody = buildVmImportantTogglePatch(r);

      try {
        if (patchBody.length > 0) {
          await patchHarvesterVm(
            cloudId,
            ns,
            name,
            patchBody,
            'application/json-patch+json',
          );
          message.success(
            isProtected
              ? '已取消重要实例标记 (防删锁已移除)'
              : '已设为重要实例 (防删锁已启用)',
          );
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }
      } catch (e: any) {
        console.error(e);
        message.error(`操作失败: ${e.message}`);
      }
    },
    [cloudId, onRefresh, SafeRead, message],
  );

  const handleDeleteConfirm = useCallback(
    (r: any) => {
      if (isVmDeletionProtected(r)) {
        modal.warning({
          title: '无法删除重要实例',
          icon: <SafetyCertificateFilled style={{ color: '#faad14' }} />,
          content: (
            <div style={{ marginTop: 12 }}>
              <p>
                该实例被标记为 <b>重要实例</b>，受到防删保护。
              </p>
              <p>如需删除，请先在操作菜单中取消“设为重要实例”标记。</p>
            </div>
          ),
          okText: '知道了',
        });
        return;
      }

      const iid = getIid(r);
      const vmName = SafeRead.name(r);
      const status = String(SafeRead.status(r)).toLowerCase();
      const isRunning = status === 'running' || status === 'starting';
      const volumeNames = listVmPvcClaimNames(r);
      const deleteVolumes = false;

      void confirmHighRiskOperation({
        title: '移入回收站',
        targetName: vmName,
        requireTypeConfirm: true,
        description: `确定要将虚拟机「${vmName}」移入回收站吗？`,
        riskItems: VM_RECYCLE_RISK_ITEMS,
        confirmText: '移入回收站',
        operationSummary: `确认将虚拟机「${vmName}」移入回收站`,
        extra: (
          <div>
            {isRunning && (
              <div
                style={{
                  marginBottom: 16,
                  color: '#ff4d4f',
                  background: '#fff1f0',
                  padding: '8px 12px',
                  border: '1px solid #ffccc7',
                  borderRadius: 4,
                }}
              >
                <WarningOutlined style={{ marginRight: 8 }} />
                警告：虚拟机正在运行中。删除操作将强制终止虚拟机。建议先停止虚拟机。
              </div>
            )}
            <div
              style={{
                marginBottom: 16,
                color: '#1890ff',
                background: '#e6f7ff',
                padding: '8px 12px',
                border: '1px solid #91d5ff',
                borderRadius: 4,
              }}
            >
              <InfoCircleOutlined style={{ marginRight: 8 }} />
              虚拟机将被移入回收站，您可以在回收站中恢复或彻底删除。
            </div>
            {volumeNames ? (
              <div
                style={{
                  marginBottom: 16,
                  background: '#f5f5f5',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: 4,
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 4 }}>关联的数据卷 (PVC):</div>
                <div style={{ color: 'rgba(0,0,0,0.65)' }}>{volumeNames}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  注意：移入回收站时不会删除关联的数据卷
                  (PVC)。如需删除数据卷，请在回收站中执行彻底删除操作。
                </div>
              </div>
            ) : null}
          </div>
        ),
        onConfirm: () => onDelete(iid, deleteVolumes, false),
      }).catch(() => undefined);
    },
    [onDelete, SafeRead, modal, getIid],
  );

  const handleOpenAliasModal = useCallback((r: any) => {
    setAliasVm(r);
    setAliasModalVisible(true);
  }, []);

  const handleSubmitAlias = useCallback(
    async (nextAliasRaw?: string) => {
      if (!aliasVm) return false;
      const ns = SafeRead.namespace(aliasVm);
      const name = SafeRead.vmId(aliasVm);
      if (!ns || !name) {
        message.error('未能解析虚拟机命名空间或名称');
        return false;
      }

      const next = String(nextAliasRaw || '').trim();
      const prev = String(
        aliasVm?.metadata?.annotations?.['tower.io/alias'] || '',
      ).trim();
      if (next === prev) {
        setAliasModalVisible(false);
        return true;
      }

      const patchResult = buildVmAliasPatch(aliasVm, nextAliasRaw);
      if (patchResult.kind === 'error') {
        message.error(patchResult.message);
        return false;
      }
      if (patchResult.kind === 'noop') {
        setAliasModalVisible(false);
        return true;
      }

      setAliasSubmitting(true);
      try {
        await patchHarvesterVm(
          cloudId,
          ns,
          name,
          patchResult.patchBody,
          'application/json-patch+json',
        );
        message.success(next ? '名称修改成功' : '已清空别名');
        setAliasModalVisible(false);
        setAliasVm(null);
        void runHarvesterSectionRefresh(onRefresh, { force: true });
        return true;
      } catch (e: any) {
        console.error(e);
        message.error(e?.message || '名称修改失败');
        return false;
      } finally {
        setAliasSubmitting(false);
      }
    },
    [aliasVm, SafeRead, cloudId, message, onRefresh],
  );

  const handleMigrate = useCallback(
    async (r: any) => {
      const assessment = await assessVmMigrateEligibility(
        r,
        cloudId,
        fetchHarvesterNodes,
        fetchHarvesterNads,
      );
      if (!assessment.allowed) {
        message.warning(assessment.reason);
        return;
      }
      setCurrentMigrateVm(r);
      setMigrateModalVisible(true);
    },
    [cloudId, message],
  );

  const batchStop = useCallback(async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r: any) => selectedKeys.includes(getIid(r)));
      const results = await Promise.all(
        targets.map(async (r: any) => {
          const iid = getIid(r);
          try {
            const { ns, name } = resolveVmNsName(iid, r, SafeRead);
            if (ns && name) {
              await stopCloudProviderEcs(cloudId, `${ns}/${name}`, true);
            } else {
              await onStop(iid);
            }
            return { ok: true, iid };
          } catch (e: any) {
            return { ok: false, iid, err: e?.message || String(e) };
          }
        }),
      );
      const ok = results.filter((x) => x.ok).length;
      const fail = results.filter((x) => !x.ok);
      if (ok > 0) message.success(`停止成功 ${ok} 台`);
      if (fail.length > 0) {
        message.error(`停止失败 ${fail.length} 台：${fail.map((f) => f.iid).join(', ')}`);
      }
      setSelectedKeys([]);
    } catch (e: any) {
      message.error(e?.message || '批量停止失败');
    }
  }, [selectedKeys, vms, SafeRead, cloudId, onStop, message, getIid]);

  const batchReboot = useCallback(async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r: any) => selectedKeys.includes(getIid(r)));
      const results = await mapBatchVmOperation(targets, getIid, async (_r, iid) => {
        await onReboot(iid);
      });
      const ok = results.filter((x) => x.ok).length;
      const fail = results.filter((x) => !x.ok);
      if (ok > 0) message.success(`重启成功 ${ok} 台`);
      if (fail.length > 0) {
        message.error(`重启失败 ${fail.length} 台：${fail.map((f) => f.iid).join(', ')}`);
      }
      setSelectedKeys([]);
    } catch (e: any) {
      message.error(e?.message || '批量重启失败');
    }
  }, [selectedKeys, vms, onReboot, message, getIid]);

  const batchDelete = useCallback(() => {
    if (selectedKeys.length === 0) return;

    void confirmHighRiskOperation({
      title: '批量移入回收站',
      description: `确定要将选中的 ${selectedKeys.length} 台虚拟机移入回收站吗？`,
      riskItems: VM_RECYCLE_RISK_ITEMS,
      requireTypeConfirm: false,
      confirmText: '移入回收站',
      operationSummary: `确认批量移入回收站（${selectedKeys.length} 台）`,
      extra: (
        <div
          style={{
            marginBottom: 16,
            color: '#1890ff',
            background: '#e6f7ff',
            padding: '8px 12px',
            border: '1px solid #91d5ff',
            borderRadius: 4,
          }}
        >
          <InfoCircleOutlined style={{ marginRight: 8 }} />
          虚拟机将被移入回收站，您可以在回收站中恢复或彻底删除。移入回收站时不会删除关联的数据卷
          (PVC)。
        </div>
      ),
      onConfirm: async () => {
        try {
          const targets = (vms || []).filter((r: any) => selectedKeys.includes(getIid(r)));
          const { protectedTargets, deletableTargets } =
            partitionVmBatchRecycleTargets(targets);
          const results = await mapBatchVmOperation(
            deletableTargets,
            getIid,
            async (_r, iid) => {
              await onDelete(iid, false, true);
            },
          );
          const resultsWithNames = results.map((item, idx) => ({
            ...item,
            name: SafeRead.name(deletableTargets[idx]) || item.iid,
          }));
          const { success, error } = summarizeBatchRecycleMessage(
            resultsWithNames,
            protectedTargets,
            SafeRead.name,
          );
          if (success) message.success(success);
          if (error) {
            console.error(
              'Batch recycle-bin errors:',
              resultsWithNames.filter((x) => !x.ok),
            );
            message.error(error);
          }
          setSelectedKeys([]);
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: any) {
          message.error(e?.message || '批量移入回收站失败');
          throw e;
        }
      },
    }).catch(() => undefined);
  }, [selectedKeys, vms, SafeRead, message, onDelete, onRefresh, getIid]);

  return {
    selectedKeys,
    setSelectedKeys,
    metadataModalVisible,
    setMetadataModalVisible,
    metadataActiveTab,
    setMetadataActiveTab,
    drawerRecord,
    migrateModalVisible,
    setMigrateModalVisible,
    currentMigrateVm,
    vmBackupModalVisible,
    setVmBackupModalVisible,
    vmBackupModalType,
    vmBackupModalVm,
    cloneModalVisible,
    setCloneModalVisible,
    cloneSourceVm,
    aliasModalVisible,
    setAliasModalVisible,
    aliasVm,
    setAliasVm,
    aliasSubmitting,
    handleShowVmDetail,
    handleWebVnc,
    handleAssignDesktop,
    desktopGatewayReady,
    desktopModalOpen,
    setDesktopModalOpen,
    desktopModalVm,
    desktopSubmitting,
    handleSubmitDesktopAssign,
    guessDesktopDefaults,
    handleBackup,
    handleSnapshot,
    handleClone,
    handleToggleImportant,
    handleDeleteConfirm,
    handleOpenAliasModal,
    handleSubmitAlias,
    handleMigrate,
    batchStop,
    batchReboot,
    batchDelete,
  };
}
