/**
 * ==============================================================================
 * 模块名称: 云资源列表 (Cloud Resource List)
 * 文件路径: src/pages/Clouds/index.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 展示系统中已接入的所有云资源（公有云、私有云、虚拟化平台等）。
 * 提供资源概览统计（VM数量、VPC数量）、列表展示、搜索过滤以及接入向导入口。
 * 
 * [核心逻辑]
 * 1. [资源加载]: 
 *    - 初始化加载所有云资源列表。
 *    - 并行加载每个云平台的 VPC 统计信息。
 * 2. [数据统计]: 
 *    - 计算全局 VM 在线/离线状态。
 *    - 计算全局 VPC 在线/离线状态 (区分 Harvester 和标准 Cloud Provider)。
 * 3. [交互操作]: 
 *    - 支持按关键字、状态、类型、厂商进行多维过滤。
 *    - 提供连接测试功能。
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明 (Dependencies & Interactions)]
 * ------------------------------------------------------------------------------
 * 1. 涉及接口:
 *    - GET /api/clouds (资源列表)
 *    - GET /api/harvester/clusters/:id/vpcs (Harvester VPC)
 *    - GET /api/clouds/:id/vpcs (通用 VPC)
 *    - POST /api/clouds/:id/test (连接测试)
 * 
 * 2. 关键组件:
 *    - CloudWizard (资源接入向导)
 *    - MetricCard (统计卡片)
 * ==============================================================================
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Card, Row, Col, Button, Tag, Modal, Form, Input, Select,
  message, Space, Typography, Dropdown, Badge, Table, MenuProps
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { 
  EllipsisOutlined,
  ReloadOutlined,
  SyncOutlined
} from '@ant-design/icons';
import { fetchCloudProviderVpcs, fetchClouds as fetchCloudsApi, apiPost, apiDelete, apiRequest } from '../../services/api';
import { fetchKubeOvnVpcs } from '../../services/harvesterApi';
import { 
  getProviderLogo, getProviderName, cloudProviders,
  CLOUD_TYPE_MAP, CLOUD_STATUS_MAP, getCredentialLabels,
  Cloud, ComputeResource
} from './providers';
import PageContainer from '../../components/PageContainer';
import { useTableColumnSettings } from '../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../components/TableColumnSettingsButton';

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import CloudWizard from './CloudWizard';
import CloudEditModal from './Harvester/modals/CloudEditModal';
 

// ============================================================================
// [功能块: 统计卡片组件]
// 检索关键词: MetricCard 统计卡片 数据展示卡片 进度条卡片
// ============================================================================
const MetricCard:React.FC<{title:string;total:number;unit?:string;used:number;midLabel:string;midValue:number;mainColor:string;usedLabel?:string}> = ({title,total,unit='',used,midLabel,midValue,mainColor,usedLabel})=>{
  const remain = Math.max(total-used-midValue,0);
  const percent = total? used/total*100:0;
  const trail='#d8dee8';
  return (
    <Card styles={{ body: { padding:12 } }} style={{ borderRadius:6, border: '1px solid #1677ff' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontWeight:600, fontSize:13 }}>{title}</span>
        <span style={{ color:'#8c8c8c', fontSize:12 }}>总{unit} {total}{unit}</span>
      </div>
      <div style={{ height:8, background:trail, borderRadius:4, overflow:'hidden', marginBottom:8 }}>
        <div style={{ width:`${percent}%`, height:'100%', background:mainColor }} />
      </div>
      <div style={{ display:'flex' }}>
        {[ 
          {label:usedLabel || '已用',value:used,color:mainColor},
          {label:midLabel,value:midValue,color:'#8c8c8c'},
          ...(remain>0? [{label:'剩余',value:remain,color:'#8c8c8c'}]:[])
        ].map((m,i,arr)=>(
          <div key={i} style={{ flex:1, padding:'8px 12px', background:'#fff', borderRight:i< arr.length-1?'1px solid #f0f0f0':'none' }}>
            <div style={{ display:'flex', alignItems:'center', gap:3, fontSize:12, marginBottom:2 }}>
              <span style={{ width:8, height:8, background:m.color, borderRadius:2 }} /> {m.label}
            </div>
            <div style={{ fontSize:24, fontWeight:700, color:'#1f1f1f', lineHeight:1 }}>{m.value}{unit && <span style={{ fontSize:12, color:'#8c8c8c', marginLeft:3 }}>{unit}</span>}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const { Text } = Typography;

// ============================================================================
// [功能块: 云资源列表主组件]
// 检索关键词: Clouds组件 状态管理 权限检查
// ============================================================================
const Clouds: React.FC = () => {
  const navigate = useNavigate();
  
  // [状态管理] 云资源数据与UI状态
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingCloud, setEditingCloud] = useState<Cloud | null>(null);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [vmStats, setVmStats] = useState<{ total: number; online: number; offline: number }>({ total: 0, online: 0, offline: 0 });
  const [vpcStats, setVpcStats] = useState<{ total: number; online: number; offline: number }>({ total: 0, online: 0, offline: 0 });
  
  // [状态管理] 筛选表单与过滤条件
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]|undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string[]|undefined>(undefined);
  const [vendorFilter, setVendorFilter] = useState<string|undefined>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  
  // [权限管理] 用户权限检查
  const { user } = useAuth();
  const hasAdminPermission = user?.role === 'super_admin';

  

  // ============================================================================
  // [功能块: 初始化数据加载]
  // 检索关键词: 初始化 useEffect fetchClouds
  // ============================================================================
  useEffect(() => {
    fetchClouds();
  }, []);

  // ============================================================================
  // [功能块: VM统计数据计算]
  // 检索关键词: VM统计 vmStats 虚拟机数量统计
  // ============================================================================
  useEffect(() => {
    // [数据统计] VM 状态汇总
    // 基于后端返回的 cached 字段 (vmCount, runningVmCount) 进行前端聚合。
    // 1. 遍历所有云资源，累加 total 和 online 数量。
    // 2. 计算 offline = total - online。
    // 注意：避免前端逐个请求详情接口，以提高性能。
    const loadVmStats = () => {
      let total = 0;
      let online = 0;
      (clouds || []).forEach((c: any) => {
        total += Number(c.vmCount || 0);
        online += Number(c.runningVmCount || 0);
      });
      setVmStats({ total, online, offline: Math.max(0, total - online) });
    };
    loadVmStats();
  }, [clouds]);

  // ============================================================================
  // [功能块: VPC统计数据异步加载]
  // 检索关键词: VPC统计 vpcStats 网络统计 Harvester Kube-OVN
  // ============================================================================
  useEffect(() => {
    // [数据统计] VPC 状态异步加载
    // 由于后端列表接口未返回 VPC 详情，需要根据 Provider 类型并行请求。
    // 1. 区分 Harvester (Kube-OVN) 和常规 Cloud Provider (VPC API)。
    // 2. 统一标准化状态字段 (Status/status -> normalized)。
    // 3. 聚合计算总数和在线数。
    // 注意：Promise.allSettled 模式处理部分请求失败的情况 (代码中使用 try-catch 模拟)。
    const loadVpcStats = async () => {
      try {
        const ids = (clouds || []).map(c => c.id);
        // 使用 Promise.allSettled 确保单个云平台连接失败不会阻塞其他
        const results = await Promise.allSettled(ids.map(async id => {
          try {
            const prov = String((clouds.find(c => c.id === id)?.config?.provider) || '').toLowerCase();
            if (prov === 'harvester') {
              const json: any = await fetchKubeOvnVpcs(id);
              const list: any[] = Array.isArray(json?.data?.items) ? json.data.items : Array.isArray(json?.items) ? json.items : [];
              return Array.isArray(list) ? list : [];
            }
            const json: any = await fetchCloudProviderVpcs(id);
            const list: any[] = json?.data?.Vpcs?.Vpc || json?.data?.vpcs || json?.vpcs || [];
            return Array.isArray(list) ? list : [];
          } catch (e) {
            console.warn(`Failed to load VPC stats for cloud ${id}:`, e);
            return [];
          }
        }));
        // 提取成功的结果
        const successfulResults = results
          .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
          .map(r => r.value);
        const flat = successfulResults.flat();
        const total = flat.length;
        const online = flat.filter(r => {
          const s = r?.Status || r?.status;
          // [Fix] Kube-OVN VPC status is an object (e.g. { router: '...', subnets: [...] })
          // If it has a status object with content, we consider it Ready/Online.
          if (s && typeof s === 'object') return true;
          const str = String(s || '').toLowerCase();
          return ['available','active','ok','running','enabled','ready'].includes(str);
        }).length;
        setVpcStats({ total, online, offline: Math.max(0, total - online) });
      } catch {
        setVpcStats({ total: 0, online: 0, offline: 0 });
      }
    };
    if (clouds.length > 0) loadVpcStats();
  }, [clouds]);

  // ============================================================================
  // [功能块: 云资源列表数据获取]
  // 检索关键词: fetchClouds 获取云资源列表 API调用
  // ============================================================================
  // [核心逻辑] 资源列表加载
  // 1. 调用后端 API 获取所有云资源。
  // 2. 处理 loading 状态。
  // 3. 异常处理：显示错误提示。
  const fetchClouds = useCallback(async (skipCache: boolean = false) => {
    setLoading(true);
    try {
      // fetchCloudsApi 内部使用 apiRequest，需要传递 skipCache 选项
      const response = skipCache 
        ? await apiRequest('/api/clouds', { skipCache: true })
        : await fetchCloudsApi();
      setClouds(Array.isArray(response) ? response : (response?.data || []));
    } catch (error: any) {
      message.error('获取云资源列表失败：' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  }, []);

  // 已移除算力配额相关方法

  // ============================================================================
  // [功能块: 连接测试功能]
  // 检索关键词: testConnection 连接测试 测试云资源连接
  // ============================================================================
  const testConnection = useCallback(async (cloudId: string) => {
    setTestingConnection(cloudId);
    try {
      const response = await apiPost(`/api/clouds/${cloudId}/test`, {});
      message.success(response.message || '连接测试成功');
      fetchClouds(true); // 强制刷新列表以更新状态，跳过缓存
    } catch (error: any) {
      message.error('连接测试失败：' + (error?.message || '未知错误'));
    } finally {
      setTestingConnection(null);
    }
  }, [fetchClouds]);

  // ============================================================================
  // [功能块: 工具函数 - 状态和类型文本映射]
  // 检索关键词: getStatusText getTypeText 状态映射 类型映射
  // ============================================================================
  const getStatusText = (status: string) => CLOUD_STATUS_MAP[status] || '未知';
  const getTypeText = (type: string) => CLOUD_TYPE_MAP[type] || '未知';

  // 编辑模态框样式：分组标题与表单标签/输入字号
  // 样式已迁移至 global-new.css

  // ============================================================================
  // [功能块: 编辑云资源]
  // 检索关键词: handleEdit 编辑云资源 编辑模态框
  // ============================================================================
  const handleEdit = useCallback((cloud: Cloud) => {
    if (!hasAdminPermission) {
      message.error('权限不足，只有超级管理员可以编辑云资源');
      return;
    }
    setEditingCloud(cloud);
    setEditModalVisible(true);
  }, [hasAdminPermission]);

  // ============================================================================
  // [功能块: 删除云资源]
  // 检索关键词: handleDelete 删除云资源 删除确认
  // ============================================================================
  // [核心逻辑] 资源删除
  // 1. 权限校验 (isAdmin)。
  // 2. 二次确认 (Confirm Modal)。
  // 3. 执行删除并刷新列表。
  const handleDelete = useCallback((cloudId: string) => {
    if (!hasAdminPermission) {
      message.error('权限不足，只有超级管理员可以删除云资源');
      return;
    }
    
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个云资源吗？如果有关联的计算资源，将无法删除。',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await apiDelete(`/api/clouds/${cloudId}`);
          message.success('云资源删除成功');
          fetchClouds(true); // 强制刷新，跳过缓存
        } catch (error: any) {
          message.error('删除失败：' + (error?.message || '未知错误'));
        }
      },
    });
  }, [hasAdminPermission, fetchClouds]);

  // ============================================================================
  // [功能块: 表格列定义]
  // 检索关键词: tableColumns 表格列 列配置 表格渲染
  // ============================================================================
  const tableColumns: ColumnsType<Cloud> = useMemo(() => [
    {
      title: '云平台',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      fixed:'left' as 'left',
      render: (text: string, record: Cloud) => (
        <Button 
          type="link" 
          onClick={() => navigate(`/admin/clouds/${record.id}`)}
          style={{ padding: 0, height: 'auto' }}
        >
          {record.name}
        </Button>
      )
    },

    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Badge
          status={status==='online' ? 'success' : status==='offline' ? 'error' : 'warning'}
          text={getStatusText(status)}
        />
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag color="blue">{getTypeText(type)}</Tag>
    },
    {
      title: '厂商',
      dataIndex: 'config',
      key: 'provider',
      render: (config: any, record: Cloud) => {
        const providerName = getProviderName(config?.provider);
        const logo = getProviderLogo(config?.provider, record.type);
        return (
          <Space>
            <span style={{ fontSize: 16, display: 'flex', alignItems: 'center' }}>{logo}</span>
            <Text>{providerName}</Text>
          </Space>
        );
      }
    },
    {
      title: '地域',
      dataIndex: 'region',
      key: 'region',
      render: (region: string) => <Text>{region || '-'}</Text>
    },
    {
      title: '端点',
      dataIndex: 'endpoint',
      key: 'endpoint',
      render: (endpoint: string) => <Text type="secondary">{endpoint || '-'}</Text>
    },
    

    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as 'right',
      align: 'center' as 'center',
      render: (record: Cloud) => {
        const items = [
          { key: 'detail', label: '资源详情' },
          { key: 'edit', label: '编辑信息', disabled: !hasAdminPermission },
          { key: 'test', label: '连接测试', disabled: !hasAdminPermission || testingConnection===record.id },
          { type: 'divider' as const },
          { key: 'del', label: '删除', danger: true, disabled: !hasAdminPermission },
        ];
        const onMenuClick = ({ key }: { key: string }) => {
          if (key === 'test') return testConnection(record.id);
          if (key === 'detail') return navigate(`/admin/clouds/${record.id}`);
          if (key === 'edit') return handleEdit(record);
          if (key === 'del') return handleDelete(record.id);
        };
        return (
          <Dropdown menu={{ items, onClick: onMenuClick }} trigger={["click"]}>
            <Button type="text" icon={<EllipsisOutlined />} className="row-actions-trigger" />
          </Dropdown>
        );
      }
    }
  ], [navigate, hasAdminPermission, testingConnection, testConnection, handleEdit, handleDelete]);

  // ============================================================================
  // [功能块: 表格列设置管理]
  // 检索关键词: useTableColumnSettings 列设置 列显示控制
  // ============================================================================
  // 使用新的 hook 管理列设置
  const { displayColumns: activeColumns } = useTableColumnSettings(tableColumns, 'clouds-list');

  // ============================================================================
  // [功能块: 数据过滤逻辑]
  // 检索关键词: filteredClouds 过滤 筛选 关键字过滤 状态过滤 类型过滤 厂商过滤
  // ============================================================================
  // 过滤后的云资源池
  const filteredClouds = (clouds || []).filter(c=>{
    if(keyword && !c.name.toLowerCase().includes(keyword.toLowerCase())) return false;
    if(statusFilter && statusFilter.length && !statusFilter.includes(c.status)) return false;
    if(typeFilter && typeFilter.length && !typeFilter.includes(c.type)) return false;
    if(vendorFilter) {
      const prov = (c.config?.provider || '').toLowerCase();
      if (prov !== vendorFilter) return false;
    }
    return true;
  });

  // ============================================================================
  // [功能块: 统计数据计算]
  // 检索关键词: 统计数据 totalCnt onlineCnt 资源池统计 容器统计
  // ============================================================================
  // 统计数据
  const totalCnt = clouds.length;
  const onlineCnt = clouds.filter(c=>c.status==='online').length;
  const offlineCnt = totalCnt - onlineCnt;
  // 资源类型统计（在线/离线）
  const containerCounts = (() => {
    const all = clouds.flatMap(c => c.computeResources || []);
    const list = all.filter(r => r.type === 'container');
    const total = list.length;
    const online = list.filter(r => String(r?.status || '').toLowerCase() === 'running').length;
    return { total, online, offline: Math.max(0, total - online) };
  })();
  const vmCounts = vmStats;
  const vpcCounts = vpcStats;

  // ============================================================================
  // [功能块: 筛选表单变更处理]
  // 检索关键词: handleFilterChange 筛选变更 表单变更
  // ============================================================================
  const handleFilterChange = (_: any, all: any) => {
    setKeyword(all.keyword || '');
    setStatusFilter(all.status ? [all.status] : undefined);
    setTypeFilter(all.category ? [all.category] : undefined);
    setVendorFilter(all.vendor ? all.vendor : undefined);
  };

  // ============================================================================
  // [功能块: 批量删除云资源]
  // 检索关键词: handleBulkDelete 批量删除 批量操作
  // ============================================================================
  const handleBulkDelete = useCallback(async () => {
    if (!hasAdminPermission) { message.error('权限不足，只有超级管理员可以删除云资源'); return; }
    Modal.confirm({
      title: '确认批量删除',
      content: `将删除选中的 ${selectedRowKeys.length} 个资源池，操作不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          let ok = 0, fail = 0;
          for (const id of selectedRowKeys) {
            try {
              await apiDelete(`/api/clouds/${id}`);
              ok++;
            } catch {
              fail++;
            }
          }
          message.success(`删除成功 ${ok} 个，失败 ${fail} 个`);
          setSelectedRowKeys([]);
          fetchClouds();
        } catch (e: any) {
          message.error('批量删除失败');
        }
      }
    });
  }, [hasAdminPermission, selectedRowKeys, fetchClouds]);

  // ============================================================================
  // [功能块: 批量操作菜单配置]
  // 检索关键词: bulkActionsMenu 批量操作菜单 下拉菜单
  // ============================================================================
  const bulkActionsMenu: MenuProps = {
    items: [
      { key: 'bulkDelete', label: '批量删除', danger: true, disabled: !hasAdminPermission || selectedRowKeys.length === 0, onClick: handleBulkDelete }
    ]
  };

  // ============================================================================
  // [功能块: 页面渲染]
  // 检索关键词: return 渲染 PageContainer 统计卡片 表格 工具栏
  // ============================================================================
  return (
    <PageContainer
      titleLevel={3}
      collapsibleChildren={(
        <Row gutter={[12,12]} style={{ marginBottom:16 }}>
          <Col xs={24} sm={12} md={6}><MetricCard title="资源池数量" total={totalCnt} unit="个" used={onlineCnt} midLabel="离线" midValue={offlineCnt} usedLabel="在线" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="云主机数量" total={vmCounts.total} unit="个" used={vmCounts.online} midLabel="离线" midValue={vmCounts.offline} usedLabel="在线" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="容器集群数量" total={containerCounts.total} unit="个" used={containerCounts.online} midLabel="离线" midValue={containerCounts.offline} usedLabel="在线" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="VPC 网络数量" total={vpcCounts.total} unit="个" used={vpcCounts.online} midLabel="未就绪" midValue={vpcCounts.offline} usedLabel="就绪" mainColor="#1677ff" /></Col>
        </Row>
      )}
      asCard={false}
      toolbarLeft={(
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="vertical"
          onValuesChange={handleFilterChange}
        >
          <Form.Item name="keyword">
            <Input className="toolbar-search" allowClear placeholder="关键字" onChange={(e) => setKeyword(e.target.value)} />
          </Form.Item>
          <Form.Item name="vendor">
            <Select className="toolbar-filter-sm" allowClear placeholder="供应商">
              {cloudProviders.map(p => (
                <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="status">
            <Select className="toolbar-filter-sm" allowClear placeholder="状态">
              {Object.entries(CLOUD_STATUS_MAP).map(([key, label]) => (
                <Select.Option key={key} value={key}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="category">
            <Select className="toolbar-filter-sm" allowClear placeholder="类型">
              {Object.entries(CLOUD_TYPE_MAP).map(([key, label]) => (
                <Select.Option key={key} value={key}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item>
            <a className="toolbar-reset-btn" onClick={()=>{ filterForm.resetFields(); setKeyword(''); setStatusFilter(undefined); setTypeFilter(undefined); setVendorFilter(undefined); }}>重置</a>
          </Form.Item>
        </Form>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => setWizardVisible(true)}>新增资源池</Button>
          <Dropdown menu={bulkActionsMenu}>
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <TableColumnSettingsButton allColumns={tableColumns} settingsKey="clouds-list" />
          <Button icon={<ReloadOutlined />} onClick={() => fetchClouds(true)} />
        </div>
      )}
      actionsSize="middle"
    >
      <Table
        className="std-table"
        bordered
        columns={activeColumns}
        dataSource={filteredClouds}
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
        }}
        pagination={{
          size: 'small',
          showSizeChanger: true,
          pageSize: 10,
          pageSizeOptions: ['10', '20', '50', '100'],
          showQuickJumper: false
        }}
        scroll={{ x: 'max-content' }}
        tableLayout="auto"
      />

      {/* 多云接入向导 */}
      <CloudWizard
        visible={wizardVisible}
        onCancel={() => setWizardVisible(false)}
        onSuccess={() => fetchClouds(true)}
      />

      {/* 编辑云资源模态框（随云厂商动态） */}
      <CloudEditModal
        visible={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingCloud(null);
        }}
        onSuccess={() => {
          setEditModalVisible(false);
          setEditingCloud(null);
          fetchClouds(true);
        }}
        cloud={editingCloud}
      />


      
    </PageContainer>
  );
};

export default Clouds;
