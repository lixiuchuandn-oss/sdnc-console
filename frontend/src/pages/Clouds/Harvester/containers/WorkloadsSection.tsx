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
 * 1. 工作负载类型切换: 通过 Segmented 切换不同类型的工作负载
 * 2. 命名空间筛选: 支持按命名空间过滤
 * 3. 操作功能: 创建、删除、扩缩容、重启
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Table, Segmented, Select, Tag, Modal, Input, InputNumber, App, Button, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import {
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
  scaleHarvesterDeployment,
  restartHarvesterDeployment,
  deleteHarvesterContainerResource,
} from '../../../../services/harvesterApi';
import { WorkloadFormModal, WorkloadType } from './components';

type Props = {
  deployments: any[];
  statefulsets: any[];
  daemonsets: any[];
  loading: boolean;
  namespacesOptions: string[];
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];  // 包含完整凭证信息的 Secret 列表（用于仓库浏览）
  // ConfigMap 和 Secret 列表（用于环境变量引入和存储卷挂载）
  configMaps?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  secrets?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  // PVC 列表（用于存储卷挂载）
  persistentVolumeClaims?: Array<{ metadata: { name: string; namespace: string } }>;
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  /** 创建表单默认命名空间（如按 tower.io/scenario 解析）；未传则用 nsValue */
  createDefaultNamespace?: string;
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
  onEdit?: (record: any) => void;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onCreateClick: () => void;
}> = ({ type, data, loading, cloudId, onRefresh, onEdit, namespacesOptions, nsValue, onNsChange, onCreateClick }) => {
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  
  const typeLabel = type === 'deployment' ? '部署' : type === 'statefulset' ? '有状态副本集' : '守护进程集';
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
      sorter: (a: any, b: any) => new Date(a?.metadata?.creationTimestamp || 0).getTime() - new Date(b?.metadata?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: any) => {
        const items = [
          {
            key: 'edit',
            label: '编辑',
            onClick: () => onEdit?.(record),
          },
          {
            key: 'scale',
            label: '扩缩容',
            onClick: () => handleScale(record),
            show: type === 'deployment' || type === 'statefulset',
          },
          {
            key: 'restart',
            label: '重启',
            onClick: () => handleRestart(record),
            show: type === 'deployment' || type === 'statefulset',
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除',
                content: `确定要删除 ${typeLabel} "${record?.metadata?.name}" 吗？`,
                okType: 'danger',
                onOk: () => handleDelete(record),
              });
            },
          },
        ].filter((item) => !item.show || item.show === true).map(({ show, ...rest }) => rest);
        
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [type, handleScale, handleRestart, handleDelete, onEdit, modal, typeLabel]);
  
  // 使用列设置 Hook
  const { displayColumns: tableColumns } = useTableColumnSettings(
    columns,
    `harvester-containers-${type}`,
  );
  
  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            className="toolbar-search"
            allowClear
            placeholder="名称/命名空间"
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
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              onNsChange(undefined);
            }}
          >
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" onClick={onCreateClick}>
            创建工作负载
          </Button>
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey={`harvester-containers-${type}`}
          />
          <Tooltip title="刷新">
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={() => onRefresh()}
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
  imagePullSecrets,
  secretsWithCredentials,
  configMaps,
  secrets,
  persistentVolumeClaims,
  cloudId,
  nsValue,
  onNsChange,
  onRefresh,
  createDefaultNamespace,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue;
  const [activeTab, setActiveTab] = useState<'deployment' | 'statefulset' | 'daemonset'>('deployment');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createType, setCreateType] = useState<WorkloadType>('deployment');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  
  // 打开创建弹窗
  const handleOpenCreate = useCallback(() => {
    // 如果镜像凭证为空，先刷新资源
    if (imagePullSecrets.length === 0) {
      onRefresh(true);
    }
    setCreateType(activeTab as WorkloadType);
    setCreateModalVisible(true);
  }, [activeTab, imagePullSecrets.length, onRefresh]);
  
  // 打开编辑弹窗
  const handleEdit = useCallback((record: any) => {
    setEditRecord(record);
    setEditModalVisible(true);
  }, []);
  
  // 根据 nsValue 过滤数据，并按创建时间倒序排序
  const filteredDeployments = useMemo(() => {
    let result = deployments;
    if (nsValue) result = result.filter((item: any) => item?.metadata?.namespace === nsValue);
    return result.sort((a: any, b: any) => new Date(b?.metadata?.creationTimestamp || 0).getTime() - new Date(a?.metadata?.creationTimestamp || 0).getTime());
  }, [deployments, nsValue]);
  
  const filteredStatefulSets = useMemo(() => {
    let result = statefulsets;
    if (nsValue) result = result.filter((item: any) => item?.metadata?.namespace === nsValue);
    return result.sort((a: any, b: any) => new Date(b?.metadata?.creationTimestamp || 0).getTime() - new Date(a?.metadata?.creationTimestamp || 0).getTime());
  }, [statefulsets, nsValue]);
  
  const filteredDaemonSets = useMemo(() => {
    let result = daemonsets;
    if (nsValue) result = result.filter((item: any) => item?.metadata?.namespace === nsValue);
    return result.sort((a: any, b: any) => new Date(b?.metadata?.creationTimestamp || 0).getTime() - new Date(a?.metadata?.creationTimestamp || 0).getTime());
  }, [daemonsets, nsValue]);

  const workloadTableData = useMemo(() => {
    switch (activeTab) {
      case 'deployment':
        return filteredDeployments;
      case 'statefulset':
        return filteredStatefulSets;
      case 'daemonset':
        return filteredDaemonSets;
      default:
        return filteredDeployments;
    }
  }, [activeTab, filteredDeployments, filteredStatefulSets, filteredDaemonSets]);
  
  return (
    <>
      <PageDetailSection asCard={false}>
        <Segmented
          style={{ marginBottom: 12 }}
          value={activeTab}
          onChange={(v) => setActiveTab(v as 'deployment' | 'statefulset' | 'daemonset')}
          options={[
            { label: `部署 (${filteredDeployments.length})`, value: 'deployment' },
            { label: `有状态副本集 (${filteredStatefulSets.length})`, value: 'statefulset' },
            { label: `守护进程集 (${filteredDaemonSets.length})`, value: 'daemonset' },
          ]}
        />
        <WorkloadTable
          key={activeTab}
          type={activeTab}
          data={workloadTableData}
          loading={loading}
          cloudId={cloudId}
          onRefresh={onRefresh}
          onEdit={handleEdit}
          namespacesOptions={namespacesOptions}
          nsValue={nsValue}
          onNsChange={onNsChange}
          onCreateClick={handleOpenCreate}
        />
      </PageDetailSection>
      
      <WorkloadFormModal
        visible={createModalVisible}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        imagePullSecrets={imagePullSecrets}
        secretsWithCredentials={secretsWithCredentials}
        configMaps={configMaps}
        secrets={secrets}
        persistentVolumeClaims={persistentVolumeClaims}
        onRefreshImagePullSecrets={() => onRefresh(true)}
        defaultNamespace={formDefaultNs}
        defaultType={createType}
        onSuccess={() => {
          onRefresh(true);
        }}
        onCancel={() => setCreateModalVisible(false)}
      />

      <WorkloadFormModal
        visible={editModalVisible}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions}
        imagePullSecrets={imagePullSecrets}
        secretsWithCredentials={secretsWithCredentials}
        configMaps={configMaps}
        secrets={secrets}
        persistentVolumeClaims={persistentVolumeClaims}
        onRefreshImagePullSecrets={() => onRefresh(true)}
        editData={editRecord}
        onSuccess={() => {
          setEditModalVisible(false);
          setEditRecord(null);
          onRefresh(true);
        }}
        onCancel={() => {
          setEditModalVisible(false);
          setEditRecord(null);
        }}
      />
    </>
  );
};

export default WorkloadsSection;
