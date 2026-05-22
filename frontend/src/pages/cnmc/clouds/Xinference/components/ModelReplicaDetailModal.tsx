import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Table, Tag, Typography } from 'antd';
import {
  fetchXinferenceModelReplicas,
  type XinferenceReplicaStatus,
} from '../../../../../services/xinferenceApi';
import { formatUnixTs, instanceStatusColor, instanceStatusLabel } from '../lib/launchProgressUtils';

type Props = {
  open: boolean;
  poolId: string;
  modelUid: string;
  modelName?: string;
  onClose: () => void;
};

const ModelReplicaDetailModal: React.FC<Props> = ({
  open,
  poolId,
  modelUid,
  modelName,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [replicas, setReplicas] = useState<XinferenceReplicaStatus[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!poolId || !modelUid) return;
    setLoading(true);
    setErr(null);
    try {
      setReplicas(await fetchXinferenceModelReplicas(poolId, modelUid, { skipCache: true }));
    } catch (e: unknown) {
      setReplicas([]);
      setErr(e instanceof Error ? e.message : '拉取副本详情失败');
    } finally {
      setLoading(false);
    }
  }, [modelUid, poolId]);

  useEffect(() => {
    if (open) void load();
    else {
      setReplicas([]);
      setErr(null);
    }
  }, [open, load]);

  return (
    <Modal
      title={`副本详情 · ${modelName || modelUid}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      {err ? (
        <Typography.Text type="danger">{err}</Typography.Text>
      ) : (
        <Table
          className="std-table"
          size="small"
          rowKey={(r) => `${r.replicaId}-${r.replicaModelUid}`}
          loading={loading}
          dataSource={replicas}
          pagination={false}
          scroll={{ x: true }}
          columns={[
            { title: '副本 ID', dataIndex: 'replicaId', key: 'replicaId' },
            {
              title: '副本 UID',
              dataIndex: 'replicaModelUid',
              key: 'replicaModelUid',
              render: (v: string) => (
                <Typography.Text copyable={{ text: v }} ellipsis={{ tooltip: v }}>
                  {v}
                </Typography.Text>
              ),
            },
            {
              title: 'Worker',
              dataIndex: 'workerAddress',
              key: 'workerAddress',
              render: (v: string | undefined) => v || '—',
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (v: string) => <Tag color={instanceStatusColor(v)}>{instanceStatusLabel(v)}</Tag>,
            },
            {
              title: '创建时间',
              dataIndex: 'createdTs',
              key: 'createdTs',
              render: (v: number | undefined) => formatUnixTs(v),
            },
            {
              title: '错误',
              dataIndex: 'errorMessage',
              key: 'errorMessage',
              render: (v: string | null | undefined) =>
                v ? (
                  <Typography.Text type="danger" ellipsis={{ tooltip: v }}>
                    {v}
                  </Typography.Text>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      )}
    </Modal>
  );
};

export default ModelReplicaDetailModal;
