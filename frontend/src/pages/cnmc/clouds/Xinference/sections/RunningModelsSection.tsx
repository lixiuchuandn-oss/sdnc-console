/**
 * Xinference 资源池 · 运行模型（运行中实例列表）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Popconfirm, Table, Typography, message } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import {
  fetchXinferenceRunningModels,
  terminateXinferenceModel,
  type XinferenceRunningModel,
} from '../../../../../services/xinferenceApi';

type Props = {
  poolId: string;
};

const RunningModelsSection: React.FC<Props> = ({ poolId }) => {
  const [models, setModels] = useState<XinferenceRunningModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!poolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      setModels(await fetchXinferenceRunningModels(poolId, { skipCache: true }));
    } catch (e: unknown) {
      setModels([]);
      setErr(e instanceof Error ? e.message : '加载运行中模型失败');
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTerminate = useCallback(
    async (modelUid: string) => {
      try {
        await terminateXinferenceModel(poolId, modelUid);
        message.success('已停止模型');
        await load();
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : '停止模型失败');
      }
    },
    [load, poolId],
  );

  const columns = useMemo(
    () => [
      {
        title: '模型 UID',
        dataIndex: 'modelUid',
        key: 'modelUid',
        fixed: 'left' as const,
        render: (v: string) => (
          <Typography.Text ellipsis={{ tooltip: v }} style={{ maxWidth: 220 }}>
            {v}
          </Typography.Text>
        ),
      },
      { title: '模型名称', dataIndex: 'modelName', key: 'modelName' },
      {
        title: '类型',
        dataIndex: 'modelType',
        key: 'modelType',
        render: (v: string | undefined) => v || '—',
      },
      {
        title: '引擎',
        dataIndex: 'modelEngine',
        key: 'modelEngine',
        render: (v: string | undefined) => v || '—',
      },
      {
        title: '格式',
        dataIndex: 'modelFormat',
        key: 'modelFormat',
        render: (v: string | undefined) => v || '—',
      },
      {
        title: '规模',
        dataIndex: 'sizeInBillions',
        key: 'sizeInBillions',
        render: (v: string | undefined) => v || '—',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        render: (_: unknown, row: XinferenceRunningModel) => (
          <Popconfirm
            title={`停止模型「${row.modelUid}」？`}
            onConfirm={() => void handleTerminate(row.modelUid)}
          >
            <Button type="link" danger size="small">
              停止
            </Button>
          </Popconfirm>
        ),
      },
    ],
    [handleTerminate],
  );

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  return (
    <>
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
      <PageDetailSection
        title="运行模型"
        icon={<PlayCircleOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
        asCard={false}
        toolbarRight={
          <Typography.Text type="secondary">共 {models.length} 个运行中实例</Typography.Text>
        }
        onRefresh={() => void load()}
      >
        <Table
          className="std-table"
          rowKey="modelUid"
          columns={columns}
          dataSource={models}
          loading={loading}
          scroll={{ x: true }}
          pagination={{ showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: '暂无运行中的模型，请前往「模型广场」启动' }}
        />
      </PageDetailSection>
    </>
  );
};

export default RunningModelsSection;
