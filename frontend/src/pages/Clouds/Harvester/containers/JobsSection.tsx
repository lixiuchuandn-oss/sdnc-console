/**
 * ==============================================================================
 * 模块名称: Harvester 容器任务视图 (JobsSection)
 * 文件路径: src/pages/Clouds/Harvester/containers/JobsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Harvester/Kubernetes 任务资源，包括：
 * 1. Job 列表展示与管理
 * 2. CronJob 列表展示与管理
 * 
 * [核心逻辑]
 * 1. 任务类型切换: 通过 Tab 切换 Job 和 CronJob
 * 2. 命名空间筛选: 支持按命名空间过滤
 * 3. 操作功能: 删除
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Tabs, Select, Button, Tag, Space, App, Drawer, Descriptions, Input } from 'antd';
import { ReloadOutlined, DeleteOutlined, SearchOutlined, EyeOutlined, ClockCircleOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import {
  deleteHarvesterJob,
  deleteHarvesterCronJob,
} from '../../../../services/harvesterApi';

type Props = {
  jobs: any[];
  cronjobs: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
};

/**
 * Job 状态渲染
 */
const renderJobStatus = (job: any) => {
  const status = job?.status;
  const conditions = status?.conditions || [];
  
  // 检查是否完成
  const completeCondition = conditions.find((c: any) => c.type === 'Complete');
  const failedCondition = conditions.find((c: any) => c.type === 'Failed');
  
  if (failedCondition && failedCondition.status === 'True') {
    return <Tag color="red">失败</Tag>;
  }
  
  if (completeCondition && completeCondition.status === 'True') {
    return <Tag color="green">成功</Tag>;
  }
  
  // 检查是否正在运行
  const active = status?.active || 0;
  if (active > 0) {
    return <Tag color="blue">运行中</Tag>;
  }
  
  // 检查是否正在终止
  if (job?.metadata?.deletionTimestamp) {
    return <Tag color="orange">终止中</Tag>;
  }
  
  return <Tag color="default">等待中</Tag>;
};

/**
 * CronJob 状态渲染
 */
const renderCronJobStatus = (cronjob: any) => {
  const spec = cronjob?.spec;
  
  // 检查是否暂停
  if (spec?.suspend) {
    return <Tag color="orange">已暂停</Tag>;
  }
  
  return <Tag color="green">活跃</Tag>;
};

/**
 * 格式化时间
 */
const formatTime = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  } catch {
    return timestamp;
  }
};

/**
 * 计算运行时长
 */
const calculateAge = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const created = new Date(timestamp).getTime();
    const now = Date.now();
    const diff = now - created;
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  } catch {
    return '-';
  }
};

/**
 * Job 详情抽屉组件
 */
const JobDetailDrawer: React.FC<{
  job: any;
  visible: boolean;
  onClose: () => void;
}> = ({ job, visible, onClose }) => {
  if (!job) return null;
  
  const metadata = job?.metadata || {};
  const spec = job?.spec || {};
  const status = job?.status || {};
  
  return (
    <Drawer
      title={`Job 详情: ${metadata.name}`}
      placement="right"
      width={700}
      open={visible}
      onClose={onClose}
    >
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="状态">{renderJobStatus(job)}</Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="完成数">{status.succeeded || 0}</Descriptions.Item>
        <Descriptions.Item label="失败数">{status.failed || 0}</Descriptions.Item>
        <Descriptions.Item label="活跃数">{status.active || 0}</Descriptions.Item>
        <Descriptions.Item label="并行数">{spec.parallelism || 1}</Descriptions.Item>
        <Descriptions.Item label="创建时间" span={2}>{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="完成时间" span={2}>{formatTime(status.completionTime)}</Descriptions.Item>
        <Descriptions.Item label="开始时间" span={2}>{formatTime(status.startTime)}</Descriptions.Item>
        <Descriptions.Item label="标签" span={2}>
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>{k}={String(v)}</Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </Drawer>
  );
};

/**
 * CronJob 详情抽屉组件
 */
const CronJobDetailDrawer: React.FC<{
  cronjob: any;
  visible: boolean;
  onClose: () => void;
}> = ({ cronjob, visible, onClose }) => {
  if (!cronjob) return null;
  
  const metadata = cronjob?.metadata || {};
  const spec = cronjob?.spec || {};
  const status = cronjob?.status || {};
  
  return (
    <Drawer
      title={`CronJob 详情: ${metadata.name}`}
      placement="right"
      width={700}
      open={visible}
      onClose={onClose}
    >
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
        <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
        <Descriptions.Item label="状态">{renderCronJobStatus(cronjob)}</Descriptions.Item>
        <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="调度计划" span={2}>
          <Tag icon={<ClockCircleOutlined />}>{spec.schedule}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="并发策略">{spec.concurrencyPolicy || 'Allow'}</Descriptions.Item>
        <Descriptions.Item label="暂停">{spec.suspend ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="成功历史限制">{spec.successfulJobsHistoryLimit || 3}</Descriptions.Item>
        <Descriptions.Item label="失败历史限制">{spec.failedJobsHistoryLimit || 1}</Descriptions.Item>
        <Descriptions.Item label="上次调度时间">{formatTime(status.lastScheduleTime)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
        <Descriptions.Item label="标签" span={2}>
          <Space size={4} wrap>
            {Object.entries(metadata.labels || {}).map(([k, v]) => (
              <Tag key={k}>{k}={String(v)}</Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </Drawer>
  );
};

/**
 * Job 表格组件
 */
const JobTable: React.FC<{
  data: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: () => void;
}> = ({ data, loading, cloudId, onRefresh }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentJob, setCurrentJob] = useState<any>(null);
  
  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
  }, [data, keyword]);
  
  // 查看详情
  const handleViewDetail = useCallback((job: any) => {
    setCurrentJob(job);
    setDetailVisible(true);
  }, []);
  
  // 删除操作
  const handleDelete = useCallback(async (job: any) => {
    const namespace = job?.metadata?.namespace;
    const name = job?.metadata?.name;
    
    try {
      await deleteHarvesterJob(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      width: 220,
      ellipsis: true,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 120,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: any, record: any) => renderJobStatus(record),
    },
    {
      title: '完成数',
      key: 'completions',
      width: 100,
      render: (_: any, record: any) => {
        const succeeded = record?.status?.succeeded || 0;
        const completions = record?.spec?.completions || succeeded;
        return `${succeeded}/${completions}`;
      },
    },
    {
      title: '运行时长',
      key: 'age',
      width: 100,
      render: (_: any, record: any) => calculateAge(record?.metadata?.creationTimestamp),
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'detail',
            label: '详情',
            icon: <EyeOutlined />,
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 Job "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];
        
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [handleViewDetail, handleDelete, modal]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-jobs',
  );
  
  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Input.Search
          placeholder="搜索名称/命名空间"
          allowClear
          style={{ width: 250 }}
          onSearch={setKeyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()}>
            刷新
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-jobs"
          />
        </Space>
      </div>
      
      <Table
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          defaultPageSize: 20,
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
      />
      
      {/* Job 详情抽屉 */}
      <JobDetailDrawer
        job={currentJob}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentJob(null);
        }}
      />
    </div>
  );
};

/**
 * CronJob 表格组件
 */
const CronJobTable: React.FC<{
  data: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: () => void;
}> = ({ data, loading, cloudId, onRefresh }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentCronJob, setCurrentCronJob] = useState<any>(null);
  
  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
      const name = item?.metadata?.name || '';
      const ns = item?.metadata?.namespace || '';
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
  }, [data, keyword]);
  
  // 查看详情
  const handleViewDetail = useCallback((cronjob: any) => {
    setCurrentCronJob(cronjob);
    setDetailVisible(true);
  }, []);
  
  // 删除操作
  const handleDelete = useCallback(async (cronjob: any) => {
    const namespace = cronjob?.metadata?.namespace;
    const name = cronjob?.metadata?.name;
    
    try {
      await deleteHarvesterCronJob(cloudId, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      width: 220,
      ellipsis: true,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 120,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: any, record: any) => renderCronJobStatus(record),
    },
    {
      title: '调度计划',
      dataIndex: ['spec', 'schedule'],
      key: 'schedule',
      width: 150,
      render: (schedule: string) => <Tag icon={<ClockCircleOutlined />}>{schedule}</Tag>,
    },
    {
      title: '最后一次执行',
      dataIndex: ['status', 'lastScheduleTime'],
      key: 'lastScheduleTime',
      width: 180,
      render: formatTime,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      width: 180,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'detail',
            label: '详情',
            icon: <EyeOutlined />,
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 CronJob "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];
        
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [handleViewDetail, handleDelete, modal]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-cronjobs',
  );
  
  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Input.Search
          placeholder="搜索名称/命名空间"
          allowClear
          style={{ width: 250 }}
          onSearch={setKeyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()}>
            刷新
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-cronjobs"
          />
        </Space>
      </div>
      
      <Table
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          defaultPageSize: 20,
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
        }}
      />
      
      {/* CronJob 详情抽屉 */}
      <CronJobDetailDrawer
        cronjob={currentCronJob}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentCronJob(null);
        }}
      />
    </div>
  );
};

/**
 * Jobs Section 主组件
 */
const JobsSection: React.FC<Props> = ({
  jobs,
  cronjobs,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'job' | 'cronjob'>('job');
  
  // Tab 切换
  const handleTabChange = (key: string) => {
    setActiveTab(key as 'job' | 'cronjob');
  };
  
  // 根据 nsValue 过滤数据
  const filteredJobs = useMemo(() => {
    if (!nsValue) return jobs;
    return jobs.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [jobs, nsValue]);
  
  const filteredCronJobs = useMemo(() => {
    if (!nsValue) return cronjobs;
    return cronjobs.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [cronjobs, nsValue]);
  
  return (
    <PageDetailSection
      title="任务"
      toolbarLeft={
        <Select
          placeholder="筛选命名空间"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 200 }}
          value={nsValue}
          onChange={onNsChange}
          options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
        />
      }
      onRefresh={onRefresh}
    >
      <Tabs
        type="line"
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: 'job',
            label: `Job (${filteredJobs.length})`,
            children: (
              <JobTable
                data={filteredJobs}
                loading={loading}
                cloudId={cloudId}
                onRefresh={onRefresh}
              />
            ),
          },
          {
            key: 'cronjob',
            label: `CronJob (${filteredCronJobs.length})`,
            children: (
              <CronJobTable
                data={filteredCronJobs}
                loading={loading}
                cloudId={cloudId}
                onRefresh={onRefresh}
              />
            ),
          },
        ]}
      />
    </PageDetailSection>
  );
};

export default JobsSection;
