/**
 * Service 列表关联的 Pod：关联 Pod 列表抽屉、详情抽屉、日志抽屉、终端（容器域 drawers）。
 */
import React, { useEffect, useState } from 'react';
import { Drawer, Descriptions, Tabs, Tag, Space, Button, Table } from 'antd';
import { FileTextOutlined, CodeOutlined } from '@ant-design/icons';
import YamlEditor from '../../../../../../components/YamlEditor';
import { fetchHarvesterPodEvents } from '../../../../../../services/harvesterApi';
import { PodLogViewer, PodTerminal } from '../components';
import ServiceRelatedPodsTab from '../../shared/components/ServiceRelatedPodsTab';

const formatTime = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    return new Date(timestamp).toLocaleString('zh-CN');
  } catch {
    return timestamp;
  }
};

const calculateAge = (timestamp?: string) => {
  if (!timestamp) return '-';
  try {
    const created = new Date(timestamp).getTime();
    const diff = Date.now() - created;
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

export type ServicePodDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  pod: any | null;
  cloudId: string;
  onViewPodLog: (pod: any) => void;
  onOpenPodTerminal: (pod: any) => void;
};

export type ServiceRelatedPodsDrawerProps = {
  open: boolean;
  onClose: () => void;
  serviceNamespace?: string;
  serviceName?: string;
  serviceSelector?: Record<string, string>;
  pods?: any[];
  podsLoading?: boolean;
  onViewPodDetail: (pod: any) => void;
  onViewPodLog: (pod: any) => void;
  onOpenPodTerminal: (pod: any) => void;
};

export const ServiceRelatedPodsDrawer: React.FC<ServiceRelatedPodsDrawerProps> = ({
  open,
  onClose,
  serviceSelector,
  pods = [],
  podsLoading,
  onViewPodDetail,
  onViewPodLog,
  onOpenPodTerminal,
}) => (
  <Drawer
    title="查看关联 Pod"
    placement="right"
    width={800}
    open={open}
    onClose={onClose}
    destroyOnHidden
  >
    <ServiceRelatedPodsTab
      serviceSelector={serviceSelector}
      pods={pods}
      loading={podsLoading}
      onViewDetail={onViewPodDetail}
      onViewLog={onViewPodLog}
      onOpenTerminal={onOpenPodTerminal}
    />
  </Drawer>
);

export const ServicePodDetailDrawer: React.FC<ServicePodDetailDrawerProps> = ({
  open,
  onClose,
  pod,
  cloudId,
  onViewPodLog,
  onOpenPodTerminal,
}) => {
  const [podEvents, setPodEvents] = useState<any[]>([]);
  const [podEventsLoading, setPodEventsLoading] = useState(false);

  useEffect(() => {
    if (!open || !pod?.metadata?.namespace || !pod?.metadata?.name || !cloudId) {
      setPodEvents([]);
      return;
    }
    let cancelled = false;
    setPodEventsLoading(true);
    void fetchHarvesterPodEvents(cloudId, pod.metadata.namespace, pod.metadata.name)
      .then((result) => {
        if (!cancelled) setPodEvents(result?.data?.items || []);
      })
      .catch(() => {
        if (!cancelled) setPodEvents([]);
      })
      .finally(() => {
        if (!cancelled) setPodEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, cloudId, pod?.metadata?.namespace, pod?.metadata?.name]);

  const handleClose = () => {
    setPodEvents([]);
    onClose();
  };

  return (
    <Drawer
      title="Pod 详情"
      placement="right"
      width={700}
      open={open}
      onClose={handleClose}
      extra={
        <Space>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => {
              handleClose();
              if (pod) onViewPodLog(pod);
            }}
          >
            查看日志
          </Button>
          <Button
            icon={<CodeOutlined />}
            onClick={() => {
              handleClose();
              if (pod) onOpenPodTerminal(pod);
            }}
          >
            终端
          </Button>
        </Space>
      }
    >
      {pod && (
        <Tabs
          items={[
            {
              key: 'overview',
              label: '概览',
              children: (
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="名称">{pod.metadata?.name}</Descriptions.Item>
                  <Descriptions.Item label="项目">{pod.metadata?.namespace}</Descriptions.Item>
                  <Descriptions.Item label="状态">{renderPodStatus(pod)}</Descriptions.Item>
                  <Descriptions.Item label="节点">{pod.spec?.nodeName || '-'}</Descriptions.Item>
                  <Descriptions.Item label="IP">{pod.status?.podIP || '-'}</Descriptions.Item>
                  <Descriptions.Item label="运行时长">{calculateAge(pod.metadata?.creationTimestamp)}</Descriptions.Item>
                  <Descriptions.Item label="创建时间" span={2}>
                    {formatTime(pod.metadata?.creationTimestamp)}
                  </Descriptions.Item>
                  <Descriptions.Item label="标签" span={2}>
                    <Space size={4} wrap>
                      {Object.entries(pod.metadata?.labels || {}).map(([k, v]) => (
                        <Tag key={k}>
                          {k}={String(v)}
                        </Tag>
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
                  dataSource={(pod.spec?.containers || []).map((c: any, idx: number) => ({
                    ...c,
                    key: idx,
                    status: (pod.status?.containerStatuses || []).find((s: any) => s.name === c.name),
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
                  size="small"
                />
              ),
            },
            {
              key: 'events',
              label: '事件',
              children: (
                <Table
                  loading={podEventsLoading}
                  dataSource={podEvents.map((e: any, idx: number) => ({ ...e, key: idx }))}
                  columns={[
                    {
                      title: '类型',
                      dataIndex: 'type',
                      render: (v: string) => <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v || '-'}</Tag>,
                    },
                    { title: '原因', dataIndex: 'reason' },
                    { title: '消息', dataIndex: 'message', ellipsis: true },
                    { title: '次数', dataIndex: 'count', render: (v: number) => v || 1 },
                    { title: '时间', dataIndex: 'lastTimestamp', render: formatTime },
                  ]}
                  pagination={false}
                  size="small"
                  locale={{ emptyText: '暂无事件' }}
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
      )}
    </Drawer>
  );
};

export type ServicePodLogDrawerProps = {
  open: boolean;
  onClose: () => void;
  pod: any | null;
  cloudId: string;
  containers: string[];
};

export const ServicePodLogDrawer: React.FC<ServicePodLogDrawerProps> = ({
  open,
  onClose,
  pod,
  cloudId,
  containers,
}) => (
  <Drawer
    title="Pod 日志"
    placement="right"
    width={900}
    open={open}
    onClose={onClose}
  >
    {pod && (
      <PodLogViewer
        cloudId={cloudId}
        namespace={pod.metadata?.namespace}
        podName={pod.metadata?.name}
        containers={containers}
        height="calc(100vh - 150px)"
      />
    )}
  </Drawer>
);

export type ServicePodTerminalBridgeProps = {
  visible: boolean;
  onClose: () => void;
  pod: any | null;
  cloudId: string;
  containers: string[];
};

export const ServicePodTerminalBridge: React.FC<ServicePodTerminalBridgeProps> = ({
  visible,
  onClose,
  pod,
  cloudId,
  containers,
}) => {
  if (!pod) return null;
  return (
    <PodTerminal
      visible={visible}
      cloudId={cloudId}
      namespace={pod.metadata?.namespace}
      podName={pod.metadata?.name}
      containers={containers}
      defaultContainer={containers[0]}
      onClose={onClose}
    />
  );
};
