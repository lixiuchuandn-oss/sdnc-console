/**
 * ==============================================================================
 * 模块名称: Harvester 容器工作负载视图 (WorkloadsSection)
 * 文件路径: src/pages/Clouds/Harvester/containers/WorkloadsSection.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件负责展示和管理 Harvester/Kubernetes 容器工作负载，包括：
 * 1. Deployment 管理
 * 2. StatefulSet 管理
 * 3. DaemonSet 管理
 * 
 * [核心逻辑]
 * 1. 工作负载类型切换: 通过 Tab 切换不同类型的工作负载
 * 2. 命名空间筛选: 支持按命名空间过滤
 * 3. 操作功能: 创建、删除、扩缩容、重启
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Tabs, Select, Button, Tag, Space, Dropdown, Modal, Input, InputNumber, App, Badge, Tooltip, Popconfirm } from 'antd';
import { EllipsisOutlined, ReloadOutlined, PlusOutlined, MinusOutlined, PlayCircleOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import {
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
  scaleHarvesterDeployment,
  restartHarvesterDeployment,
  deleteHarvesterContainerResource,
} from '../../../../services/harvesterApi';

type Props = {
  deployments: any[];
  statefulsets: any[];
  daemonsets: any[];
  loading: boolean;
  namespacesOptions: string[];
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
};

/**
 * 工作负载状态渲染
 */
const renderWorkloadStatus = (workload: any, type: 'deployment' | 'statefulset' | 'daemonset') => {
  const status = workload?.status;
  
  if (type === 'deployment') {
    const replicas = workload?.spec?.replicas || 0;
    const readyReplicas = status?.readyReplicas || 0;
    const updatedReplicas = status?.updatedReplicas || 0;
    const availableReplicas = status?.availableReplicas || 0;
    
    if (readyReplicas === replicas && availableReplicas === replicas) {
      return <Tag color="green">运行中</Tag>;
    } else if (readyReplicas < replicas) {
      return <Tag color="orange">更新中 ({readyReplicas}/{replicas})</Tag>;
    } else if (replicas === 0) {
      return <Tag color="default">已停止</Tag>;
    }
    return <Tag color="blue">{readyReplicas}/{replicas}</Tag>;
  }
  
  if (type === 'statefulset') {
    const replicas = workload?.spec?.replicas || 0;
    const readyReplicas = status?.readyReplicas || 0;
    const currentReplicas = status?.currentReplicas || 0;
    
    if (readyReplicas === replicas && readyReplicas === currentReplicas) {
      return <Tag color="green">运行中</Tag>;
    } else if (readyReplicas < replicas) {
      return <Tag color="orange">更新中 ({readyReplicas}/{replicas})</Tag>;
    } else if (replicas === 0) {
      return <Tag color="default">已停止</Tag>;
    }
    return <Tag color="blue">{readyReplicas}/{replicas}</Tag>;
  }
  
  if (type === 'daemonset') {
    const desiredNumberScheduled = status?.desiredNumberScheduled || 0;
    const numberReady = status?.numberReady || 0;
    const numberAvailable = status?.numberAvailable || 0;
    
    if (numberReady === desiredNumberScheduled && numberAvailable === desiredNumberScheduled) {
      return <Tag color="green">运行中</Tag>;
    } else if (numberReady < desiredNumberScheduled) {
      return <Tag color="orange">更新中 ({numberReady}/{desiredNumberScheduled})</Tag>;
    }
    return <Tag color="blue">{numberReady}/{desiredNumberScheduled}</Tag>;
  }
  
  return <Tag>未知</Tag>;
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
 * 工作负载表格组件
 */
const WorkloadTable: React.FC<{
  type: 'deployment' | 'statefulset' | 'daemonset';
  data: any[];
  loading: boolean;
  cloudId: string;
  onRefresh: () => void;
  onCreate?: () => void;
}> = ({ type, data, loading, cloudId, onRefresh, onCreate }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  
  const typeLabel = type === 'deployment' ? 'Deployment' : type === 'statefulset' ? 'StatefulSet' : 'DaemonSet';
  const apiPath = type === 'deployment' 
    ? '/apis/apps/v1/deployments' 
    : type === 'statefulset' 
      ? '/apis/apps/v1/statefulsets' 
      : '/apis/apps/v1/daemonsets';
  
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
  
  // 扩缩容操作
  const handleScale = useCallback((record: any) => {
    const currentReplicas = record?.spec?.replicas || 0;
    const namespace = record?.metadata?.namespace;
    const name = record?.metadata?.name;
    
    modal.confirm({
      title: '扩缩容',
      content: (
        <div>
          <p>当前副本数: {currentReplicas}</p>
          <InputNumber 
            defaultValue={currentReplicas} 
            min={0} 
            max={100}
            id="replicas-input"
            style={{ width: '100%', marginTop: 8 }}
          />
        </div>
      ),
      onOk: async () => {
        const input = document.getElementById('replicas-input') as HTMLInputElement;
        const replicas = parseInt(input?.value || '0', 10);
        try {
          await scaleHarvesterDeployment(cloudId, namespace, name, replicas);
          message.success('扩缩容指令已下发');
          onRefresh();
        } catch (e: any) {
          message.error(e?.message || '扩缩容失败');
        }
      },
    });
  }, [cloudId, modal, message, onRefresh]);
  
  // 重启操作
  const handleRestart = useCallback(async (record: any) => {
    const namespace = record?.metadata?.namespace;
    const name = record?.metadata?.name;
    
    try {
      await restartHarvesterDeployment(cloudId, namespace, name);
      message.success('重启指令已下发');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '重启失败');
    }
  }, [cloudId, message, onRefresh]);
  
  // 删除操作
  const handleDelete = useCallback(async (record: any) => {
    const namespace = record?.metadata?.namespace;
    const name = record?.metadata?.name;
    
    try {
      await deleteHarvesterContainerResource(cloudId, apiPath, namespace, name);
      message.success('删除成功');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, apiPath, message, onRefresh]);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      width: 200,
      ellipsis: true,
    },
    {
      title: '命名空间',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      width: 150,
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_: any, record: any) => renderWorkloadStatus(record, type),
    },
    {
      title: '副本数',
      key: 'replicas',
      width: 100,
      render: (_: any, record: any) => {
        if (type === 'daemonset') {
          const desired = record?.status?.desiredNumberScheduled || 0;
          const ready = record?.status?.numberReady || 0;
          return `${ready}/${desired}`;
        }
        const spec = record?.spec?.replicas || 0;
        const ready = record?.status?.readyReplicas || 0;
        return `${ready}/${spec}`;
      },
    },
    {
      title: '镜像',
      key: 'image',
      width: 200,
      ellipsis: true,
      render: (_: any, record: any) => {
        const containers = record?.spec?.template?.spec?.containers || [];
        const images = containers.map((c: any) => c?.image).filter(Boolean);
        return images.length > 0 ? images[0] : '-';
      },
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
            key: 'scale',
            label: '扩缩容',
            icon: <MinusOutlined />,
            onClick: () => handleScale(record),
            show: type === 'deployment' || type === 'statefulset',
          },
          {
            key: 'restart',
            label: '重启',
            icon: <PlayCircleOutlined />,
            onClick: () => handleRestart(record),
            show: type === 'deployment' || type === 'statefulset',
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 ${typeLabel} "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
            show: true,
          },
        ].filter((item) => item.show);
        
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [type, handleScale, handleRestart, handleDelete, modal, typeLabel]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    `harvester-containers-${type}`,
  );
  
  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Input.Search
            placeholder="搜索名称/命名空间"
            allowClear
            style={{ width: 200 }}
            onSearch={setKeyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh()}>
            刷新
          </Button>
          {onCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              创建
            </Button>
          )}
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey={`harvester-containers-${type}`}
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
    </div>
  );
};

/**
 * 工作负载 Section 主组件
 */
const WorkloadsSection: React.FC<Props> = ({
  deployments,
  statefulsets,
  daemonsets,
  loading,
  namespacesOptions,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'deployment' | 'statefulset' | 'daemonset'>('deployment');
  
  // Tab 切换
  const handleTabChange = (key: string) => {
    setActiveTab(key as 'deployment' | 'statefulset' | 'daemonset');
  };
  
  // 根据当前 Tab 获取数据
  const getCurrentData = () => {
    switch (activeTab) {
      case 'deployment':
        return deployments;
      case 'statefulset':
        return statefulsets;
      case 'daemonset':
        return daemonsets;
      default:
        return [];
    }
  };
  
  // 根据 nsValue 过滤数据
  const filteredDeployments = useMemo(() => {
    if (!nsValue) return deployments;
    return deployments.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [deployments, nsValue]);
  
  const filteredStatefulSets = useMemo(() => {
    if (!nsValue) return statefulsets;
    return statefulsets.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [statefulsets, nsValue]);
  
  const filteredDaemonSets = useMemo(() => {
    if (!nsValue) return daemonsets;
    return daemonsets.filter((item: any) => item?.metadata?.namespace === nsValue);
  }, [daemonsets, nsValue]);
  
  return (
    <PageDetailSection
      title="工作负载"
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
            key: 'deployment',
            label: `Deployment (${filteredDeployments.length})`,
            children: (
              <WorkloadTable
                type="deployment"
                data={filteredDeployments}
                loading={loading}
                cloudId={cloudId}
                onRefresh={onRefresh}
              />
            ),
          },
          {
            key: 'statefulset',
            label: `StatefulSet (${filteredStatefulSets.length})`,
            children: (
              <WorkloadTable
                type="statefulset"
                data={filteredStatefulSets}
                loading={loading}
                cloudId={cloudId}
                onRefresh={onRefresh}
              />
            ),
          },
          {
            key: 'daemonset',
            label: `DaemonSet (${filteredDaemonSets.length})`,
            children: (
              <WorkloadTable
                type="daemonset"
                data={filteredDaemonSets}
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

export default WorkloadsSection;
