import { useCallback, useState, type Key } from 'react';
import { Modal, message } from 'antd';
import { deleteHarvesterIpPool } from '../../../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/nadSectionRefresh';
import {
  isIpPoolDeleteBlockedError,
  pickIpPoolsByKeys,
  splitIpPoolsForBatchDelete,
  type IPPoolListRow,
} from '../lib/ippoolsSectionUtils';

function renderIpPoolDeleteBlockedModal(title: string, errMsg: string) {
  Modal.error({
    title,
    content: (
      <div>
        <p>无法删除该地址池，因为其中仍有已分配的 IP 地址。</p>
        <p>请先删除使用该地址池的 LoadBalancer 或其他服务，释放所有 IP 后再试。</p>
        <div style={{ marginTop: 8, color: '#999', fontSize: 12, wordBreak: 'break-all' }}>
          原始错误: {errMsg}
        </div>
      </div>
    ),
  });
}

export type UseIPPoolsSectionActionsParams = {
  cloudId: string;
  dataSource: IPPoolListRow[];
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
  onRefresh?: HarvesterSectionOnRefresh;
};

export function useIPPoolsSectionActions({
  cloudId,
  dataSource,
  isTenant,
  isPublicNamespace,
  onRefresh,
}: UseIPPoolsSectionActionsParams) {
  const [createVisible, setCreateVisible] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const handleDelete = useCallback(
    (record: IPPoolListRow) => {
      if (isTenant && isPublicNamespace(record.namespace)) {
        message.warning('租户不能删除公共命名空间的资源');
        return;
      }

      Modal.confirm({
        title: '确认删除',
        content: `确定要删除地址池 ${record.name} 吗？此操作不可恢复。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteHarvesterIpPool(cloudId, record.name);
            message.success('删除成功');
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            const errMsg = (e as { message?: string }).message || '';
            if (isIpPoolDeleteBlockedError(errMsg)) {
              renderIpPoolDeleteBlockedModal('删除失败', errMsg);
            } else {
              message.error(errMsg || '删除失败');
            }
          }
        },
      });
    },
    [cloudId, isPublicNamespace, isTenant, onRefresh],
  );

  const handleBatchDelete = useCallback(() => {
    const targets = pickIpPoolsByKeys(dataSource, selectedRowKeys);
    const { deletableTargets, systemTargets, publicTargets } = splitIpPoolsForBatchDelete(
      targets,
      { isTenant, isPublicNamespace, isSystemNamespace },
    );

    if (deletableTargets.length === 0) {
      const reasons: string[] = [];
      if (systemTargets.length > 0) reasons.push(`${systemTargets.length} 个系统项目`);
      if (publicTargets.length > 0) reasons.push(`${publicTargets.length} 个公共项目`);
      message.warning(`选中的地址池无法删除：${reasons.join('，')}`);
      setSelectedRowKeys([]);
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${deletableTargets.length} 个地址池吗？此操作不可恢复。`,
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(
            deletableTargets.map((item) => deleteHarvesterIpPool(cloudId, item.name)),
          );
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: unknown) {
          const errMsg = (e as { message?: string }).message || '';
          if (isIpPoolDeleteBlockedError(errMsg)) {
            renderIpPoolDeleteBlockedModal('部分删除失败', errMsg);
          } else {
            message.error(errMsg || '部分删除失败');
          }
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }
      },
    });
  }, [cloudId, dataSource, isPublicNamespace, isTenant, onRefresh, selectedRowKeys]);

  const handleCreateSuccess = useCallback(() => {
    void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
  }, [onRefresh]);

  return {
    createVisible,
    setCreateVisible,
    selectedRowKeys,
    setSelectedRowKeys,
    handleDelete,
    handleBatchDelete,
    handleCreateSuccess,
  };
}
