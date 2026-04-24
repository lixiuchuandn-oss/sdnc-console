/**
 * ==============================================================================
 * 模块名称: Harvester 容器 Pod 视图 (PodsSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/PodsSection.tsx
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
import { Table, Select, Button, Tag, Space, Modal, Input, App, Badge, Drawer, Descriptions, Tabs, Dropdown, Popconfirm, Tooltip } from 'antd';
import { FileTextOutlined, MoreOutlined, ConsoleSqlOutlined, ExportOutlined, InfoCircleOutlined, ArrowLeftOutlined, EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import YamlEditor from '../../../../../../components/YamlEditor';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import {
  fetchHarvesterPodDetail,
  fetchHarvesterPodLog,
  fetchHarvesterPodEvents,
  deleteHarvesterContainerResource,
  evictHarvesterPod,
  batchEvictHarvesterPods,
} from '../../../../../../services/harvesterApi';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../utils/harvesterUtils';
import PodTerminal from '../components/PodTerminal';

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
  deployments?: any[];
  statefulSets?: any[];
  daemonSets?: any[];
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

const POD_CONDITION_TOOLTIPS: Record<string, string> = {
  PodScheduled: 'Pod 已被调度到某个节点',
  Initialized: 'Init 容器全部执行成功',
  ContainersReady: '所有容器都已启动并通过就绪检查',
  Ready: 'Pod 可以接收服务流量',
  PodReadyToStartContainers: '网络和存储已就绪，容器可以启动（K8s 1.29+）',
  DisruptionTarget: 'Pod 正在被驱逐、删除或因节点异常进入中断处理流程',
  PodResizePending: 'Pod 资源规格变更已提交，等待运行时完成调整',
  PodResizeInProgress: 'Pod 资源规格正在调整中',
  'kubevirt.io/virtual-machine-unpaused': 'KubeVirt 虚拟机已取消暂停，相关 Pod 已恢复运行',
  'kubevirt.io/virtual-machine-paused': 'KubeVirt 虚拟机已暂停，相关 Pod 进入暂停状态',
  'kubevirt.io/migration-target-ready': 'KubeVirt 迁移目标端已就绪，可接收虚拟机迁移',
  'kubevirt.io/storage-live-migration-ready': 'KubeVirt 存储热迁移所需条件已满足',
};

const getPodConditionTooltip = (type?: string) => {
  if (!type) return undefined;
  return POD_CONDITION_TOOLTIPS[type];
};

const renderPodConditionType = (type?: string) => {
  const text = type || '-';
  const tooltip = getPodConditionTooltip(type);

  if (!tooltip) {
    return text;
  }

  return (
    <Space size={4} style={{ maxWidth: '100%' }}>
      <Tooltip
        title={tooltip}
        placement="topLeft"
        overlayInnerStyle={{ maxWidth: 360, whiteSpace: 'normal' }}
        zIndex={9999}
      >
        <span style={{ cursor: 'help', wordBreak: 'break-word' }}>{text}</span>
      </Tooltip>
      <Tooltip
        title={tooltip}
        placement="topLeft"
        overlayInnerStyle={{ maxWidth: 360, whiteSpace: 'normal' }}
        zIndex={9999}
      >
        <InfoCircleOutlined style={{ color: '#999', cursor: 'help', flex: 'none' }} />
      </Tooltip>
    </Space>
  );
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
  onBack?: () => void;
}> = ({ cloudId, namespace, podName, containers, visible, onClose, onBack }) => {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [tailLines, setTailLines] = useState<number>(500);
  const logRef = useRef<HTMLPreElement>(null);
  
  // 上一次的容器列表，用于检测变化
  const prevContainersRef = useRef<string[]>([]); // 初始化为空数组
  
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
  
  // 当容器列表变化时，设置选中项
  useEffect(() => {
    if (containers.length > 0 && !selectedContainer) {
      setSelectedContainer(containers[0]);
      prevContainersRef.current = containers;
    }
  }, [containers, selectedContainer]);
  
  // 重置状态
  useEffect(() => {
    if (!visible) {
      setLogs('');
      setSelectedContainer(''); // 关闭时重置选中状态
    }
  }, [visible]);
  
  // 加载日志 - 当容器列表准备好后自动加载
  useEffect(() => {
    if (visible && containers.length > 0) {
      loadLogs();
    }
  }, [visible, containers.length, loadLogs]);
  
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
  cloudId: string;
  onClose: () => void;
  onViewLog?: () => void;
}> = ({ pod, visible, cloudId, onClose, onViewLog }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  
  // 加载 Pod 相关的 Events
  useEffect(() => {
    if (visible && pod && cloudId) {
      const loadEvents = async () => {
        setEventsLoading(true);
        try {
          const result = await fetchHarvesterPodEvents(
            cloudId,
            pod.metadata.namespace,
            pod.metadata.name
          );
          setEvents(result?.data?.items || []);
        } catch (e: any) {
          console.error('加载 Events 失败:', e);
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
              />
            ),
          },
          {
            key: 'events',
            label: '事件',
            children: (
              <div>
                <div style={{ marginBottom: 8, color: '#666', fontSize: 12 }}>
                  Kubernetes 事件日志，包含镜像拉取、调度、健康检查等详细信息
                </div>
                <Table
                  loading={eventsLoading}
                  dataSource={events.map((e: any, idx: number) => ({
                    ...e,
                    key: idx,
                  }))}
                  columns={[
                    { 
                      title: '类型', 
                      dataIndex: 'type', 
                      width: 80,
                      render: (v: string) => (
                        <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v || '-'}</Tag>
                      ),
                    },
                    { 
                      title: '原因', 
                      dataIndex: 'reason', 
                      width: 130,
                    },
                    { 
                      title: '消息', 
                      dataIndex: 'message', 
                      ellipsis: true,
                      render: (v: string) => (
                        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '-'}</span>
                      ),
                    },
                    { 
                      title: '次数', 
                      dataIndex: 'count', 
                      width: 60,
                      render: (v: number) => v || 1,
                    },
                    { 
                      title: '时间', 
                      dataIndex: 'lastTimestamp', 
                      width: 160, 
                      render: formatTime,
                    },
                  ]}
                  pagination={false}
                  locale={{ emptyText: '暂无事件' }}
                />
              </div>
            ),
          },
          {
            key: 'conditions',
            label: '状态条件',
            children: (
              <Table
                dataSource={(status.conditions || []).map((c: any, idx: number) => ({
                  ...c,
                  key: idx,
                }))}
                columns={[
                  {
                    title: '类型',
                    dataIndex: 'type',
                    width: 240,
                    render: (value: string) => renderPodConditionType(value),
                  },
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
  deployments = [],
  statefulSets = [],
  daemonSets = [],
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
  
  // 终端状态
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalPod, setTerminalPod] = useState<any>(null);
  const [terminalContainers, setTerminalContainers] = useState<string[]>([]);
  
  // 解析 Pod 所属工作负载并获取显示名称
  const getOwnerWorkload = useCallback((pod: any): { name: string; alias: string; type: string } | null => {
    const ownerRefs = pod?.metadata?.ownerReferences || [];
    const podNs = pod?.metadata?.namespace;
    
    for (const ref of ownerRefs) {
      if (ref.kind === 'ReplicaSet') {
        const rsName = ref.name;
        const allWorkloads = [...deployments, ...statefulSets, ...daemonSets];
        for (const wl of allWorkloads) {
          const wlName = wl?.metadata?.name || '';
          const wlNs = wl?.metadata?.namespace || '';
          if (wlNs === podNs && rsName.startsWith(wlName)) {
            const alias = wl?.metadata?.annotations?.['tower.io/alias'] || wlName;
            const type = wl?.kind?.toLowerCase() || 'deployment';
            return { name: wlName, alias, type };
          }
        }
      }
      if (ref.kind === 'StatefulSet' || ref.kind === 'DaemonSet') {
        const wlName = ref.name;
        const workloads = ref.kind === 'StatefulSet' ? statefulSets : daemonSets;
        const wl = workloads.find((w: any) => 
          (w?.metadata?.name || '') === wlName && 
          (w?.metadata?.namespace || '') === podNs
        );
        if (wl) {
          const alias = wl?.metadata?.annotations?.['tower.io/alias'] || wlName;
          const type = ref.kind.toLowerCase();
          return { name: wlName, alias, type };
        }
      }
    }
    return null;
  }, [deployments, statefulSets, daemonSets]);
  
  // 过滤数据
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return pods.filter((pod: any) => {
      const name = pod?.metadata?.name || '';
      const ns = pod?.metadata?.namespace || '';
      const phase = pod?.status?.phase || '';
      const node = pod?.spec?.nodeName || '';
      
      if (kw) {
        const owner = getOwnerWorkload(pod);
        const ownerAlias = owner?.alias?.toLowerCase() || '';
        const ownerName = owner?.name?.toLowerCase() || '';
        if (
          !name.toLowerCase().includes(kw) &&
          !ns.toLowerCase().includes(kw) &&
          !ownerAlias.includes(kw) &&
          !ownerName.includes(kw)
        ) {
          return false;
        }
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
  }, [pods, keyword, nsValue, nodeValue, statusFilter, getOwnerWorkload]);
  
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
  
  // 安全驱逐 Pod (Eviction - 触发 PDB 保护)
  const handleEvict = useCallback(async (pod: any) => {
    const namespace = pod?.metadata?.namespace;
    const name = pod?.metadata?.name;
    
    modal.confirm({
      title: '安全驱逐 Pod',
      content: (
        <div>
          <p>确定要安全驱逐 Pod <strong>{name}</strong> 吗？</p>
          <p style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
            驱逐操作会触发 PodDisruptionBudget (PDB) 保护机制。
            如果 PDB 规则不允许此次驱逐，操作将被阻止。
          </p>
        </div>
      ),
      okText: '确定驱逐',
      cancelText: '取消',
      onOk: async () => {
        try {
          await evictHarvesterPod(cloudId, namespace, name);
          message.success('驱逐成功');
          onRefresh();
        } catch (e: any) {
          // 检查是否是 PDB 阻止
          if (e?.status === 429 || e?.message?.includes('PDB') || e?.message?.includes('disruption')) {
            modal.error({
              title: '驱逐被 PDB 阻止',
              content: (
                <div>
                  <p>Pod <strong>{name}</strong> 的驱逐操作被 PodDisruptionBudget 阻止。</p>
                  <p style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
                    这表明 PDB 规则正在保护此 Pod，以确保服务可用性。
                    请检查相关的 PDB 配置或等待其他 Pod 恢复后再试。
                  </p>
                </div>
              ),
            });
          } else {
            message.error(e?.message || '驱逐失败');
          }
        }
      },
    });
  }, [cloudId, message, modal, onRefresh]);
  
  // 批量删除 Pod
  const handleBatchDelete = useCallback(() => {
    const selectedPods = pods.filter((pod: any) => 
      selectedKeys.includes(`${pod?.metadata?.namespace}/${pod?.metadata?.name}`)
    );
    
    modal.confirm({
      title: '批量删除确认',
      content: `确定要删除选中的 ${selectedPods.length} 个 Pod 吗？删除后 Deployment 可能会自动重建这些 Pod。`,
      okText: '确定',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        let successCount = 0;
        let failCount = 0;
        
        for (const pod of selectedPods) {
          try {
            await deleteHarvesterContainerResource(
              cloudId, 
              '/api/v1/pods', 
              pod?.metadata?.namespace, 
              pod?.metadata?.name
            );
            successCount++;
          } catch {
            failCount++;
          }
        }
        
        setSelectedKeys([]);
        
        if (failCount === 0) {
          message.success(`成功删除 ${successCount} 个 Pod`);
        } else {
          message.warning(`成功删除 ${successCount} 个，失败 ${failCount} 个`);
        }
        onRefresh();
      },
    });
  }, [cloudId, message, modal, onRefresh, pods, selectedKeys]);
  
  // 批量安全驱逐 Pod (用于测试 PDB 规则)
  const handleBatchEvict = useCallback(() => {
    const selectedPods = pods.filter((pod: any) => 
      selectedKeys.includes(`${pod?.metadata?.namespace}/${pod?.metadata?.name}`)
    );
    
    modal.confirm({
      title: '批量安全驱逐',
      content: (
        <div>
          <p>确定要安全驱逐选中的 <strong>{selectedPods.length}</strong> 个 Pod 吗？</p>
          <p style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
            此操作会同时向 Kubernetes 发送驱逐请求，触发 PDB (PodDisruptionBudget) 保护机制。
            如果 PDB 规则不允许同时驱逐这么多 Pod，部分驱逐将被阻止。
          </p>
        </div>
      ),
      okText: '确定驱逐',
      cancelText: '取消',
      onOk: async () => {
        try {
          const podList = selectedPods.map((pod: any) => ({
            namespace: pod?.metadata?.namespace,
            name: pod?.metadata?.name,
          }));
          
          const result = await batchEvictHarvesterPods(cloudId, podList);
          
          setSelectedKeys([]);
          
          // 显示详细结果
          const { successCount = 0, blockedCount = 0, failedCount = 0, results = [] } = result?.data || {};
          
          if (blockedCount > 0) {
            modal.info({
              title: '批量驱逐结果',
              width: 600,
              content: (
                <div>
                  <p>成功驱逐：<strong style={{ color: '#52c41a' }}>{successCount}</strong> 个</p>
                  <p>被 PDB 阻止：<strong style={{ color: '#faad14' }}>{blockedCount}</strong> 个</p>
                  {failedCount > 0 && <p>失败：<strong style={{ color: '#ff4d4f' }}>{failedCount}</strong> 个</p>}
                  {blockedCount > 0 && (
                    <p style={{ color: '#666', fontSize: 12, marginTop: 12 }}>
                      PDB 保护机制已生效，阻止了部分驱逐操作以确保服务可用性。
                    </p>
                  )}
                </div>
              ),
            });
          } else if (failedCount > 0) {
            message.warning(`成功 ${successCount} 个，失败 ${failedCount} 个`);
          } else {
            message.success(`成功驱逐 ${successCount} 个 Pod`);
          }
          
          onRefresh();
        } catch (e: any) {
          message.error(e?.message || '批量驱逐失败');
        }
      },
    });
  }, [cloudId, message, modal, onRefresh, pods, selectedKeys]);
  
  // 打开终端
  const handleOpenTerminal = useCallback((pod: any) => {
    const containerStatuses = pod?.status?.containerStatuses || [];
    const specContainers = pod?.spec?.containers || [];
    
    let containers: string[];
    if (containerStatuses.length > 0) {
      containers = containerStatuses.map((c: any) => c.name);
    } else {
      containers = specContainers.map((c: any) => c.name);
    }
    
    setTerminalPod(pod);
    setTerminalContainers(containers);
    setTerminalVisible(true);
  }, []);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (name: string, record: any) => (
        <a onClick={() => handleViewDetail(record)} style={{ color: '#1890ff' }}>{name}</a>
      ),
    },
    {
      title: '所属工作负载',
      key: 'ownerWorkload',
      width: 150,
      ellipsis: true,
      render: (_: any, record: any) => {
        const owner = getOwnerWorkload(record);
        if (!owner) return <span style={{ color: '#999' }}>-</span>;
        const typeLabel = owner.type === 'deployment' ? 'Deployment' 
          : owner.type === 'statefulset' ? 'StatefulSet' 
          : 'DaemonSet';
        return (
          <Tooltip title={`${typeLabel}: ${owner.name}`}>
            <span>{owner.alias}</span>
          </Tooltip>
        );
      },
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
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'log',
            label: '日志',
            onClick: () => handleViewLog(record),
          },
          {
            key: 'terminal',
            label: '终端',
            onClick: () => handleOpenTerminal(record),
          },
          // 安全驱逐功能 - PDB 规则验证完成后隐藏入口
          // {
          //   key: 'evict',
          //   label: '安全驱逐',
          //   icon: <ExportOutlined />,
          //   onClick: () => handleEvict(record),
          // },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: isSystemResource(record),
            tooltip: getSystemResourceProtectionHint(record),
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
        
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [handleViewDetail, handleViewLog, handleOpenTerminal, handleEvict, handleDelete, modal, getOwnerWorkload]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    'harvester-containers-pods',
  );
  
  return (
    <PageDetailSection asCard={false}>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/命名空间/所属工作负载"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选命名空间"
            allowClear
            showSearch
            optionFilterProp="label"
            value={nsValue || undefined}
            onChange={onNsChange}
            options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选节点"
            allowClear
            showSearch
            optionFilterProp="label"
            value={nodeValue || undefined}
            onChange={onNodeChange}
            options={nodesOptions.map((node) => ({ label: node, value: node }))}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选状态"
            allowClear
            value={statusFilter ?? undefined}
            onChange={setStatusFilter}
            options={[
              { label: '运行中', value: 'Running' },
              { label: '等待中', value: 'Pending' },
              { label: '已完成', value: 'Succeeded' },
              { label: '失败', value: 'Failed' },
            ]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange(undefined);
              onNodeChange(undefined);
              setStatusFilter(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          <Dropdown
            menu={{
              items: [
                {
                  key: 'batchDelete',
                  label: selectedKeys.length > 0 ? `批量删除 (${selectedKeys.length})` : '批量删除',
                  danger: true,
                  disabled: selectedKeys.length === 0,
                },
              ],
              onClick: ({ key }) => {
                if (key === 'batchDelete') handleBatchDelete();
              },
            }}
            trigger={['click']}
            disabled={selectedKeys.length === 0}
          >
            <Button icon={<EllipsisOutlined />} disabled={selectedKeys.length === 0} />
          </Dropdown>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey="harvester-containers-pods"
          />
          <Tooltip title="刷新">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={() => onRefresh(true)}
            />
          </Tooltip>
        </div>
      </div>
      
      <Table
        className="std-table"
        bordered={false}
        rowKey={(record) => `${record?.metadata?.namespace}/${record?.metadata?.name}`}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
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
        cloudId={cloudId}
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
          onClose={() => setLogVisible(false)}
          onBack={() => { setLogVisible(false); setDetailVisible(true); }}
        />
      )}
      
      {/* Pod 终端 */}
      {terminalPod && (
        <PodTerminal
          visible={terminalVisible}
          cloudId={cloudId}
          namespace={terminalPod?.metadata?.namespace}
          podName={terminalPod?.metadata?.name}
          containers={terminalContainers}
          defaultContainer={terminalContainers[0]}
          onClose={() => {
            setTerminalVisible(false);
            setTerminalPod(null);
          }}
        />
      )}
    </PageDetailSection>
  );
};

export default PodsSection;
