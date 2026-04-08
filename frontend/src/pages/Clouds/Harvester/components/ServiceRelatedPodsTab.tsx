/**
 * ==============================================================================
 * 模块名称: Service 关联 Pod Tab (ServiceRelatedPodsTab)
 * 文件路径: src/pages/Clouds/Harvester/components/ServiceRelatedPodsTab.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 展示 Service 通过 selector 关联的 Pod 列表。
 * 支持查看 Pod 详情、日志、终端等操作。
 * 
 * [实现原理]
 * 1. 从 Service.spec.selector 获取标签选择器
 * 2. 从 Pod 列表数据中过滤匹配的 Pod
 * 3. 展示 Pod 名称、状态、IP、节点等信息
 * 4. 通过回调函数支持父组件打开详情/日志/终端
 */

import React, { useMemo } from 'react';
import { Table, Tag, Empty, Spin, Space, Button, Tooltip } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, EyeOutlined, FileTextOutlined, CodeOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

export interface ServiceRelatedPodsTabProps {
  serviceSelector?: Record<string, string>; // Service.spec.selector
  pods: any[]; // 所有 Pod 数据
  loading?: boolean;
  onViewDetail?: (pod: any) => void; // 查看详情回调
  onViewLog?: (pod: any) => void; // 查看日志回调
  onOpenTerminal?: (pod: any) => void; // 打开终端回调
}

/**
 * 格式化时间 - 将 UTC 时间转换为本地时间显示
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

const ServiceRelatedPodsTab: React.FC<ServiceRelatedPodsTabProps> = ({
  serviceSelector,
  pods,
  loading,
  onViewDetail,
  onViewLog,
  onOpenTerminal,
}) => {
  // 根据 selector 过滤匹配的 Pod
  const matchedPods = useMemo(() => {
    if (!serviceSelector || Object.keys(serviceSelector).length === 0) {
      return [];
    }

    return (pods || []).filter((pod: any) => {
      const raw = pod.rawData || pod;
      const podLabels = raw.metadata?.labels || {};
      
      // 检查 Pod 的标签是否匹配 Service 的 selector
      return Object.entries(serviceSelector).every(([key, value]) => {
        return podLabels[key] === value;
      });
    });
  }, [serviceSelector, pods]);

  // Pod 状态渲染
  const renderPodStatus = (phase: string) => {
    const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
      Running: { color: 'success', icon: <CheckCircleOutlined /> },
      Pending: { color: 'processing', icon: <LoadingOutlined /> },
      Succeeded: { color: 'success', icon: <CheckCircleOutlined /> },
      Failed: { color: 'error', icon: <CloseCircleOutlined /> },
      Unknown: { color: 'default', icon: <CloseCircleOutlined /> },
    };
    
    const config = statusConfig[phase] || statusConfig.Unknown;
    return (
      <Tag color={config.color} icon={config.icon}>
        {phase}
      </Tag>
    );
  };

  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
      render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: renderPodStatus,
    },
    {
      title: 'Pod IP',
      dataIndex: 'podIP',
      key: 'podIP',
      width: 130,
    },
    {
      title: '节点',
      dataIndex: 'node',
      key: 'node',
      width: 120,
      ellipsis: true,
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      width: 170,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'detail',
            label: '详情',
            icon: <EyeOutlined />,
            onClick: () => onViewDetail?.(record.raw),
          },
          {
            key: 'log',
            label: '日志',
            icon: <FileTextOutlined />,
            onClick: () => onViewLog?.(record.raw),
          },
          {
            key: 'terminal',
            label: '终端',
            icon: <CodeOutlined />,
            onClick: () => onOpenTerminal?.(record.raw),
          },
        ];
        
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [onViewDetail, onViewLog, onOpenTerminal]);

  // 转换 Pod 数据为表格格式
  const tableData = useMemo(() => {
    return matchedPods.map((pod: any) => {
      const raw = pod.rawData || pod;
      return {
        key: raw.metadata?.uid || raw.metadata?.name,
        name: raw.metadata?.name,
        namespace: raw.metadata?.namespace,
        status: raw.status?.phase || 'Unknown',
        podIP: raw.status?.podIP || '-',
        node: raw.spec?.nodeName || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || '-',
        raw,
      };
    });
  }, [matchedPods]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
        <Spin tip="加载中..." />
      </div>
    );
  }

  if (!serviceSelector || Object.keys(serviceSelector).length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Empty
          description={
            <span style={{ color: '#999' }}>
              此 Service 未配置选择器 (selector)，无法关联 Pod
            </span>
          }
        />
      </div>
    );
  }

  if (tableData.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Empty
          description={
            <span style={{ color: '#999' }}>
              未找到匹配的 Pod（选择器: {Object.entries(serviceSelector).map(([k, v]) => `${k}=${v}`).join(', ')}）
            </span>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
      <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
        选择器: {Object.entries(serviceSelector).map(([k, v]) => (
          <Tag key={k} style={{ marginBottom: 4 }}>{k}={v}</Tag>
        ))}
        <span style={{ marginLeft: 8 }}>匹配 {tableData.length} 个 Pod</span>
      </div>
      <Table
        columns={columns}
        dataSource={tableData}
        pagination={{ size: 'small', pageSize: 10 }}
        size="small"
        bordered
        scroll={{ x: 900 }}
      />
    </div>
  );
};

export default ServiceRelatedPodsTab;