import { useCallback, useState } from 'react';
import { Modal, message } from 'antd';
import { deleteHarvesterLoadBalancer } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/nadSectionRefresh';
import {
  pickLoadBalancersByKeys,
  splitLoadBalancersForBatchDelete,
  type LoadBalancerListRow,
} from '../lib/loadBalancersSectionUtils';

export type UseLoadBalancersSectionActionsParams = {
  cloudId: string;
  dataSource: LoadBalancerListRow[];
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
  onRefresh?: HarvesterSectionOnRefresh;
};

export function useLoadBalancersSectionActions({
  cloudId,
  dataSource,
  isTenant,
  isPublicNamespace,
  onRefresh,
}: UseLoadBalancersSectionActionsParams) {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const handleDelete = useCallback(
    (record: LoadBalancerListRow) => {
      if (isTenant && isPublicNamespace(record.namespace)) {
        message.warning('租户不能删除公共命名空间的资源');
        return;
      }

      Modal.confirm({
        title: '确认删除',
        content: `确定要删除负载均衡 ${record.name} 吗？此操作不可恢复。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteHarvesterLoadBalancer(cloudId, record.namespace, record.name);
            message.success('删除成功');
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err.message || '删除失败');
          }
        },
      });
    },
    [cloudId, isPublicNamespace, isTenant, onRefresh],
  );

  const handleBatchDelete = useCallback(() => {
    const targets = pickLoadBalancersByKeys(dataSource, selectedRowKeys);
    const { deletableTargets, systemTargets, publicTargets } = splitLoadBalancersForBatchDelete(
      targets,
      { isTenant, isPublicNamespace, isSystemNamespace },
    );

    if (deletableTargets.length === 0) {
      const reasons: string[] = [];
      if (systemTargets.length > 0) reasons.push(`${systemTargets.length} 个系统项目`);
      if (publicTargets.length > 0) reasons.push(`${publicTargets.length} 个公共项目`);
      message.warning(`选中的负载均衡无法删除：${reasons.join('，')}`);
      setSelectedRowKeys([]);
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${deletableTargets.length} 个负载均衡吗？此操作不可恢复。`,
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(
            deletableTargets.map((item) =>
              deleteHarvesterLoadBalancer(cloudId, item.namespace, item.name),
            ),
          );
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: unknown) {
          const err = e as { message?: string };
          message.error(err.message || '部分删除失败');
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }
      },
    });
  }, [cloudId, dataSource, isPublicNamespace, isTenant, onRefresh, selectedRowKeys]);

  const handleCreateSuccess = useCallback(() => {
    void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
  }, [onRefresh]);

  return {
    createModalOpen,
    setCreateModalOpen,
    selectedRowKeys,
    setSelectedRowKeys,
    handleDelete,
    handleBatchDelete,
    handleCreateSuccess,
  };
}
