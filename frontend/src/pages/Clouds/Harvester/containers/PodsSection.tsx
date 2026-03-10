/**
 * ==============================================================================
 * 模块名称: Harvester 容器 Pod 视图 (PodsSection)
 * 文件路径: src/pages/Clouds/Harvester/containers/PodsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Harvester/Kubernetes Pod，包括：
 * 1. Pod 列表展示
 * 2. Pod 详情查看
 * 3. Pod 日志查看
 * 4. Pod 删除
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Table, Select, Button, Tag, Space, Modal, Input, App, Badge, Drawer, Descriptions, Tabs, Dropdown, Popconfirm } from 'antd';
import { ReloadOutlined, DeleteOutlined, SearchOutlined, EyeOutlined, FileTextOutlined, CodeOutlined, MoreOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import {
  fetchHarvesterPodDetail,
  fetchHarvesterPodLog,
  deleteHarvesterContainerResource,
} from '../../../../services/harvesterApi';

type Props = {
  pods: any[];
  loading: boolean;
  namespacesOptions: string[];
  nodesOptions: string[];
  cloudId: string;
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
};

/**
 * Pod 状态渲染
 */
const renderPodStatus = (pod: any) => {
  const phase = pod?.status?.phase || 'Unknown';
  const conditions = pod?.status?.conditions || [];
  
  const statusMap: Record<string, { color: string; text: string }> = {
    Running: { color: 'green', text: '运行中' },
    Pending: { color: 'blue', text: '等待中' },
    Succeeded: { color: 'cyan', text: '已完成' },
    Failed: { color: 'red', text: '失败' },
    Unknown: { color: 'default', text: '未知' },
    Terminating: { color: 'orange', text: '终止中' },
  };
  
  // 检查是否正在终止
  const metadata = pod?.metadata || {};
  if (metadata.deletionTimestamp) {
    return <Tag color="orange">终止中</Tag>;
  }
  
  // 检查容器状态
  const containerStatuses = pod?.status?.containerStatuses || [];
  const waiting = containerStatuses.find((c: any) => c?.state?.waiting);
  if (waiting && phase === 'Pending') {
    return <Tag color="orange">{waiting.state.waiting.reason || '等待中'}</Tag>;
  }
  
  const status = statusMap[phase] || statusMap.Unknown;
  return <Tag color={status.color}>{status.text}</Tag>;
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
 * Pod 日志查看器组件
 */
const PodLogViewer: React.FC<{
  cloudId: string;
  namespace: string;
  podName: string;
  containers: string[];
  visible: boolean;
  onClose: () => void;
}> = ({ cloudId, namespace, podName, containers, visible, onClose }) => {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [tailLines, setTailLines] = useState<number>(500);
  const logRef = useRef<HTMLPreElement>(null);
  
  // 上一次的容器列表，用于检测变化
  const prevContainersRef = useRef<string[]>(containers);
  
  // 加载日志
  const loadLogs = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      // 单容器 Pod 可以不传容器参数，多容器 Pod 必须指定
      const containerParam = containers.length === 1 ? undefined : selectedContainer;
      const result = await fetchHarvesterPodLog(
        cloudId,
        namespace,
        podName,
        containerParam,
        tailLines,
      );
      setLogs(result || '暂无日志');
    } catch (e: any) {
      setLogs(`加载日志失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [cloudId, namespace, podName, selectedContainer, tailLines, visible, containers.length]);
  
  // 当容器列表变化时（切换到不同的 Pod），重置为第一个容器
  useEffect(() => {
    const containersChanged = 
      prevContainersRef.current.length !== containers.length ||
      prevContainersRef.current.some((c, i) => c !== containers[i]);
    
    if (containersChanged && containers.length > 0) {
      // 重置为第一个容器
      setSelectedContainer(containers[0]);
      prevContainersRef.current = containers;
    }
  }, [containers]);
  
  // 重置状态
  useEffect(() => {
    if (!visible) {
      setLogs('');
    }
  }, [visible]);
  
  // 加载日志
  useEffect(() => {
    if (visible) {
      // 单容器 Pod 直接加载，多容器 Pod 需要选择容器后再加载
      if (containers.length === 1 || selectedContainer) {
        loadLogs();
      }
    }
  }, [visible, selectedContainer, tailLines, loadLogs, containers.length]);
  
  // 自动滚动到底部
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);
  
  // 构建容器选项
  const containerOptions = containers.map((c) => ({ label: c, value: c }));
  
  return (
    <Drawer
      title={`日志: ${podName}`}
      placement="right"
      width={800}
      open={visible}
      onClose={onClose}
      extra={
        <Space>
          {containers.length > 1 && (
            <Select
              value={selectedContainer}
              onChange={(v) => {
                setSelectedContainer(v);
              }}
              style={{ width: 180 }}
              options={containerOptions}
            />
          )}
          {containers.length === 1 && (
            <span style={{ color: '#666' }}>容器: {containers[0]}</span>
          )}
          <Select
            value={tailLines}
            onChange={setTailLines}
            style={{ width: 100 }}
            options={[
              { label: '100行', value: 100 },
              { label: '500行', value: 500 },
              { label: '1000行', value: 1000 },
              { label: '2000行', value: 2000 },
            ]}
          />
          <Button onClick={loadLogs} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      <pre
        ref={logRef}
        style={{
          background: '#1e1e1e',
          color: '#d4d4d4',
          padding: 16,
          borderRadius: 8,
          height: 'calc(100vh - 200px)',
          overflow: 'auto',
          fontSize: 12,
          fontFamily: 'Consolas, Monaco, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {loading ? '加载中...' : logs}
      </pre>
    </Drawer>
  );
};

/**
 * Pod 详情抽屉组件
 */
const PodDetailDrawer: React.FC<{
  pod: any;
  visible: boolean;
  onClose: () => void;
  onViewLog?: () => void;
}> = ({ pod, visible, onClose, onViewLog }) => {
  if (!pod) return null;
  
  const metadata = pod?.metadata || {};
  const spec = pod?.spec || {};
  const status = pod?.status || {};
  const containers = spec?.containers || [];
  const containerStatuses = status?.containerStatuses || [];
  
  return (
    <Drawer
      title={`Pod 详情: ${metadata.name}`}
      placement="right"
      width={700}
      open={visible}
      onClose={onClose}
      extra={
        onViewLog && (
          <Button icon={<FileTextOutlined />} onClick={onViewLog}>
            查看日志
          </Button>
        )
      }
    >
      <Tabs
        items={[
          {
            key: 'overview',
            label: '概览',
            children: (
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="名称">{metadata.name}</Descriptions.Item>
                <Descriptions.Item label="命名空间">{metadata.namespace}</Descriptions.Item>
                <Descriptions.Item label="状态">{renderPodStatus(pod)}</Descriptions.Item>
                <Descriptions.Item label="节点">{spec.nodeName || '-'}</Descriptions.Item>
                <Descriptions.Item label="IP">{status.podIP || '-'}</Descriptions.Item>
                <Descriptions.Item label="运行时长">{calculateAge(metadata.creationTimestamp)}</Descriptions.Item>
                <Descriptions.Item label="创建时间" span={2}>{formatTime(metadata.creationTimestamp)}</Descriptions.Item>
                <Descriptions.Item label="标签" span={2}>
                  <Space size={4} wrap>
                    {Object.entries(metadata.labels || {}).map(([k, v]) => (
                      <Tag key={k}>{k}={String(v)}</Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
              </Descriptions>
            ),
          },
          {
            key: 'containers',
            label: '容器',
            children: (
              <Table
                dataSource={containers.map((c: any, idx: number) => ({
                  ...c,
                  key: idx,
                  status: containerStatuses.find((s: any) => s.name === c.name),
                }))}
                columns={[
                  { title: '名称', dataIndex: 'name', width: 150 },
                  { title: '镜像', dataIndex: 'image', ellipsis: true },
                  {
                    title: '状态',
                    key: 'status',
                    width: 100,
                    render: (_: any, record: any) => {
                      const s = record.status;
                      if (!s) return '-';
                      if (s.state?.running) return <Tag color="green">运行中</Tag>;
                      if (s.state?.waiting) return <Tag color="orange">{s.state.waiting.reason}</Tag>;
                      if (s.state?.terminated) return <Tag color="red">已终止</Tag>;
                      return '-';
                    },
                  },
                  {
                    title: '重启次数',
                    key: 'restartCount',
                    width: 100,
                    render: (_: any, record: any) => record.status?.restartCount || 0,
                  },
                ]}
                pagination={false}
                size="small"
              />
            ),
          },
          {
            key: 'events',
            label: '事件',
            children: (
              <Table
                dataSource={(status.conditions || []).map((c: any, idx: number) => ({
                  ...c,
                  key: idx,
                }))}
                columns={[
                  { title: '类型', dataIndex: 'type', width: 150 },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 80,
                    render: (v: string) => (
                      <Tag color={v === 'True' ? 'green' : 'red'}>{v}</Tag>
                    ),
                  },
                  { title: '原因', dataIndex: 'reason', width: 150 },
                  { title: '消息', dataIndex: 'message', ellipsis: true },
                  { title: '时间', dataIndex: 'lastTransitionTime', width: 180, render: formatTime },
                ]}
                pagination={false}
                size="small"
              />
            ),
          },
          {
            key: 'yaml',
            label: 'YAML',
            children: (
              <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, overflow: 'auto', maxHeight: 500 }}>
                {JSON.stringify(pod, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </Drawer>
  );
};

/**
 * Pods Section 主组件
 */
const PodsSection: React.FC<Props> = ({
  pods,
  loading,
  namespacesOptions,
  nodesOptions,
  cloudId,
  nsValue,
  nodeValue,
  onNsChange,
  onNodeChange,
  onRefresh,
}) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  
  // 详情和日志状态
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentPod, setCurrentPod] = useState<any>(null);
  const [logVisible, setLogVisible] = useState(false);
  const [logContainers, setLogContainers] = useState<string[]>([]);
  
  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return pods.filter((pod: any) => {
      const name = pod?.metadata?.name || '';
      const ns = pod?.metadata?.namespace || '';
      const phase = pod?.status?.phase || '';
      const node = pod?.spec?.nodeName || '';
      
      if (kw && !name.toLowerCase().includes(kw) && !ns.toLowerCase().includes(kw)) {
        return false;
      }
      if (nsValue && ns !== nsValue) {
        return false;
      }
      if (nodeValue && node !== nodeValue) {
        return false;
      }
      if (statusFilter && phase !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [pods, keyword, nsValue, nodeValue, statusFilter]);
  
  // 查看详情
  const handleViewDetail = useCallback((pod: any) => {
    setCurrentPod(pod);
    setDetailVisible(true);
  }, []);
  
  // 查看日志
  const handleViewLog = useCallback((pod: any) => {
    // 优先从 status.containerStatuses 获取实际运行的容器
    // 如果没有，则从 spec.containers 获取
    const containerStatuses = pod?.status?.containerStatuses || [];
    const specContainers = pod?.spec?.containers || [];
    
    let containers: string[];
    if (containerStatuses.length > 0) {
      containers = containerStatuses.map((c: any) => c.name);
    } else {
      containers = specContainers.map((c: any) => c.name);
    }
    
    setCurrentPod(pod);
    setLogContainers(containers);
    setLogVisible(true);
  }, []);
  
  // 删除 Pod
  const handleDelete = useCallback(async (pod: any) => {
    const namespace = pod?.metadata?.namespace;
    const name = pod?.metadata?.name;
    
    try {
      await deleteHarvesterContainerResource(cloudId, '/api/v1/pods', namespace, name);
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
      render: (_: any, record: any) => renderPodStatus(record),
    },
    {
      title: '节点',
      dataIndex: ['spec', 'nodeName'],
      key: 'nodeName',
      width: 120,
      ellipsis: true,
    },
    {
      title: 'IP',
      dataIndex: ['status', 'podIP'],
      key: 'podIP',
      width: 120,
    },
    {
      title: '运行时长',
      key: 'age',
      width: 100,
      render: (_: any, record: any) => calculateAge(record?.metadata?.creationTimestamp),
    },
    {
      title: '镜像',
      key: 'image',
      width: 200,
      ellipsis: true,
      render: (_: any, record: any) => {
        const containers = record?.spec?.containers || [];
        return containers.length > 0 ? containers[0]?.image : '-';
      },
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
            key: 'log',
            label: '日志',
            icon: <FileTextOutlined />,
            onClick: () => handleViewLog(record),
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 Pod "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ];
        
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [handleViewDetail, handleViewLog, handleDelete, modal]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-pods',
  );
  
  return (
    <PageDetailSection
      title="Pod"
      toolbarLeft={
        <Space>
          <Select
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 150 }}
            value={nsValue}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
          <Select
            placeholder="筛选节点"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 150 }}
            value={nodeValue}
            onChange={onNodeChange}
            options={nodesOptions.map((node) => ({ label: node, value: node }))}
          />
          <Select
            placeholder="筛选状态"
            allowClear
            style={{ width: 120 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: '运行中', value: 'Running' },
              { label: '等待中', value: 'Pending' },
              { label: '已完成', value: 'Succeeded' },
              { label: '失败', value: 'Failed' },
            ]}
          />
        </Space>
      }
      onRefresh={onRefresh}
    >
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Input.Search
          placeholder="搜索名称/命名空间"
          allowClear
          style={{ width: 250 }}
          onSearch={setKeyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <TableColumnSettingsButton
          allColumns={columns}
          settingsKey="harvester-containers-pods"
        />
      </div>
      
      <Table
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 1200 }}
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
      
      {/* Pod 详情抽屉 */}
      <PodDetailDrawer
        pod={currentPod}
        visible={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setCurrentPod(null);
        }}
        onViewLog={() => {
          setDetailVisible(false);
          if (currentPod) {
            handleViewLog(currentPod);
          }
        }}
      />
      
      {/* Pod 日志查看器 */}
      {currentPod && (
        <PodLogViewer
          cloudId={cloudId}
          namespace={currentPod?.metadata?.namespace}
          podName={currentPod?.metadata?.name}
          containers={logContainers}
          visible={logVisible}
          onClose={() => {
            setLogVisible(false);
          }}
        />
      )}
    </PageDetailSection>
  );
};

export default PodsSection;
