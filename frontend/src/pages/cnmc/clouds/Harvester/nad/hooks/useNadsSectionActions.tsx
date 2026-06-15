import React, { useCallback, useState } from 'react';
import { message } from 'antd';
import { deleteHarvesterNad } from '../../../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/nadSectionRefresh';
import {
  confirmHighRiskDelete,
  DELETE_NETWORK_RISK_ITEMS,
} from '../../shared/lib/highRiskConfirm';
import {
  collectVmDisplayNamesUsingNad,
  findDependentSubnetsForNad,
  getNadRowKey,
  type ProcessedNadRecord,
} from '../lib/nadsSectionUtils';

export type UseNadsSectionActionsParams = {
  cloudId?: string;
  isTenant?: boolean;
  hasNadsWrite: boolean;
  ensureNadsWrite: () => boolean;
  isPublicNamespace: (ns: string) => boolean;
  loadOvnSubnets: (force?: boolean) => Promise<unknown[]>;
  filteredData: ProcessedNadRecord[];
  onRefresh?: HarvesterSectionOnRefresh;
};

export function useNadsSectionActions({
  cloudId,
  isTenant,
  hasNadsWrite: _hasNadsWrite,
  ensureNadsWrite,
  isPublicNamespace,
  loadOvnSubnets,
  filteredData,
  onRefresh,
}: UseNadsSectionActionsParams) {
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [nadYamlDrawerOpen, setNadYamlDrawerOpen] = useState(false);
  const [nadYamlViewLink, setNadYamlViewLink] = useState<string | undefined>();
  const [createVisible, setCreateVisible] = useState(false);

  const openNadYamlDrawer = useCallback(
    (record: ProcessedNadRecord) => {
      if (!cloudId) {
        message.warning('缺少云实例上下文，无法拉取 YAML');
        return;
      }
      const links = record?.links as { view?: string } | undefined;
      const existing = links?.view;
      const ns = String(record?._namespace ?? '').trim();
      const name = String(record?._name ?? '').trim();
      const link = existing
        ? String(existing).trim()
        : ns && name
          ? `/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(ns)}/network-attachment-definitions/${encodeURIComponent(name)}`
          : undefined;
      if (!link) {
        message.warning('当前行缺少 View Link，无法拉取 YAML');
        return;
      }
      setNadYamlViewLink(link);
      setNadYamlDrawerOpen(true);
    },
    [cloudId],
  );

  const closeNadYamlDrawer = useCallback(() => {
    setNadYamlDrawerOpen(false);
    setNadYamlViewLink(undefined);
  }, []);

  const checkNetworkUsage = useCallback(
    async (record: ProcessedNadRecord): Promise<string[]> => {
      try {
        const ecsRes = await fetchCloudProviderEcs(cloudId || '', true);
        const vms = (ecsRes as { data?: unknown[] })?.data || ecsRes || [];
        return collectVmDisplayNamesUsingNad(Array.isArray(vms) ? vms : [], record);
      } catch {
        return [];
      }
    },
    [cloudId],
  );

  const checkSubnetDependency = useCallback(
    async (record: ProcessedNadRecord): Promise<string[]> => {
      try {
        const subnets = await loadOvnSubnets(true);
        return findDependentSubnetsForNad(record, subnets);
      } catch {
        return [];
      }
    },
    [loadOvnSubnets],
  );

  const handleDelete = useCallback(
    async (record: ProcessedNadRecord) => {
      if (!ensureNadsWrite()) return;
      if (isTenant && isPublicNamespace(record._namespace)) {
        message.warning('租户不能删除公共命名空间的资源');
        return;
      }

      const [usingVms, dependentSubnets] = await Promise.all([
        checkNetworkUsage(record),
        checkSubnetDependency(record),
      ]);
      const blockedByVm = usingVms.length > 0;
      const blockedBySubnet = dependentSubnets.length > 0;

      void confirmHighRiskDelete({
        resourceLabel: '虚拟网络',
        name: record._name,
        riskItems: DELETE_NETWORK_RISK_ITEMS,
        precheck: async () => {
          if (blockedByVm) {
            return {
              ok: false,
              error: `不能删除此虚拟网络，因为正在被虚拟机使用：${usingVms
                .slice(0, 5)
                .join('，')}${usingVms.length > 5 ? ' 等' : ''}`,
            };
          }
          if (blockedBySubnet) {
            return {
              ok: false,
              error: `不能删除此虚拟网络，因为正在被 Kube-OVN 子网依赖：${dependentSubnets
                .slice(0, 5)
                .join('，')}${dependentSubnets.length > 5 ? ' 等' : ''}`,
            };
          }
        },
        onConfirm: async () => {
          try {
            await deleteHarvesterNad(cloudId || '', record._namespace, record._name);
            message.success('删除成功');
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err.message || '删除失败');
          }
        },
      }).catch(() => {});
    },
    [
      checkNetworkUsage,
      checkSubnetDependency,
      cloudId,
      ensureNadsWrite,
      isPublicNamespace,
      isTenant,
      onRefresh,
    ],
  );

  const handleBatchDelete = useCallback(async () => {
    if (!ensureNadsWrite()) return;
    if (selectedRowKeys.length === 0) return;

    const targets = filteredData.filter((item) => selectedRowKeys.includes(getNadRowKey(item)));
    if (targets.length === 0) {
      message.warning('未找到可删除的网络');
      return;
    }

    const deletableTargets = targets.filter(
      (item) => !(isTenant && isPublicNamespace(item._namespace)),
    );
    const publicTargets = isTenant
      ? targets.filter((item) => isPublicNamespace(item._namespace))
      : [];

    if (deletableTargets.length === 0) {
      if (publicTargets.length > 0) {
        message.warning(`选中的网络无法删除：${publicTargets.length} 个公共命名空间（租户不能删除）`);
      } else {
        message.warning('选中的网络无法删除');
      }
      setSelectedRowKeys([]);
      return;
    }

    const usageMap = new Map<string, string[]>();
    const subnetDependencyMap = new Map<string, string[]>();

    try {
      const [ecsRes, subnets] = await Promise.all([
        fetchCloudProviderEcs(cloudId || '', true),
        loadOvnSubnets(true),
      ]);
      const vms = (ecsRes as { data?: unknown[] })?.data || ecsRes || [];
      const vmList = Array.isArray(vms) ? vms : [];

      for (const target of deletableTargets) {
        const usingVms = collectVmDisplayNamesUsingNad(vmList, target);
        if (usingVms.length > 0) {
          usageMap.set(`${target._namespace}/${target._name}`, usingVms);
        }
        const dependentSubnets = findDependentSubnetsForNad(target, subnets);
        if (dependentSubnets.length > 0) {
          subnetDependencyMap.set(`${target._namespace}/${target._name}`, dependentSubnets);
        }
      }
    } catch {
      // 忽略占用检查错误
    }

    const blockedByVm = Array.from(usageMap.entries());
    const blockedBySubnet = Array.from(subnetDependencyMap.entries());
    const canDelete = deletableTargets.filter(
      (t) =>
        !usageMap.has(`${t._namespace}/${t._name}`) &&
        !subnetDependencyMap.has(`${t._namespace}/${t._name}`),
    );
    const hasDeletable = canDelete.length > 0;

    void confirmHighRiskDelete({
      resourceLabel: '虚拟网络',
      name: `${deletableTargets.length} 个网络`,
      requireTypeConfirm: false,
      description: `确定要删除选中的 ${deletableTargets.length} 个网络吗？此操作不可恢复。`,
      riskItems: DELETE_NETWORK_RISK_ITEMS,
      extra: (
        <>
          {publicTargets.length > 0 && (
            <div style={{ color: '#faad14', marginTop: 8 }}>
              {`注意：${publicTargets.length} 个公共命名空间的网络将被跳过（租户不能删除公共命名空间的资源）。`}
            </div>
          )}
          {blockedByVm.length > 0 && (
            <div style={{ color: '#ff4d4f', marginTop: 8 }}>
              <div>以下网络正在被虚拟机使用，无法删除：</div>
              {blockedByVm.slice(0, 5).map(([net, vms]) => (
                <div key={net} style={{ marginLeft: 16, marginTop: 4 }}>
                  {net}: {vms.slice(0, 3).join('，')}{vms.length > 3 ? ' 等' : ''}
                </div>
              ))}
            </div>
          )}
          {blockedBySubnet.length > 0 && (
            <div style={{ color: '#ff4d4f', marginTop: 8 }}>
              <div>以下网络正在被 Kube-OVN 子网依赖，无法删除：</div>
              {blockedBySubnet.slice(0, 5).map(([net, subnets]) => (
                <div key={net} style={{ marginLeft: 16, marginTop: 4 }}>
                  {net}: {subnets.slice(0, 3).join('，')}{subnets.length > 3 ? ' 等' : ''}
                </div>
              ))}
            </div>
          )}
          {canDelete.length > 0 && (
            <div style={{ color: '#52c41a', marginTop: 8 }}>{`将删除 ${canDelete.length} 个网络。`}</div>
          )}
        </>
      ),
      precheck: async () => {
        if (!hasDeletable) {
          return { ok: false, error: '没有可删除的网络' };
        }
      },
      onConfirm: async () => {
        try {
          const results = await Promise.allSettled(
            canDelete.map((target) =>
              deleteHarvesterNad(cloudId || '', target._namespace, target._name),
            ),
          );
          const ok = results.filter((r) => r.status === 'fulfilled').length;
          const fail = results.filter((r) => r.status === 'rejected').length;
          if (ok > 0) message.success(`成功删除 ${ok} 个网络`);
          if (fail > 0) {
            const errors = results
              .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
              .map((r) => (r.reason as { message?: string })?.message || String(r.reason))
              .filter(Boolean);
            message.error(`删除失败 ${fail} 个网络${errors.length > 0 ? `: ${errors[0]}` : ''}`);
          }
          setSelectedRowKeys([]);
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: unknown) {
          const err = e as { message?: string };
          message.error(err?.message || '批量删除失败');
        }
      },
    }).catch(() => {});
  }, [
    cloudId,
    ensureNadsWrite,
    filteredData,
    isPublicNamespace,
    isTenant,
    loadOvnSubnets,
    onRefresh,
    selectedRowKeys,
  ]);

  const handleCreateSuccess = useCallback(() => {
    setCreateVisible(false);
    void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
  }, [onRefresh]);

  return {
    selectedRowKeys,
    setSelectedRowKeys,
    nadYamlDrawerOpen,
    nadYamlViewLink,
    openNadYamlDrawer,
    closeNadYamlDrawer,
    createVisible,
    setCreateVisible,
    handleDelete,
    handleBatchDelete,
    handleCreateSuccess,
  };
}
