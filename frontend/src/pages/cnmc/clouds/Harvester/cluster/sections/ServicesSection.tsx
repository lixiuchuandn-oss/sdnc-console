/**
 * Harvester - Service 列表 Section
 * 展示集群中的 Service 资源（包括 ClusterIP / NodePort / LoadBalancer 等），
 * 支持：
 * - 按名称/命名空间关键字过滤
 * - 按 Service 类型过滤
 * - 创建新的 Service
 * - 打开 HarvesterResourceDrawer 查看 Service 详情
 */
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Table, Button, Input, Select, App, Modal, Drawer, Descriptions, Tabs, Tag, Space, Form, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined, PlusOutlined, DeleteOutlined, EyeOutlined, FileTextOutlined, CodeOutlined, EditTwoTone } from '@ant-design/icons';
import yaml from 'js-yaml';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import YamlEditor from '../../../../../../components/YamlEditor';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import { deleteHarvesterService, fetchHarvesterServiceDetail, updateHarvesterService, fetchHarvesterPodLog, fetchHarvesterPodEvents, patchHarvesterContainerResource } from '../../../../../../services/harvesterApi';
import { ServiceFormModal, YamlEditModal, PodTerminal, PodLogViewer } from '../../containers/components';

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
 * Pod 状态渲染
 */
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
  
  // 检查是否正在终止
  if (pod?.metadata?.deletionTimestamp) {
    return <Tag color="orange">终止中</Tag>;
  }
  
  const status = statusMap[phase] || statusMap.Unknown;
  return <Tag color={status.color}>{status.text}</Tag>;
};

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于在详情抽屉中进一步读取事件等信息
 * - services: Service 列表，可能为原生对象或带 rawData 的包装对象
 * - loading: 外层传入的加载状态
 * - onRefresh: 手动刷新回调，支持 force=true
 * - namespacesOptions: 命名空间选项列表
 * - pods: Pod 列表，用于查看关联 Pod
 */
interface Props {
  cloudId: string;
  services: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean;
  namespacesOptions?: string[];
  /** 与其它容器 Tab 共用的命名空间筛选 */
  nsValue?: string;
  onNsChange?: (v?: string) => void;
  pods?: any[];
  mode?: 'standard' | 'ops';
  createDefaultNamespace?: string;
}

const ServicesSection: React.FC<Props> = ({
  cloudId,
  services,
  loading,
  onRefresh,
  isTenant,
  namespacesOptions,
  nsValue,
  onNsChange,
  pods,
  mode = 'ops',
  createDefaultNamespace,
}) => {
  const formDefaultNs = createDefaultNamespace ?? nsValue;
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { message } = App.useApp();
  const isStandardView = mode === 'standard';
  // 工具栏过滤及详情抽屉状态
  const [keyword, setKeyword] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');
  
  // 创建/编辑弹窗状态
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  
  // YAML 编辑弹窗状态
  const [yamlModalOpen, setYamlModalOpen] = useState(false);
  const [yamlEditingRecord, setYamlEditingRecord] = useState<any>(null);
  
  // 别名编辑状态
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasRecord, setAliasRecord] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);
  const [aliasForm] = Form.useForm<{ alias?: string }>();
  
  // YAML 查看状态（只读）
  const [yamlViewModalVisible, setYamlViewModalVisible] = useState(false);
  const [yamlViewContent, setYamlViewContent] = useState('');
  
  // API 路径
  const apiPath = '/api/v1/services';
  
  // Pod 详情/日志/终端状态
  const [podDetailVisible, setPodDetailVisible] = useState(false);
  const [currentPod, setCurrentPod] = useState<any>(null);
  const [podLogVisible, setPodLogVisible] = useState(false);
  const [podLogContainers, setPodLogContainers] = useState<string[]>([]);
  const [podTerminalVisible, setPodTerminalVisible] = useState(false);
  const [podTerminalContainers, setPodTerminalContainers] = useState<string[]>([]);
  const [podEvents, setPodEvents] = useState<any[]>([]);
  const [podEventsLoading, setPodEventsLoading] = useState(false);
  
  // 删除 Service
  const handleDelete = async (record: any) => {
    try {
      await deleteHarvesterService(cloudId, record.namespace, record.name);
      message.success('删除成功');
      onRefresh?.(true);
    } catch (error: any) {
      message.error(`删除失败: ${error?.message || '未知错误'}`);
    }
  };
  
  // 编辑 Service
  const handleEdit = (record: any) => {
    setEditingRecord(record);
    setEditModalOpen(true);
  };
  
  // YAML 编辑
  const handleYamlEdit = (record: any) => {
    setYamlEditingRecord(record);
    setYamlModalOpen(true);
  };
  
  // 打开别名编辑弹窗
  const handleOpenAliasModal = useCallback((record: any) => {
    const currentAlias = record?.raw?.metadata?.annotations?.['tower.io/alias'] || '';
    setAliasRecord(record);
    setAliasModalVisible(true);
    aliasForm.setFieldsValue({ alias: String(currentAlias || '') });
  }, [aliasForm]);

  // 提交别名修改
  const handleSubmitAlias = useCallback(async (nextAliasRaw?: string) => {
    if (!aliasRecord) return false;
    const ns = aliasRecord?.namespace;
    const name = aliasRecord?.name;
    if (!ns || !name) {
      message.error('未能解析资源命名空间或名称');
      return false;
    }

    const next = String(nextAliasRaw || '').trim();
    const prev = String(aliasRecord?.raw?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    if (next === prev) {
      setAliasModalVisible(false);
      return true;
    }

    const hasAnnotations = !!aliasRecord?.raw?.metadata?.annotations;
    const hasPrev = !!aliasRecord?.raw?.metadata?.annotations?.['tower.io/alias'];
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
      onRefresh?.(true);
      return true;
    } catch (e: any) {
      console.error(e);
      message.error(e?.message || '名称修改失败');
      return false;
    } finally {
      setAliasSubmitting(false);
    }
  }, [aliasRecord, apiPath, cloudId, message, onRefresh, aliasForm]);

  // 查看 YAML（只读）
  const handleViewYaml = useCallback((record: any) => {
    try {
      const yamlStr = yaml.dump(record?.raw || record, { indent: 2, lineWidth: -1, noRefs: true });
      setYamlViewContent(yamlStr);
      setYamlViewModalVisible(true);
    } catch (e: any) {
      message.error('生成 YAML 失败: ' + e.message);
    }
  }, [message]);
  
  // 加载 YAML 内容
  const loadServiceYaml = useCallback(async () => {
    if (!yamlEditingRecord) return '';
    const response = await fetchHarvesterServiceDetail(cloudId, yamlEditingRecord.namespace, yamlEditingRecord.name);
    // 只返回 Service 对象本身，而不是完整 API 响应
    const serviceData = response?.data || response;
    // 过滤掉 managedFields，避免干扰用户编辑
    const cleanData = {
      ...serviceData,
      metadata: {
        ...serviceData?.metadata,
        managedFields: undefined,
      },
    };
    return JSON.stringify(cleanData, null, 2);
  }, [cloudId, yamlEditingRecord]);
  
  // 保存 YAML 内容
  const saveServiceYaml = useCallback(async (yaml: string) => {
    if (!yamlEditingRecord) return;
    const data = JSON.parse(yaml);
    await updateHarvesterService(cloudId, yamlEditingRecord.namespace, yamlEditingRecord.name, data);
  }, [cloudId, yamlEditingRecord]);
  
  // Pod 详情
  const handleViewPodDetail = useCallback(async (pod: any) => {
    setCurrentPod(pod);
    setPodDetailVisible(true);
    // 加载 Pod Events
    if (cloudId && pod?.metadata?.namespace && pod?.metadata?.name) {
      setPodEventsLoading(true);
      try {
        const result = await fetchHarvesterPodEvents(cloudId, pod.metadata.namespace, pod.metadata.name);
        setPodEvents(result?.data?.items || []);
      } catch (e) {
        setPodEvents([]);
      } finally {
        setPodEventsLoading(false);
      }
    }
  }, [cloudId]);
  
  // Pod 日志
  const handleViewPodLog = useCallback((pod: any) => {
    const containerStatuses = pod?.status?.containerStatuses || [];
    const specContainers = pod?.spec?.containers || [];
    const containers = containerStatuses.length > 0 
      ? containerStatuses.map((c: any) => c.name)
      : specContainers.map((c: any) => c.name);
    setCurrentPod(pod);
    setPodLogContainers(containers);
    setPodLogVisible(true);
  }, []);
  
  // Pod 终端
  const handleOpenPodTerminal = useCallback((pod: any) => {
    const containerStatuses = pod?.status?.containerStatuses || [];
    const specContainers = pod?.spec?.containers || [];
    const containers = containerStatuses.length > 0 
      ? containerStatuses.map((c: any) => c.name)
      : specContainers.map((c: any) => c.name);
    setCurrentPod(pod);
    setPodTerminalContainers(containers);
    setPodTerminalVisible(true);
  }, []);
  
  /**
   * 将后端返回的 Service 数据统一转换为表格行
   * - 端口字段拼接为 "port:targetPort/protocol"
   * - 外部 IP 从 status.loadBalancer.ingress 提取
   */
  const dataSource = useMemo(() => {
    return (services || []).map((s: any, index: number) => {
      const raw = s.rawData || s;
      const ports = (raw.spec?.ports || []).map((p: any) => `${p.port}:${p.targetPort}/${p.protocol}`).join(', ');
      const externalIPs = (raw.status?.loadBalancer?.ingress || []).map((i: any) => i.ip || i.hostname).join(', ');
      const name = raw.metadata?.name || s.name;
      const namespace = raw.metadata?.namespace || s.namespace;
      const uid = raw.metadata?.uid || s.id;
      const stableId = uid || ((namespace || name) ? `${namespace || ''}/${name || ''}` : '');

      return {
        key: stableId || `service_${index}`,
        name,
        namespace,
        type: raw.spec?.type || '-',
        clusterIP: raw.spec?.clusterIP || '-',
        externalIPs: externalIPs || '-',
        ports: ports || '-',
        creationTimestamp: raw.metadata?.creationTimestamp || s.createdAt,
        raw,
        originalRecord: s, // 保留原始数据库记录
      };
    });
  }, [services]);

  /**
   * 前端过滤逻辑
   * - 关键字：匹配名称/命名空间
   * - 类型：匹配 Service.spec.type
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (isTenant) {
      d = d.filter((x: any) => !isPublicNamespace(x.namespace));
    }
    if (nsValue) {
      d = d.filter((x: any) => x.namespace === nsValue);
    }
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    if (typeFilter) {
      d = d.filter((x: any) => x.type === typeFilter);
    }
    return d;
  }, [dataSource, keyword, typeFilter, nsValue, isTenant, isPublicNamespace]);

  // 根据当前数据自动生成类型过滤选项（包含 All）
  const serviceTypes = useMemo(() => {
    const types = new Set(dataSource.map((d: any) => d.type).filter((t: string) => t !== '-'));
    return ['All', ...Array.from(types)];
  }, [dataSource]);

  /**
   * 表格列定义
   * - 名称列可点击打开 Service 详情抽屉，并支持别名编辑
   * - 类型列通过 std-badge 区分不同类型
   */
  const allColumns = useMemo(() => [
    { 
      title: '名称', 
      key: 'name',
      width: 180,
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.raw?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.name || '';
        const hasAlias = !!alias;
        
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a 
              onClick={() => { setSelectedRecord(record); setDrawerActiveTab('detail'); setDrawerOpen(true); }} 
              style={{ color: '#1890ff' }}
            >
              {hasAlias ? alias : id}
            </a>
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
      }
    },
    {
      title: 'ID',
      dataIndex: 'name',
      key: 'id',
      width: 200,
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace' },
    { 
      title: '类型', 
      dataIndex: 'type', 
      key: 'type', 
      render: (t: string) => {
        let badgeClass = 'std-badge-default';
        if (t === 'LoadBalancer') badgeClass = 'std-badge-success';
        else if (t === 'NodePort') badgeClass = 'std-badge-warning';
        else if (t === 'ClusterIP') badgeClass = 'std-badge-info';
        
        return (
          <span className={`std-badge ${badgeClass}`}>
            {t}
          </span>
        );
      } 
    },
    { title: 'Cluster IP', dataIndex: 'clusterIP', key: 'clusterIP' },
    { title: '外部 IP', dataIndex: 'externalIPs', key: 'externalIPs' },
    { title: '端口', dataIndex: 'ports', key: 'ports', ellipsis: true },
    { 
      title: '创建时间', 
      dataIndex: 'creationTimestamp', 
      key: 'creationTimestamp',
      render: formatTime,
      sorter: (a: any, b: any) => new Date(a?.creationTimestamp || 0).getTime() - new Date(b?.creationTimestamp || 0).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            ...(!isTenant ? [
              { key: 'opsinfo', label: '运维信息', onClick: () => {
                setSelectedRecord(record);
                setDrawerActiveTab('detail');
                setDrawerOpen(true);
              }},
              { key: 'edit', label: '编辑', onClick: () => handleEdit(record) },
              { key: 'yaml', label: 'YAML 编辑', onClick: () => handleYamlEdit(record) },
              { key: 'view_yaml', label: '查看 YAML', icon: <EyeOutlined />, onClick: () => handleViewYaml(record) },
              { 
                key: 'delete', 
                label: '删除', 
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: '确认删除',
                    content: `确定要删除 Service "${record.name}" 吗？`,
                    okText: '删除',
                    okType: 'danger',
                    cancelText: '取消',
                    onOk: () => handleDelete(record),
                  });
                }
              }
            ] : [])
          ]}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ], [isTenant, isStandardView, handleOpenAliasModal, handleViewYaml]);

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_services_table');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input 
            allowClear 
            placeholder="服务名/命名空间" 
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPagination(p=>({...p, current:1})); }}
            className="toolbar-search" 
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="筛选命名空间"
            value={nsValue || undefined}
            onChange={(v) => { onNsChange?.(v); setPagination((p) => ({ ...p, current: 1 })); }}
            options={(namespacesOptions || []).map((ns) => ({ label: ns, value: ns }))}
            className="toolbar-filter-sm"
          />
          <Select
            allowClear
            placeholder="服务类型"
            value={typeFilter || undefined}
            onChange={v => { setTypeFilter(v || ''); setPagination(p=>({...p, current:1})); }}
            options={serviceTypes.filter(t => t !== 'All').map(t => ({ label: t, value: t }))}
            className="toolbar-filter-sm"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setTypeFilter('');
              onNsChange?.(undefined);
              setPagination((p) => ({ ...p, current: 1 }));
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          {!isTenant && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalOpen(true)}
            >
              创建
            </Button>
          )}
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_services_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </div>
      }
    >
      <Table
        className={!isTenant ? "std-table" : "std-table no-border"}
        bordered={false}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey={(r) => r?.key || `${r?.namespace || ''}/${r?.name || ''}`}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}

      />
      
      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="Service"
        record={selectedRecord ? { ...selectedRecord.originalRecord, kind: 'Service', rawData: selectedRecord.raw } : null}
        cloudId={cloudId}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
        pods={pods}
        onViewPodDetail={handleViewPodDetail}
        onViewPodLog={handleViewPodLog}
        onOpenPodTerminal={handleOpenPodTerminal}
      />
      
      {/* 创建 Service 弹窗 */}
      <ServiceFormModal
        visible={createModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions || []}
        defaultNamespace={formDefaultNs}
        onSuccess={() => {
          setCreateModalOpen(false);
          onRefresh?.(true);
        }}
        onCancel={() => setCreateModalOpen(false)}
      />
      
      {/* 编辑 Service 弹窗 */}
      <ServiceFormModal
        visible={editModalOpen}
        cloudId={cloudId}
        namespacesOptions={namespacesOptions || []}
        editMode={true}
        initialData={editingRecord?.raw}
        onSuccess={() => {
          setEditModalOpen(false);
          setEditingRecord(null);
          onRefresh?.(true);
        }}
        onCancel={() => {
          setEditModalOpen(false);
          setEditingRecord(null);
        }}
      />
      
      {/* YAML 编辑弹窗 */}
      <YamlEditModal
        visible={yamlModalOpen}
        title={`YAML 编辑 - Service/${yamlEditingRecord?.namespace}/${yamlEditingRecord?.name}`}
        cloudId={cloudId}
        namespace={yamlEditingRecord?.namespace}
        name={yamlEditingRecord?.name}
        resourceType="service"
        onLoadYaml={loadServiceYaml}
        onSaveYaml={saveServiceYaml}
        onCancel={() => {
          setYamlModalOpen(false);
          setYamlEditingRecord(null);
        }}
        onSuccess={() => {
          setYamlModalOpen(false);
          setYamlEditingRecord(null);
          onRefresh?.(true);
        }}
      />
      
      {/* Pod 详情抽屉 */}
      <Drawer
        title={`Pod 详情: ${currentPod?.metadata?.name || ''}`}
        placement="right"
        width={700}
        open={podDetailVisible}
        onClose={() => {
          setPodDetailVisible(false);
          setCurrentPod(null);
          setPodEvents([]);
        }}
        extra={
          <Space>
            <Button icon={<FileTextOutlined />} onClick={() => {
              setPodDetailVisible(false);
              if (currentPod) handleViewPodLog(currentPod);
            }}>
              查看日志
            </Button>
            <Button icon={<CodeOutlined />} onClick={() => {
              setPodDetailVisible(false);
              if (currentPod) handleOpenPodTerminal(currentPod);
            }}>
              终端
            </Button>
          </Space>
        }
      >
        {currentPod && (
          <Tabs
            items={[
              {
                key: 'overview',
                label: '概览',
                children: (
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="名称">{currentPod.metadata?.name}</Descriptions.Item>
                    <Descriptions.Item label="命名空间">{currentPod.metadata?.namespace}</Descriptions.Item>
                    <Descriptions.Item label="状态">{renderPodStatus(currentPod)}</Descriptions.Item>
                    <Descriptions.Item label="节点">{currentPod.spec?.nodeName || '-'}</Descriptions.Item>
                    <Descriptions.Item label="IP">{currentPod.status?.podIP || '-'}</Descriptions.Item>
                    <Descriptions.Item label="运行时长">{calculateAge(currentPod.metadata?.creationTimestamp)}</Descriptions.Item>
                    <Descriptions.Item label="创建时间" span={2}>{formatTime(currentPod.metadata?.creationTimestamp)}</Descriptions.Item>
                    <Descriptions.Item label="标签" span={2}>
                      <Space size={4} wrap>
                        {Object.entries(currentPod.metadata?.labels || {}).map(([k, v]) => (
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
                    dataSource={(currentPod.spec?.containers || []).map((c: any, idx: number) => ({
                      ...c,
                      key: idx,
                      status: (currentPod.status?.containerStatuses || []).find((s: any) => s.name === c.name),
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
                    loading={podEventsLoading}
                    dataSource={podEvents.map((e: any, idx: number) => ({ ...e, key: idx }))}
                    columns={[
                      { 
                        title: '类型', 
                        dataIndex: 'type', 
                        width: 80,
                        render: (v: string) => <Tag color={v === 'Normal' ? 'blue' : 'red'}>{v || '-'}</Tag>,
                      },
                      { title: '原因', dataIndex: 'reason', width: 130 },
                      { title: '消息', dataIndex: 'message', ellipsis: true },
                      { title: '次数', dataIndex: 'count', width: 60, render: (v: number) => v || 1 },
                      { title: '时间', dataIndex: 'lastTimestamp', width: 160, render: formatTime },
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
                    value={JSON.stringify(currentPod, null, 2)}
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
      
      {/* Pod 日志抽屉 */}
      <Drawer
        title={`日志: ${currentPod?.metadata?.name || ''}`}
        placement="right"
        width={900}
        open={podLogVisible}
        onClose={() => {
          setPodLogVisible(false);
        }}
      >
        {currentPod && (
          <PodLogViewer
            cloudId={cloudId}
            namespace={currentPod.metadata?.namespace}
            podName={currentPod.metadata?.name}
            containers={podLogContainers}
            height="calc(100vh - 150px)"
          />
        )}
      </Drawer>
      
      {/* Pod 终端 */}
      {currentPod && (
        <PodTerminal
          visible={podTerminalVisible}
          cloudId={cloudId}
          namespace={currentPod.metadata?.namespace}
          podName={currentPod.metadata?.name}
          containers={podTerminalContainers}
          defaultContainer={podTerminalContainers[0]}
          onClose={() => {
            setPodTerminalVisible(false);
          }}
        />
      )}
      
      {/* 别名编辑弹窗 */}
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
      
      {/* YAML 查看弹窗（只读） */}
      <Modal
        title="YAML 查看"
        open={yamlViewModalVisible}
        onCancel={() => setYamlViewModalVisible(false)}
        footer={null}
        width={800}
      >
        <YamlEditor
          value={yamlViewContent}
          onChange={() => {}}
          maxHeight={500}
          readOnly
        />
      </Modal>
    </PageDetailSection>
  );
};

export default ServicesSection;
