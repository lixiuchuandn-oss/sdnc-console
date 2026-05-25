/**
 * ==============================================================================
 * 模块名称: Harvester 容器工作负载视图 (WorkloadsSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/sections/WorkloadsSection.tsx
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
import { Table, Segmented, Select, Tag, Modal, Input, InputNumber, App, Button, Tooltip, Form, Switch } from 'antd';
import { ReloadOutlined, SearchOutlined, EditTwoTone } from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import YamlEditor from '../../../../../../components/YamlEditor';
import {
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
  scaleHarvesterDeployment,
  scaleHarvesterStatefulSet,
  restartHarvesterDeployment,
  restartHarvesterStatefulSet,
  deleteHarvesterContainerResource,
  patchHarvesterContainerResource,
} from '../../../../../../services/harvesterApi';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../utils/harvesterUtils';
import { WorkloadFormModal, WorkloadType } from '../components';
import { useContainerOperationsReadOnly } from '../ContainerOperationsContext';

type Props = {
  deployments: any[];
  statefulsets: any[];
  daemonsets: any[];
  loading: boolean;
  namespacesOptions: string[];
  imagePullSecrets: Array<{ metadata: { name: string; namespace: string } }>;
  secretsWithCredentials?: any[];
  configMaps?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  secrets?: Array<{ metadata: { name: string; namespace: string }; data?: Record<string, string> }>;
  persistentVolumeClaims?: Array<{
    metadata: { name: string; namespace: string; annotations?: Record<string, string> };
    raw?: { metadata?: { annotations?: Record<string, string> } };
    annotations?: Record<string, string>;
    alias?: string;
    name?: string;
    pvcName?: string;
  }>;
  cloudId: string;
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  createDefaultNamespace?: string;
  hideFlatSubnet?: boolean;
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
  onRefreshConfigMaps?: () => void;
  onRefreshSecrets?: () => void;
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
    const unavailableReplicas = status?.unavailableReplicas || 0;
    
    if (replicas === 0) {
      return <Tag color="default">已停止</Tag>;
    }
    if (readyReplicas === replicas && availableReplicas === replicas) {
      return <Tag color="green">运行中</Tag>;
    }
    
    const tooltipContent = (
      <div>
        <div>期望副本: {replicas}</div>
        <div>就绪副本: {readyReplicas}</div>
        <div>可用副本: {availableReplicas}</div>
        {unavailableReplicas > 0 && <div style={{ color: '#ff4d4f' }}>不可用副本: {unavailableReplicas}</div>}
        {updatedReplicas !== readyReplicas && <div>已更新副本: {updatedReplicas}</div>}
      </div>
    );
    
    if (unavailableReplicas > 0) {
      return (
        <Tooltip title={tooltipContent}>
          <Tag color="orange">异常 (就绪 {readyReplicas}/{replicas})</Tag>
        </Tooltip>
      );
    }
    
    return (
      <Tooltip title={tooltipContent}>
        <Tag color="blue">更新中 (就绪 {readyReplicas}/{replicas})</Tag>
      </Tooltip>
    );
  }
  
  if (type === 'statefulset') {
    const replicas = workload?.spec?.replicas || 0;
    const readyReplicas = status?.readyReplicas || 0;
    const currentReplicas = status?.currentReplicas || 0;
    const updatedReplicas = status?.updatedReplicas || 0;
    
    if (replicas === 0) {
      return <Tag color="default">已停止</Tag>;
    }
    if (readyReplicas === replicas && readyReplicas === currentReplicas) {
      return <Tag color="green">运行中</Tag>;
    }
    
    const tooltipContent = (
      <div>
        <div>期望副本: {replicas}</div>
        <div>就绪副本: {readyReplicas}</div>
        <div>当前副本: {currentReplicas}</div>
        {updatedReplicas !== readyReplicas && <div>已更新副本: {updatedReplicas}</div>}
      </div>
    );
    
    return (
      <Tooltip title={tooltipContent}>
        <Tag color="orange">异常 (就绪 {readyReplicas}/{replicas})</Tag>
      </Tooltip>
    );
  }
  
  if (type === 'daemonset') {
    const desiredNumberScheduled = status?.desiredNumberScheduled || 0;
    const numberReady = status?.numberReady || 0;
    const numberAvailable = status?.numberAvailable || 0;
    const numberUnavailable = status?.numberUnavailable || 0;
    
    if (numberReady === desiredNumberScheduled && numberAvailable === desiredNumberScheduled) {
      return <Tag color="green">运行中</Tag>;
    }
    
    const tooltipContent = (
      <div>
        <div>期望节点数: {desiredNumberScheduled}</div>
        <div>就绪节点数: {numberReady}</div>
        <div>可用节点数: {numberAvailable}</div>
        {numberUnavailable > 0 && <div style={{ color: '#ff4d4f' }}>不可用节点数: {numberUnavailable}</div>}
      </div>
    );
    
    if (numberUnavailable > 0) {
      return (
        <Tooltip title={tooltipContent}>
          <Tag color="orange">异常 (就绪 {numberReady}/{desiredNumberScheduled})</Tag>
        </Tooltip>
      );
    }
    
    return (
      <Tooltip title={tooltipContent}>
        <Tag color="blue">更新中 (就绪 {numberReady}/{desiredNumberScheduled})</Tag>
      </Tooltip>
    );
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
  onRefresh: (force?: boolean) => void;
  onEdit?: (record: any) => void;
  namespacesOptions: string[];
  nsValue?: string;
  onNsChange: (v?: string) => void;
  onCreateClick: () => void;
  showAllSwitch?: boolean;
  queryAll?: boolean;
  onQueryAllChange?: (checked: boolean) => void;
}> = ({ type, data, loading, cloudId, onRefresh, onEdit, namespacesOptions, nsValue, onNsChange, onCreateClick, showAllSwitch, queryAll, onQueryAllChange }) => {
  const operationsReadOnly = useContainerOperationsReadOnly();
  const { modal, message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  const [yamlModalVisible, setYamlModalVisible] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  
  const typeLabel = type === 'deployment' ? '无状态副本集' : type === 'statefulset' ? '有状态副本集' : '守护进程集';
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
  
  // 别名编辑
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.metadata?.namespace;
    const name = aliasRecord?.metadata?.name;
    if (!ns || !name) {
      message.error('未能解析资源命名空间或名称');
      return false;
    }

    const next = String(nextAliasRaw || '').trim();
    const prev = String(aliasRecord?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    if (next === prev) {
      setAliasModalVisible(false);
      return true;
    }

    const hasAnnotations = !!aliasRecord?.metadata?.annotations;
    const hasPrev = !!aliasRecord?.metadata?.annotations?.['tower.io/alias'];
    const aliasPath = '/metadata/annotations/tower.io~1alias';

    const patchBody: any[] = [];
    if (!next) {
      if (hasPrev) patchBody.push({ op: 'remove', path: aliasPath });
    } else {
      if (!hasAnnotations) {
        patchBody.push({ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': next } });
      } else {
        patchBody.push({ op: 'add', path: aliasPath, value: next });
      }
    }

    if (patchBody.length === 0) {
      setAliasModalVisible(false);
      return true;
    }

    setAliasSubmitting(true);
    try {
      await patchHarvesterContainerResource(cloudId, apiPath, ns, name, patchBody);
      message.success(next ? '名称修改成功' : '已清空别名');
      setAliasModalVisible(false);
      setAliasRecord(null);
      aliasForm.resetFields();
      onRefresh(true);
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm]);

  // 查看 YAML
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlContent(yamlStr);
      setYamlModalVisible(true);
    } catch (e: any) {
      message.error('生成 YAML 失败: ' + e.message);
    }
  }, [message]);
  
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
          if (type === 'statefulset') {
            await scaleHarvesterStatefulSet(cloudId, namespace, name, replicas);
          } else {
            await scaleHarvesterDeployment(cloudId, namespace, name, replicas);
          }
          message.success('扩缩容指令已下发');
          onRefresh(true);
        } catch (e: any) {
          message.error(e?.message || '扩缩容失败');
        }
      },
    });
  }, [cloudId, modal, message, onRefresh, type]);
  
  // 重启操作
  const handleRestart = useCallback(async (record: any) => {
    const namespace = record?.metadata?.namespace;
    const name = record?.metadata?.name;
    
    try {
      if (type === 'statefulset') {
        await restartHarvesterStatefulSet(cloudId, namespace, name);
      } else {
        await restartHarvesterDeployment(cloudId, namespace, name);
      }
      message.success('重启指令已下发');
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '重启失败');
    }
  }, [cloudId, message, onRefresh, type]);
  
  // 删除操作
  const handleDelete = useCallback(async (record: any) => {
    const namespace = record?.metadata?.namespace;
    const name = record?.metadata?.name;
    
    try {
      await deleteHarvesterContainerResource(cloudId, apiPath, namespace, name);
      message.success('删除成功');
      onRefresh(true);
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, apiPath, message, onRefresh]);
  
  // 表格列定义
  const columns = useMemo(() => [
    {
      title: '名称',
      key: 'name',
      fixed: 'left' as const,
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const hasAlias = !!alias;
        
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{hasAlias ? alias : id}</span>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record);
                }}
              />
            </Tooltip>
          </span>
        );
      },
    },
    {
      title: 'ID',
      dataIndex: ['metadata', 'name'],
      key: 'id',
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    {
      title: '项目',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: 'Pod状态',
      key: 'status',
      render: (_: any, record: any) => renderWorkloadStatus(record, type),
    },
    {
      title: '副本数',
      key: 'replicas',
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
      render: formatTime,
      sorter: (a: any, b: any) => new Date(a?.metadata?.creationTimestamp || 0).getTime() - new Date(b?.metadata?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const isSystem = isSystemResource(record);
        const systemHint = getSystemResourceProtectionHint(record);
        const itemsAll = [
          {
            key: 'edit',
            label: '编辑',
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => onEdit?.(record),
          },
          {
            key: 'yaml',
            label: '查看 YAML',
            onClick: () => handleViewYaml(record),
          },
          {
            key: 'scale',
            label: '热扩缩容',
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => handleScale(record),
            show: type === 'deployment' || type === 'statefulset',
          },
          {
            key: 'restart',
            label: '重启',
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => handleRestart(record),
            show: type === 'deployment' || type === 'statefulset',
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => {
               const alias = record?.metadata?.annotations?.['tower.io/alias'];
               const id = record?.metadata?.name || '';
               const displayName = alias ? `${alias}(${id})` : id;
               modal.confirm({
                 title: '确认删除',
                 content: `确定要删除 ${typeLabel} "${displayName}" 吗？`,
                 okType: 'danger',
                 onOk: () => handleDelete(record),
               });
             },
          },
        ];
        const items = (operationsReadOnly
          ? itemsAll.filter((i) => i.key === 'yaml')
          : itemsAll
        )
          .filter((item: any) => !item.show || item.show === true)
          .map(({ show, ...rest }: any) => rest);

        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [type, handleScale, handleRestart, handleDelete, handleViewYaml, onEdit, modal, typeLabel, operationsReadOnly]);
  
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
            placeholder="名称/项目"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="筛选项目"
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
          {showAllSwitch && (
            <Switch
              checkedChildren="全部"
              unCheckedChildren="默认"
              checked={queryAll}
              onChange={onQueryAllChange}
              style={{ marginRight: 8 }}
            />
          )}
          {!operationsReadOnly ? (
            <Button type="primary" onClick={onCreateClick}>
              创建工作负载
            </Button>
          ) : null}
          <TableColumnSettingsButton
            allColumns={columns}
            settingsKey={`harvester-containers-${type}`}
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
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={
          operationsReadOnly
            ? undefined
            : {
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
              }
        }
      />

      <Modal
        title="名称修改"
        open={aliasModalVisible}
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSubmitting}
        onOk={async () => {
          try {
            const values = await aliasForm.validateFields();
            await handleSubmitAlias(values?.alias);
          } catch {}
        }}
        onCancel={() => {
          if (aliasSubmitting) return;
          setAliasModalVisible(false);
          setAliasRecord(null);
          aliasForm.resetFields();
        }}
      >
        <Form form={aliasForm} layout="vertical">
          <Form.Item
            name="alias"
            label="名称"
            rules={[
              { max: 64, message: '别名最长 64 个字符' },
              { required: true, message: '请输入名称' },
            ]}
          >
            <Input
              autoFocus
              placeholder="请输入名称（留空则清空别名）"
              maxLength={64}
              onPressEnter={async () => {
                if (aliasSubmitting) return;
                try {
                  const values = await aliasForm.validateFields();
                  await handleSubmitAlias(values?.alias);
                } catch {}
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="YAML 查看"
        open={yamlModalVisible}
        onCancel={() => setYamlModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
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
  hideFlatSubnet = false,
  showAllSwitch,
  queryAll,
  onQueryAllChange,
  onRefreshConfigMaps,
  onRefreshSecrets,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue ?? 'default';
  const [activeTab, setActiveTab] = useState<'deployment' | 'statefulset' | 'daemonset'>('deployment');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createType, setCreateType] = useState<WorkloadType>('deployment');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<any>(null);
  
  // 打开创建弹窗
  const handleOpenCreate = useCallback(() => {
    setCreateType(activeTab as WorkloadType);
    setCreateModalVisible(true);
  }, [activeTab]);
  
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
            { label: `无状态副本集 (${filteredDeployments.length})`, value: 'deployment' },
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
          showAllSwitch={showAllSwitch}
          queryAll={queryAll}
          onQueryAllChange={onQueryAllChange}
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
        hideFlatSubnet={hideFlatSubnet}
        onRefreshConfigMaps={onRefreshConfigMaps}
        onRefreshSecrets={onRefreshSecrets}
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
        defaultNamespace={formDefaultNs}
        editData={editRecord}
        hideFlatSubnet={hideFlatSubnet}
        onRefreshConfigMaps={onRefreshConfigMaps}
        onRefreshSecrets={onRefreshSecrets}
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
