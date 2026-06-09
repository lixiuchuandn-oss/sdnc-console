/**
 * 本地仓库镜像上传任务抽屉
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Drawer,
  Table,
  Button,
  Select,
  Space,
  Tag,
  Progress,
  message,
  Empty,
  Alert,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import {
  deleteImageUploadTask,
  fetchImageUploadTasks,
  ImageUploadTask,
} from '../../../../../../services/localRegistryApi';

interface Props {
  visible: boolean;
  cloudId: string;
  registryId: string;
  onClose: () => void;
  onTasksChanged?: () => void;
}

const ACTIVE_STATUSES = new Set(['pending', 'parsing', 'uploading']);

const LocalRegistryUploadTasksDrawer: React.FC<Props> = ({
  visible,
  cloudId,
  registryId,
  onClose,
  onTasksChanged,
}) => {
  const [tasks, setTasks] = useState<ImageUploadTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [allTasks, setAllTasks] = useState<ImageUploadTask[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  const handleDelete = async (task: ImageUploadTask) => {
    setDeletingId(task.id);
    try {
      await deleteImageUploadTask(cloudId, registryId, task.id);
      message.success('任务记录已删除');
      prevStatusRef.current.delete(task.id);
      await loadTasks(true);
    } catch (error: any) {
      message.error(error?.message || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchImageUploadTasks(cloudId, registryId);
      const list: ImageUploadTask[] = Array.isArray(res?.data) ? res.data : [];
      setAllTasks(list);
      setTasks(statusFilter ? list.filter((t) => t.status === statusFilter) : list);

      let taskFinished = false;
      for (const task of list) {
        const prev = prevStatusRef.current.get(task.id);
        if (
          prev &&
          ACTIVE_STATUSES.has(prev) &&
          (task.status === 'completed' || task.status === 'failed')
        ) {
          taskFinished = true;
          break;
        }
      }
      if (taskFinished) {
        onTasksChanged?.();
      }
      prevStatusRef.current = new Map(list.map((t) => [t.id, t.status]));
    } catch (error: any) {
      if (!silent) {
        message.error(error?.message || '获取上传任务失败');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cloudId, registryId, statusFilter, onTasksChanged]);

  useEffect(() => {
    if (!visible) return;
    prevStatusRef.current = new Map();
    void loadTasks();
  }, [visible, loadTasks]);

  useEffect(() => {
    if (!visible) return;
    setTasks(statusFilter ? allTasks.filter((t) => t.status === statusFilter) : allTasks);
  }, [visible, statusFilter, allTasks]);

  useEffect(() => {
    if (!visible) return;
    const hasActive = allTasks.some((t) => ACTIVE_STATUSES.has(t.status));
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      void loadTasks(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [visible, allTasks, loadTasks]);

  const calcProgressPercent = (record: ImageUploadTask): number => {
    if (record.totalLayers <= 0) return 0;
    const raw = Math.round((record.uploadedLayers / record.totalLayers) * 100);
    if (record.status === 'uploading' || record.status === 'parsing') {
      return Math.min(raw, 99);
    }
    return Math.min(raw, 100);
  };

  const renderStatus = (status: string, record?: ImageUploadTask) => {
    switch (status) {
      case 'pending':
        return (
          <Tag icon={<ClockCircleOutlined />} color="default">
            待处理
          </Tag>
        );
      case 'parsing':
        return (
          <Tag icon={<LoadingOutlined spin />} color="processing">
            解析中
          </Tag>
        );
      case 'uploading':
        return (
          <Tag icon={<LoadingOutlined spin />} color="processing">
            {record?.currentLayer === 'manifest' ? '推送清单' : '上传中'}
          </Tag>
        );
      case 'completed':
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            已完成
          </Tag>
        );
      case 'failed':
        return (
          <Tag icon={<CloseCircleOutlined />} color="error">
            失败
          </Tag>
        );
      default:
        return <Tag>{status}</Tag>;
    }
  };

  const renderProgress = (record: ImageUploadTask) => {
    if (record.status === 'completed') {
      return <Progress percent={100} size="small" status="success" />;
    }
    if (record.status === 'failed') {
      return (
        <Progress
          percent={calcProgressPercent(record)}
          size="small"
          status="exception"
        />
      );
    }
    if (record.status === 'uploading' || record.status === 'parsing') {
      return (
        <Progress
          percent={calcProgressPercent(record)}
          size="small"
          status="active"
        />
      );
    }
    return '-';
  };

  const failedCount = allTasks.filter((t) => t.status === 'failed').length;
  const activeCount = allTasks.filter((t) => ACTIVE_STATUSES.has(t.status)).length;

  const columns = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      ellipsis: true,
    },
    {
      title: '目标镜像',
      key: 'target',
      render: (_: unknown, record: ImageUploadTask) =>
        `${record.targetRepo || 'library'}:${record.targetTag || 'latest'}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string, record: ImageUploadTask) => renderStatus(status, record),
    },
    {
      title: '进度',
      key: 'progress',
      width: 140,
      render: (_: unknown, record: ImageUploadTask) => renderProgress(record),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '错误信息',
      dataIndex: 'error',
      key: 'error',
      ellipsis: true,
      render: (error: string) => (
        error ? <span style={{ color: '#ff4d4f' }}>{error}</span> : '-'
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: ImageUploadTask) => {
        const canDelete = record.status === 'completed' || record.status === 'failed';
        if (!canDelete) return '-';
        return (
          <Popconfirm
            title="删除任务记录"
            description="仅删除任务记录，不会删除已推送的镜像"
            onConfirm={() => handleDelete(record)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: deletingId === record.id }}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === record.id}
            >
              删除
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <Drawer
      title="上传任务"
      placement="right"
      width={900}
      onClose={onClose}
      open={visible}
    >
      {failedCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${failedCount} 个任务推送失败`}
          description="失败任务可能在仓库目录中留下无标签的仓库名；请重新上传或改用 docker push。可在「镜像」页刷新后查看成功推送的标签。"
        />
      )}
      {activeCount > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${activeCount} 个任务正在处理中，将自动刷新进度`}
        />
      )}

      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="过滤状态"
          allowClear
          style={{ width: 150 }}
          value={statusFilter}
          onChange={setStatusFilter}
        >
          <Select.Option value="pending">待处理</Select.Option>
          <Select.Option value="parsing">解析中</Select.Option>
          <Select.Option value="uploading">上传中</Select.Option>
          <Select.Option value="completed">已完成</Select.Option>
          <Select.Option value="failed">失败</Select.Option>
        </Select>
        <Button icon={<ReloadOutlined />} onClick={() => loadTasks()} loading={loading}>
          刷新
        </Button>
      </Space>

      {tasks.length === 0 && !loading ? (
        <Empty description="暂无上传任务" />
      ) : (
        <Table
          columns={columns}
          dataSource={tasks}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      )}
    </Drawer>
  );
};

export default LocalRegistryUploadTasksDrawer;
