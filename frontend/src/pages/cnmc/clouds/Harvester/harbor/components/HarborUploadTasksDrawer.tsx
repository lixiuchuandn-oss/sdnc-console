/**
 * Harbor 上传任务历史抽屉组件
 */
import React, { useState, useEffect } from 'react';
import {
  Drawer,
  Table,
  Button,
  Select,
  Space,
  Tag,
  Progress,
  message,
  Popconfirm,
  Empty,
} from 'antd';
import {
  ReloadOutlined,
  DeleteOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { getHarborUploadTasks, HarborUploadTask } from '../shared/harborApi';

interface Props {
  visible: boolean;
  harborId: string;
  projectName: string;
  onClose: () => void;
}

const HarborUploadTasksDrawer: React.FC<Props> = ({
  visible,
  harborId,
  projectName,
  onClose,
}) => {
  const [tasks, setTasks] = useState<HarborUploadTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const result = await getHarborUploadTasks(harborId, projectName, {
        status: statusFilter,
        limit: 100,
      });
      setTasks(result);
    } catch (error: any) {
      message.error(error.message || '获取任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      loadTasks();
    }
  }, [visible, harborId, projectName, statusFilter]);

  const renderStatus = (status: string) => {
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
            上传中
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

  const renderProgress = (record: HarborUploadTask) => {
    if (record.status === 'completed') {
      return <Progress percent={100} size="small" status="success" />;
    }
    if (record.status === 'failed') {
      return <Progress percent={record.uploadedLayers / record.totalLayers * 100 || 0} size="small" status="exception" />;
    }
    if (record.status === 'uploading' || record.status === 'parsing') {
      const percent = record.totalLayers > 0
        ? Math.round((record.uploadedLayers / record.totalLayers) * 100)
        : 0;
      return <Progress percent={percent} size="small" status="active" />;
    }
    return '-';
  };

  const columns = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      ellipsis: true,
    },
    {
      title: '目标仓库',
      key: 'target',
      render: (_: any, record: HarborUploadTask) =>
        `${record.targetRepo || 'library'}:${record.targetTag || 'latest'}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: renderStatus,
    },
    {
      title: '进度',
      key: 'progress',
      width: 150,
      render: renderProgress,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '错误信息',
      dataIndex: 'error',
      key: 'error',
      ellipsis: true,
      render: (error: string) => error || '-',
    },
  ];

  return (
    <Drawer
      title="上传任务历史"
      placement="right"
      width={900}
      onClose={onClose}
      open={visible}
    >
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
        <Button icon={<ReloadOutlined />} onClick={loadTasks} loading={loading}>
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

export default HarborUploadTasksDrawer;
