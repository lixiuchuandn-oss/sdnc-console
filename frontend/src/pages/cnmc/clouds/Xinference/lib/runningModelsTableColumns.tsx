import type { ColumnsType } from 'antd/es/table';
import { Button, Popconfirm, Progress, Space, Tag, Typography } from 'antd';
import type { XinferenceGalleryModelType } from './xinferenceModelRegistry';
import type { XinferencePoolModelRow } from './mergeRunningModels';
import { runningTableShowsLlmSizeColumns } from './mergeRunningModels';
import {
  formatElapsedSince,
  instanceStatusColor,
  instanceStatusLabel,
  isLikelyStuckCreating,
  launchProgressHint,
  resolveInstanceErrorMessage,
} from './launchProgressUtils';

export type RunningTableColumnCtx = {
  modelType: XinferenceGalleryModelType;
  progressMap: Record<string, number>;
  cancelAttemptedUids: Set<string>;
  cancellingUid: string | null;
  onTerminate: (modelUid: string) => void;
  /** 下载/加载中：取消启动任务 */
  onCancelLaunch: (modelUid: string) => void;
  /** ERROR / 卡住的 CREATING：清理 status_guard 元数据 */
  onRemoveMetadata: (modelUid: string) => void;
  onReplicaDetail: (row: XinferencePoolModelRow) => void;
};

function copyableText(v: string, maxWidth = 200) {
  return (
    <Typography.Text copyable={{ text: v }} ellipsis={{ tooltip: v }} style={{ maxWidth }}>
      {v}
    </Typography.Text>
  );
}

function formatAccelerators(acc?: string[]): string {
  if (!acc?.length) return '—';
  return acc.join(', ');
}

export function buildRunningModelsTableColumns(
  ctx: RunningTableColumnCtx,
): ColumnsType<XinferencePoolModelRow> {
  const showLlmCols = runningTableShowsLlmSizeColumns(ctx.modelType);

  const cols: ColumnsType<XinferencePoolModelRow> = [
    {
      title: 'ID',
      dataIndex: 'modelUid',
      key: 'modelUid',
      fixed: 'left',
      render: (v: string) => copyableText(v),
    },
    {
      title: '名称',
      dataIndex: 'modelName',
      key: 'modelName',
      render: (v: string) => copyableText(v, 160),
    },
    {
      title: '状态',
      dataIndex: 'lifecycleStatus',
      key: 'lifecycleStatus',
      render: (v: string) => <Tag color={instanceStatusColor(v)}>{instanceStatusLabel(v)}</Tag>,
    },
    {
      title: '进度',
      key: 'progress',
      render: (_: unknown, row: XinferencePoolModelRow) => {
        const st = row.lifecycleStatus.toUpperCase();
        if (st === 'ERROR') {
          const msg =
            row.errorMessage ||
            resolveInstanceErrorMessage({
              status: row.lifecycleStatus,
              errorMessage: row.errorMessage,
              replicaStatuses: row.replicaStatuses ?? [],
            });
          return msg ? (
            <Typography.Text type="danger" ellipsis={{ tooltip: msg }} style={{ maxWidth: 160 }}>
              {msg}
            </Typography.Text>
          ) : (
            <Typography.Text type="danger">失败</Typography.Text>
          );
        }
        if (st !== 'CREATING') return '—';
        const ratio = ctx.progressMap[row.modelUid] ?? row.progress ?? 0;
        const pct = Math.round((ratio ?? 0) * 100);
        return (
          <Space direction="vertical" size={4} style={{ width: '100%', maxWidth: 200 }}>
            <Progress percent={pct} size="small" status={pct >= 100 ? 'success' : 'active'} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {launchProgressHint(ratio ?? 0)}
              {row.instanceCreatedTs ? ` · ${formatElapsedSince(row.instanceCreatedTs)}` : ''}
            </Typography.Text>
            {isLikelyStuckCreating({
              status: row.lifecycleStatus,
              instanceCreatedTs: row.instanceCreatedTs,
            }) ? (
              <Tag color="warning" style={{ margin: 0 }}>
                可能已卡住
              </Tag>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      render: (v: string | undefined) => v || '—',
    },
    {
      title: 'GPU 索引',
      dataIndex: 'accelerators',
      key: 'accelerators',
      render: (v: string[] | undefined) => formatAccelerators(v),
    },
  ];

  if (showLlmCols) {
    cols.push(
      {
        title: '大小',
        dataIndex: 'sizeInBillions',
        key: 'sizeInBillions',
        render: (v: string | undefined) => v || '—',
      },
      {
        title: '量化',
        dataIndex: 'quantization',
        key: 'quantization',
        render: (v: string | undefined) => v || '—',
      },
    );
  }

  cols.push(
    {
      title: '副本',
      dataIndex: 'replica',
      key: 'replica',
      render: (v: number | undefined, row: XinferencePoolModelRow) => {
        const n = v ?? 1;
        if (row.lifecycleStatus.toUpperCase() !== 'READY') {
          return String(n);
        }
        return (
          <Space size={4}>
            <span>{n}</span>
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => ctx.onReplicaDetail(row)}>
              查看详情
            </Button>
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, row: XinferencePoolModelRow) => {
        const st = row.lifecycleStatus.toUpperCase();
        if (st === 'READY') {
          return (
            <Popconfirm
              title={`终止模型「${row.modelUid}」？`}
              onConfirm={() => ctx.onTerminate(row.modelUid)}
            >
              <Button type="link" danger size="small">
                终止
              </Button>
            </Popconfirm>
          );
        }
        if (st === 'ERROR') {
          const attempted = ctx.cancelAttemptedUids.has(row.modelUid);
          return (
            <Popconfirm
              title={`清理「${row.modelName}」的僵尸实例记录？`}
              description="仅删除 instances 元数据，不代替终止正在运行的模型。"
              disabled={attempted}
              onConfirm={() => ctx.onRemoveMetadata(row.modelUid)}
            >
              <Button
                type="link"
                danger
                size="small"
                disabled={attempted}
                loading={ctx.cancellingUid === row.modelUid}
              >
                {attempted ? '已请求清理' : '清理记录'}
              </Button>
            </Popconfirm>
          );
        }
        if (st === 'CREATING') {
          const stuck = isLikelyStuckCreating({
            status: row.lifecycleStatus,
            instanceCreatedTs: row.instanceCreatedTs,
          });
          const attempted = ctx.cancelAttemptedUids.has(row.modelUid);
          if (stuck) {
            return (
              <Popconfirm
                title={`清理卡住的实例「${row.modelName}」？`}
                description="长时间无进度时，用 instances DELETE 清除元数据；若仍在下载请先尝试取消。"
                disabled={attempted}
                onConfirm={() => ctx.onRemoveMetadata(row.modelUid)}
              >
                <Button
                  type="link"
                  danger
                  size="small"
                  disabled={attempted}
                  loading={ctx.cancellingUid === row.modelUid}
                >
                  {attempted ? '已请求清理' : '清理记录'}
                </Button>
              </Popconfirm>
            );
          }
          return (
            <Popconfirm
              title={`取消「${row.modelName}」的下载/启动？`}
              disabled={attempted}
              onConfirm={() => ctx.onCancelLaunch(row.modelUid)}
            >
              <Button
                type="link"
                danger
                size="small"
                disabled={attempted}
                loading={ctx.cancellingUid === row.modelUid}
              >
                {attempted ? '已请求取消' : '取消'}
              </Button>
            </Popconfirm>
          );
        }
        return null;
      },
    },
  );

  return cols;
}
