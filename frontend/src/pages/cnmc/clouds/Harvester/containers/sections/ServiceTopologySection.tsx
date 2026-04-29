/**
 * 服务拓扑可视化 Section
 * 
 * 功能：
 * 1. 展示 Ingress → Service → Pod 调用链拓扑图
 * 2. 支持命名空间过滤（切换后立即刷新）
 * 3. 支持节点点击查看详情
 * 4. 拓扑数据默认「有拓扑数据」；命名空间默认选当前筛选项下第一个（含父级已选时以父级为准）
 * 5. 支持快速操作：编辑、YAML编辑、查看详情、终端等
 */
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Select, Space, Spin, Empty, Drawer, Descriptions, Tag, Button, Tooltip, App, Table, Tabs } from 'antd';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { ReloadOutlined, EditOutlined, CodeOutlined, EyeOutlined, CodeSandboxOutlined, FileTextOutlined, ArrowLeftOutlined, CloseOutlined } from '@ant-design/icons';
import { ServiceTopology } from '../components/topology';
import { buildServiceTopology, getTopologyStats, TopologyNode } from '../components/serviceTopologyUtils';
import { YamlEditModal, IngressFormModal, ServiceFormModal, PodTerminal } from '../components';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import YamlEditor from '../../../../../../components/YamlEditor';
import {
  fetchHarvesterIngressDetail,
  updateHarvesterIngress,
  fetchHarvesterServiceDetail,
  updateHarvesterService,
  fetchHarvesterPodLog,
  fetchHarvesterPodEvents,
} from '../../../../../../services/harvesterApi';

// ========== 辅助函数 ==========

const formatTime = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  } catch {
    return timestamp;
  }
};

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

const renderPodStatus = (pod: any) => {
  const phase = pod?.status?.phase || 'Unknown';
  const statusMap: Record<string, { color: string; text: string }> = {
    Running: { color: 'green', text: '运行中' },
    Pending: { color: 'blue', text: '等待中' },
    Succeeded: { color: 'cyan', text: '已完成' },
    Failed: { color: 'red', text: '失败' },
    Unknown: { color: 'default', text: '未知' },
    Terminating: { color: 'orange', text: '终止中' },
  };
  if (pod?.metadata?.deletionTimestamp) {
    return <Tag color="orange">终止中</Tag>;
  }
  const status = statusMap[phase] || statusMap.Unknown;
  return <Tag color={status.color}>{status.text}</Tag>;
};

// ========== Pod 日志查看器 ==========

const PodLogViewer: React.FC<{
  cloudId: string;
  namespace: string;
  podName: string;
  containers: string[];
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
}> = ({ cloudId, namespace, podName, containers, visible, onClose, onBack }) => {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [tailLines, setTailLines] = useState<number>(500);
  const logRef = useRef<HTMLPreElement>(null);

  const loadLogs = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const containerParam = containers.length === 1 ? undefined : selectedContainer;
      const result = await fetchHarvesterPodLog(cloudId, namespace, podName, containerParam, tailLines);
      setLogs(result || '暂无日志');
    } catch (e: any) {
      setLogs(`加载日志失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [cloudId, namespace, podName, selectedContainer, tailLines, visible, containers.length]);

  useEffect(() => {
    if (containers.length > 0 && !selectedContainer) {
      setSelectedContainer(containers[0]);
    }
  }, [containers, selectedContainer]);

  useEffect(() => {
    if (!visible) {
      setLogs('');
      setSelectedContainer('');
    }
  }, [visible]);

  useEffect(() => {
    if (visible && containers.length > 0) {
      loadLogs();
    }
  }, [visible, containers.length, loadLogs]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Drawer
      title={
        <Space>
          {onBack && (
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
              返回
            </Button>
          )}
          <span>日志: {podName}</span>
        </Space>
      }
      placement="right"
      width={800}
      open={visible}
      onClose={onClose}
      closeIcon={<CloseOutlined />}
      extra={
        <Space>
          {containers.length > 1 && (
            <Select
              value={selectedContainer}
              onChange={setSelectedContainer}
              style={{ width: 180 }}
              options={containers.map((c) => ({ label: c, value: c }))}
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
          <Tooltip title="刷新">
            <Button type="default" icon={<ReloadOutlined />} onClick={loadLogs} loading={loading} />
          </Tooltip>
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

// ========== Pod 详情抽屉 ==========

const PodDetailDrawer: React.FC<{
  pod: any;
  visible: boolean;
  cloudId: string;
  onClose: () => void;
  onViewLog?: () => void;
  onOpenTerminal?: () => void;
}> = ({ pod, visible, cloudId, onClose, onViewLog, onOpenTerminal }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    if (visible && pod && cloudId) {
      const loadEvents = async () => {
        setEventsLoading(true);
        try {
          const result = await fetchHarvesterPodEvents(cloudId, pod.metadata.namespace, pod.metadata.name);
          setEvents(result?.data?.items || []);
        } catch (e) {
          setEvents([]);
        } finally {
          setEventsLoading(false);
        }
      };
      loadEvents();
    }
  }, [visible, pod, cloudId]);

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
        <Space>
          {onViewLog && (
            <Button icon={<FileTextOutlined />} onClick={onViewLog}>日志</Button>
          )}
          {onOpenTerminal && (
            <Button icon={<CodeSandboxOutlined />} onClick={onOpenTerminal}>终端</Button>
          )}
        </Space>
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
                className="std-table"
                scroll={{ x: true }}
                bordered={false}
                dataSource={containers.map((c: any, idx: number) => ({
                  ...c,
                  key: idx,
                  status: containerStatuses.find((s: any) => s.name === c.name),
                }))}
                columns={[
                  { title: '名称', dataIndex: 'name' },
                  { title: '镜像', dataIndex: 'image', ellipsis: true },
                  {
                    title: '状态',
                    key: 'status',
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
                    render: (_: any, record: any) => record.status?.restartCount || 0,
                  },
                ]}
                pagination={false}
              />
            ),
          },
          {
            key: 'events',
            label: '事件',
            children: (
              <Table
                className="std-table"
                scroll={{ x: true }}
                bordered={false}
                loading={eventsLoading}
                dataSource={events.map((e: any, idx: number) => ({ ...e, key: idx }))}
                columns={[
                  { title: '类型', dataIndex: 'type', render: (v: string) => <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v || '-'}</Tag> },
                  { title: '原因', dataIndex: 'reason' },
                  { title: '消息', dataIndex: 'message', ellipsis: true, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap' }}>{v || '-'}</span> },
                  { title: '次数', dataIndex: 'count', render: (v: number) => v || 1 },
                  { title: '时间', dataIndex: 'lastTimestamp', render: formatTime },
                ]}
                pagination={false}
                locale={{ emptyText: '暂无事件' }}
              />
            ),
          },
          {
            key: 'conditions',
            label: '状态条件',
            children: (
              <Table
                className="std-table"
                scroll={{ x: true }}
                bordered={false}
                dataSource={(status.conditions || []).map((c: any, idx: number) => ({ ...c, key: idx }))}
                columns={[
                  { title: '类型', dataIndex: 'type' },
                  { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'True' ? 'green' : 'red'}>{v}</Tag> },
                  { title: '原因', dataIndex: 'reason' },
                  { title: '消息', dataIndex: 'message', ellipsis: true },
                  { title: '时间', dataIndex: 'lastTransitionTime', render: formatTime },
                ]}
                pagination={false}
              />
            ),
          },
          {
            key: 'yaml',
            label: 'YAML',
            children: (
              <YamlEditor
                value={JSON.stringify(pod, null, 2)}
                readOnly
                minHeight={300}
                maxHeight={500}
              />
            ),
          },
        ]}
      />
    </Drawer>
  );
};

// ========== Pod 详情 Tabs 组件（不含 Drawer）==========

const PodDetailTabs: React.FC<{
  pod: any;
  cloudId: string;
}> = ({ pod, cloudId }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  useEffect(() => {
    if (pod && cloudId) {
      const loadEvents = async () => {
        setEventsLoading(true);
        try {
          const result = await fetchHarvesterPodEvents(cloudId, pod.metadata.namespace, pod.metadata.name);
          setEvents(result?.data?.items || []);
        } catch (e) {
          setEvents([]);
        } finally {
          setEventsLoading(false);
        }
      };
      loadEvents();
    }
  }, [pod, cloudId]);

  if (!pod) return null;

  const metadata = pod?.metadata || {};
  const spec = pod?.spec || {};
  const status = pod?.status || {};
  const containers = spec?.containers || [];
  const containerStatuses = status?.containerStatuses || [];

  return (
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
              className="std-table"
              scroll={{ x: true }}
              bordered={false}
              dataSource={containers.map((c: any, idx: number) => ({
                ...c,
                key: idx,
                status: containerStatuses.find((s: any) => s.name === c.name),
              }))}
              columns={[
                { title: '名称', dataIndex: 'name' },
                { title: '镜像', dataIndex: 'image', ellipsis: true },
                {
                  title: '状态',
                  key: 'status',
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
                  render: (_: any, record: any) => record.status?.restartCount || 0,
                },
              ]}
              pagination={false}
            />
          ),
        },
        {
          key: 'events',
          label: '事件',
          children: (
            <Table
              className="std-table"
              scroll={{ x: true }}
              bordered={false}
              loading={eventsLoading}
              dataSource={events.map((e: any, idx: number) => ({ ...e, key: idx }))}
              columns={[
                { title: '类型', dataIndex: 'type', render: (v: string) => <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v || '-'}</Tag> },
                { title: '原因', dataIndex: 'reason' },
                { title: '消息', dataIndex: 'message', ellipsis: true, render: (v: string) => <span style={{ whiteSpace: 'pre-wrap' }}>{v || '-'}</span> },
                { title: '次数', dataIndex: 'count', render: (v: number) => v || 1 },
                { title: '时间', dataIndex: 'lastTimestamp', render: formatTime },
              ]}
              pagination={false}
              locale={{ emptyText: '暂无事件' }}
            />
          ),
        },
        {
          key: 'conditions',
          label: '状态条件',
          children: (
            <Table
              className="std-table"
              scroll={{ x: true }}
              bordered={false}
              dataSource={(status.conditions || []).map((c: any, idx: number) => ({ ...c, key: idx }))}
              columns={[
                { title: '类型', dataIndex: 'type' },
                { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'True' ? 'green' : 'red'}>{v}</Tag> },
                { title: '原因', dataIndex: 'reason' },
                { title: '消息', dataIndex: 'message', ellipsis: true },
                { title: '时间', dataIndex: 'lastTransitionTime', render: formatTime },
              ]}
              pagination={false}
            />
          ),
        },
        {
          key: 'yaml',
          label: 'YAML',
          children: (
            <YamlEditor
              value={JSON.stringify(pod, null, 2)}
              readOnly
              minHeight={300}
              maxHeight={500}
            />
          ),
        },
      ]}
    />
  );
};

// ========== 主组件 ==========

interface ServiceTopologySectionProps {
  cloudId: string;
  ingresses: any[];
  services: any[];
  pods: any[];
  namespacesOptions: string[];
  loading?: boolean;
  onRefresh?: () => void;
  nsValue?: string;
  onNsChange?: (value: string) => void;
}

const ServiceTopologySection: React.FC<ServiceTopologySectionProps> = ({
  cloudId,
  ingresses = [],
  services = [],
  pods = [],
  namespacesOptions = [],
  loading = false,
  onRefresh,
  nsValue,
  onNsChange,
}) => {
  const { message } = App.useApp();
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentNs, setCurrentNs] = useState<string>('');

  // YAML 编辑弹窗状态
  const [yamlModalOpen, setYamlModalOpen] = useState(false);
  const [yamlEditingNode, setYamlEditingNode] = useState<TopologyNode | null>(null);

  // 表单编辑弹窗状态
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<TopologyNode | null>(null);

  // Pod 日志/终端状态
  const [podLogVisible, setPodLogVisible] = useState(false);
  const [podLogContainers, setPodLogContainers] = useState<string[]>([]);
  const [podTerminalVisible, setPodTerminalVisible] = useState(false);
  const [podTerminalContainers, setPodTerminalContainers] = useState<string[]>([]);

  // Service 运维信息
  const [serviceDrawerOpen, setServiceDrawerOpen] = useState(false);

  /** 命名空间列表二次筛选：是否已生成拓扑节点 */
  const [topologyDataFilter, setTopologyDataFilter] = useState<'all' | 'with' | 'without'>('with');

  /** 用户是否在命名空间下拉中主动清空（避免清空后又自动选回第一项） */
  const userClearedNamespaceRef = useRef(false);

  /** 表单默认命名空间 */
  const formDefaultNs = nsValue || namespacesOptions[0] || 'default';

  // 与父级受控命名空间同步
  useEffect(() => {
    setCurrentNs(nsValue ?? '');
  }, [nsValue]);

  useEffect(() => {
    userClearedNamespaceRef.current = false;
  }, [topologyDataFilter]);

  const getFilteredData = useCallback((targetNs: string) => {
    if (!targetNs) return { ingresses: [], services: [], pods: [] };
    const filterByNamespace = (items: any[]) => items.filter((item: any) => (item?.metadata?.namespace || item?.namespace) === targetNs);
    return {
      ingresses: filterByNamespace(ingresses),
      services: filterByNamespace(services),
      pods: filterByNamespace(pods),
    };
  }, [ingresses, services, pods]);

  /** 各命名空间在当前数据下是否具备非空拓扑（有节点即视为有拓扑数据） */
  const namespaceHasTopologyMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const ns of namespacesOptions) {
      const fd = getFilteredData(ns);
      const t = buildServiceTopology(fd.ingresses, fd.services, fd.pods);
      m.set(ns, t.nodes.length > 0);
    }
    return m;
  }, [namespacesOptions, getFilteredData]);

  /** 按「是否有拓扑数据」筛过后的命名空间，用于下拉选项 */
  const namespacesForSelect = useMemo(() => {
    if (topologyDataFilter === 'all') return namespacesOptions;
    return namespacesOptions.filter((ns) => {
      const has = namespaceHasTopologyMap.get(ns) ?? false;
      return topologyDataFilter === 'with' ? has : !has;
    });
  }, [namespacesOptions, topologyDataFilter, namespaceHasTopologyMap]);

  // 筛选条件变化后，当前选中命名空间若不在可选列表中则清空（非用户主动清空）
  useEffect(() => {
    if (!currentNs) return;
    if (!namespacesForSelect.includes(currentNs)) {
      setCurrentNs('');
      onNsChange?.('');
    }
  }, [namespacesForSelect, currentNs, onNsChange]);

  // 父级未指定有效命名空间时，默认选中「当前可选列表」中第一个（与拓扑数据筛选一致，通常为第一个有拓扑的命名空间）
  useEffect(() => {
    if (namespacesForSelect.length === 0) return;
    if (nsValue && namespacesForSelect.includes(nsValue)) return;
    if (currentNs && namespacesForSelect.includes(currentNs)) return;
    if (userClearedNamespaceRef.current) return;
    const first = namespacesForSelect[0];
    setCurrentNs(first);
    onNsChange?.(first);
  }, [namespacesForSelect, nsValue, topologyDataFilter, currentNs, onNsChange]);

  const topology = useMemo(() => {
    const filteredData = getFilteredData(currentNs);
    return buildServiceTopology(filteredData.ingresses, filteredData.services, filteredData.pods);
  }, [currentNs, getFilteredData]);

  const stats = useMemo(() => getTopologyStats(topology), [topology]);

  const handleNodeClick = useCallback((node: TopologyNode) => {
    setSelectedNode(node);
    setDrawerVisible(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerVisible(false);
    setSelectedNode(null);
  }, []);

  const handleNsChange = useCallback((value: string | null | undefined) => {
    const v = value ?? '';
    userClearedNamespaceRef.current = !v;
    setCurrentNs(v);
    onNsChange?.(v);
  }, [onNsChange]);

  const handleRefresh = useCallback(() => onRefresh?.(), [onRefresh]);

  // ========== 快速操作 ==========

  const handleYamlEdit = useCallback((node: TopologyNode) => {
    setYamlEditingNode(node);
    setYamlModalOpen(true);
  }, []);

  const handleEdit = useCallback((node: TopologyNode) => {
    setEditingNode(node);
    setEditModalOpen(true);
  }, []);

  const handleViewServiceDetail = useCallback(() => {
    setDrawerVisible(false);
    setServiceDrawerOpen(true);
  }, []);

  const handleViewPodLog = useCallback((node: TopologyNode) => {
    const raw = node.rawData;
    if (!raw) return;
    const containerStatuses = raw?.status?.containerStatuses || [];
    const specContainers = raw?.spec?.containers || [];
    const containers = containerStatuses.length > 0
      ? containerStatuses.map((c: any) => c.name)
      : specContainers.map((c: any) => c.name);
    setSelectedNode(node);
    setPodLogContainers(containers);
    setDrawerVisible(false);
    setPodLogVisible(true);
  }, []);

  const handleOpenPodTerminal = useCallback((node: TopologyNode) => {
    const raw = node.rawData;
    if (!raw) return;
    const containerStatuses = raw?.status?.containerStatuses || [];
    const specContainers = raw?.spec?.containers || [];
    const containers = containerStatuses.length > 0
      ? containerStatuses.map((c: any) => c.name)
      : specContainers.map((c: any) => c.name);
    setSelectedNode(node);
    setPodTerminalContainers(containers);
    setDrawerVisible(false);
    setPodTerminalVisible(true);
  }, []);

  // ========== YAML 加载和保存 ==========

  const loadYaml = useCallback(async (): Promise<string> => {
    if (!yamlEditingNode) return '';
    const { type, namespace, name } = yamlEditingNode;
    if (type === 'ingress') {
      const response = await fetchHarvesterIngressDetail(cloudId, namespace, name);
      const data = response?.data || response;
      return JSON.stringify({ ...data, metadata: { ...data?.metadata, managedFields: undefined } }, null, 2);
    } else if (type === 'service') {
      const response = await fetchHarvesterServiceDetail(cloudId, namespace, name);
      const data = response?.data || response;
      return JSON.stringify({ ...data, metadata: { ...data?.metadata, managedFields: undefined } }, null, 2);
    }
    return '';
  }, [cloudId, yamlEditingNode]);

  const saveYaml = useCallback(async (yaml: string) => {
    if (!yamlEditingNode) return;
    const { type, namespace, name } = yamlEditingNode;
    const data = JSON.parse(yaml);
    if (type === 'ingress') {
      await updateHarvesterIngress(cloudId, namespace, name, data);
    } else if (type === 'service') {
      await updateHarvesterService(cloudId, namespace, name, data);
    }
    message.success('保存成功');
    onRefresh?.();
  }, [cloudId, yamlEditingNode, message, onRefresh]);

  // ========== 渲染 ==========

  const getNodeStatusColor = (status?: string) => {
    switch (status) {
      case 'Running': return 'success';
      case 'Pending': return 'warning';
      case 'Failed':
      case 'Error': return 'error';
      case 'Succeeded': return 'processing';
      default: return 'default';
    }
  };

  const renderNodeDetails = () => {
    if (!selectedNode) return null;
    const { type, name, namespace, status, ip, port, host, labels, rawData, extra } = selectedNode;

    // Pod 直接显示完整详情
    if (type === 'pod' && rawData) {
      return (
        <Drawer
          title={`Pod 详情: ${name}`}
          placement="right"
          width={700}
          onClose={handleCloseDrawer}
          open={drawerVisible}
          extra={
            <Space>
              <Button size="small" icon={<FileTextOutlined />} onClick={() => handleViewPodLog(selectedNode)}>日志</Button>
              <Button size="small" icon={<CodeSandboxOutlined />} onClick={() => handleOpenPodTerminal(selectedNode)}>终端</Button>
            </Space>
          }
        >
          <PodDetailTabs pod={rawData} cloudId={cloudId} />
        </Drawer>
      );
    }

    // Ingress 和 Service 显示简单信息
    return (
      <Drawer
        title={`${type === 'ingress' ? 'Ingress' : 'Service'} 详情`}
        placement="right"
        width={500}
        onClose={handleCloseDrawer}
        open={drawerVisible}
        extra={
          <Space>
            {type === 'ingress' && (
              <>
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(selectedNode)}>编辑</Button>
                <Button size="small" icon={<CodeOutlined />} onClick={() => handleYamlEdit(selectedNode)}>YAML</Button>
              </>
            )}
            {type === 'service' && (
              <>
                <Button size="small" icon={<EyeOutlined />} onClick={handleViewServiceDetail}>运维信息</Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(selectedNode)}>编辑</Button>
                <Button size="small" icon={<CodeOutlined />} onClick={() => handleYamlEdit(selectedNode)}>YAML</Button>
              </>
            )}
          </Space>
        }
      >
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="名称">{name}</Descriptions.Item>
          <Descriptions.Item label="命名空间">{namespace}</Descriptions.Item>
          <Descriptions.Item label="类型">
            <Tag color={type === 'ingress' ? 'blue' : 'green'}>{type.toUpperCase()}</Tag>
          </Descriptions.Item>
          {type === 'ingress' && (
            <>
              <Descriptions.Item label="域名">{host || '*'}</Descriptions.Item>
              {extra?.paths && extra.paths.length > 0 && (
                <Descriptions.Item label="路径">
                  {extra.paths.map((p: string, i: number) => <Tag key={i}>{p}</Tag>)}
                </Descriptions.Item>
              )}
            </>
          )}
          {type === 'service' && (
            <>
              {port && <Descriptions.Item label="端口">{port}</Descriptions.Item>}
              {extra?.serviceType && <Descriptions.Item label="Service 类型">{extra.serviceType}</Descriptions.Item>}
              {extra?.clusterIP && <Descriptions.Item label="ClusterIP">{extra.clusterIP}</Descriptions.Item>}
              {extra?.selector && (
                <Descriptions.Item label="Selector">
                  {Object.entries(extra.selector).map(([k, v]) => <Tag key={k}>{k}={v as string}</Tag>)}
                </Descriptions.Item>
              )}
            </>
          )}
          {labels && Object.keys(labels).length > 0 && (
            <Descriptions.Item label="标签">
              {Object.entries(labels).map(([k, v]) => <Tag key={k} style={{ marginBottom: 4 }}>{k}={v}</Tag>)}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Drawer>
    );
  };

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            flex: '1 1 auto',
            minWidth: 0,
            width: '100%',
          }}
        >
          <div className="toolbar-container">
            <Select
              style={{ width: 168 }}
              placeholder="拓扑数据"
              value={topologyDataFilter}
              onChange={(v) => setTopologyDataFilter((v as 'all' | 'with' | 'without') || 'all')}
              options={[
                { label: '全部', value: 'all' },
                { label: '有拓扑数据', value: 'with' },
                { label: '无拓扑数据', value: 'without' },
              ]}
            />
            <Select
              className="toolbar-filter"
              placeholder="选择命名空间"
              allowClear
              value={currentNs ? currentNs : undefined}
              onChange={handleNsChange}
              options={namespacesForSelect.map((ns) => ({ label: ns, value: ns }))}
              showSearch
              optionFilterProp="label"
            />
          </div>
          <Space size={4} wrap align="center" style={{ marginLeft: 'auto' }}>
            <Tag color="blue">Ingress: {stats.ingressCount}</Tag>
            <Tag color="green">Service: {stats.serviceCount}</Tag>
            <Tag color="purple">Pod: {stats.podCount}</Tag>
            <Tag color="default">连接: {stats.connectionCount}</Tag>
          </Space>
        </div>
      }
      onRefresh={handleRefresh}
      refreshLoading={loading}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
          <Spin size="large" tip="加载中..." />
        </div>
      ) : topology.nodes.length === 0 ? (
        <Empty description={currentNs ? `命名空间 "${currentNs}" 下没有服务拓扑数据` : '请选择命名空间查看服务拓扑'} style={{ padding: '60px 0' }} />
      ) : (
        <ServiceTopology key={currentNs} nodes={topology.nodes} edges={topology.edges} onNodeClick={handleNodeClick} height={500} />
      )}

      {renderNodeDetails()}

      {/* YAML 编辑弹窗 */}
      {yamlEditingNode && (yamlEditingNode.type === 'ingress' || yamlEditingNode.type === 'service') && (
        <YamlEditModal
          visible={yamlModalOpen}
          title={`${yamlEditingNode.type === 'ingress' ? 'Ingress' : 'Service'} YAML 编辑`}
          cloudId={cloudId}
          namespace={yamlEditingNode.namespace}
          name={yamlEditingNode.name}
          resourceType={yamlEditingNode.type}
          onLoadYaml={loadYaml}
          onSaveYaml={saveYaml}
          onCancel={() => setYamlModalOpen(false)}
          onSuccess={() => { setYamlModalOpen(false); onRefresh?.(); }}
        />
      )}

      {/* Ingress 编辑弹窗 */}
      {editingNode && editingNode.type === 'ingress' && (
        <IngressFormModal
          visible={editModalOpen}
          cloudId={cloudId}
          editMode
          initialData={editingNode.rawData}
          namespacesOptions={namespacesOptions}
          secrets={[]}
          defaultNamespace={formDefaultNs}
          onCancel={() => setEditModalOpen(false)}
          onSuccess={() => { setEditModalOpen(false); onRefresh?.(); }}
        />
      )}

      {/* Service 编辑弹窗 */}
      {editingNode && editingNode.type === 'service' && (
        <ServiceFormModal
          visible={editModalOpen}
          cloudId={cloudId}
          editMode
          initialData={editingNode.rawData}
          namespacesOptions={namespacesOptions}
          defaultNamespace={formDefaultNs}
          onCancel={() => setEditModalOpen(false)}
          onSuccess={() => { setEditModalOpen(false); onRefresh?.(); }}
        />
      )}

      {/* Service 运维信息抽屉 */}
      {selectedNode && selectedNode.type === 'service' && selectedNode.rawData && (
        <HarvesterResourceDrawer
          open={serviceDrawerOpen}
          onClose={() => setServiceDrawerOpen(false)}
          resourceType="Service"
          record={{
            ...selectedNode.rawData,
            kind: 'Service',
            id: `${selectedNode.namespace}/${selectedNode.name}`,
            metadata: selectedNode.rawData?.metadata,
          }}
          cloudId={cloudId}
          pods={pods}
          hideRelatedPods
          onBack={() => { setServiceDrawerOpen(false); setDrawerVisible(true); }}
        />
      )}

      {/* Pod 日志查看器 */}
      {selectedNode && selectedNode.type === 'pod' && selectedNode.rawData && (
        <PodLogViewer
          cloudId={cloudId}
          namespace={selectedNode.namespace}
          podName={selectedNode.name}
          containers={podLogContainers}
          visible={podLogVisible}
          onClose={() => setPodLogVisible(false)}
          onBack={() => { setPodLogVisible(false); setDrawerVisible(true); }}
        />
      )}

      {/* Pod 终端 */}
      {selectedNode && selectedNode.type === 'pod' && selectedNode.rawData && (
        <PodTerminal
          visible={podTerminalVisible}
          cloudId={cloudId}
          namespace={selectedNode.namespace}
          podName={selectedNode.name}
          containers={podTerminalContainers}
          onClose={() => { setPodTerminalVisible(false); setDrawerVisible(true); }}
        />
      )}
    </PageDetailSection>
  );
};

export default ServiceTopologySection;