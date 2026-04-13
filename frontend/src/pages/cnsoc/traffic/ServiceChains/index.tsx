import React, { useState, useEffect } from 'react';
import { Space, Tag, Modal, Form, Input, Select, Card, message, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import ReactFlow, {
  Controls,
  Background,
} from 'react-flow-renderer';
import 'react-flow-renderer/dist/style.css';
import PageContainer from '../../../../components/PageContainer';
import { fetchServiceChains, deleteServiceChain } from '../../../../services/trafficOrchestration';
import { fetchCsmPoolId, fetchCsmServiceChains, deleteCsmServiceChain } from '../../../../services/api';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

interface ServiceChainRow {
  id: string;
  name: string;
  clusterName: string;
  clusterId?: string;
  cloudId?: string;
  cloud_id?: string;
  type: 'serial' | 'bypass';
  status: 'active' | 'inactive';
  description: string;
  steeringMode?: string;
  securityServices?: string;
  protectionTargets?: string;
  tenant?: { name: string };
  organization?: { name: string };
}

const ServiceChains: React.FC = () => {
  const navigate = useNavigate();
  
  // Detail Modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [currentChain, setCurrentChain] = useState<ServiceChainRow | null>(null);
  const [data, setData] = useState<ServiceChainRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Filter State
  const [filterForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, any>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await fetchServiceChains(filters);
      const normalize = (items: any[]) => {
        return items.map((r: any) => {
          const hasId = !!String(r?.id || '');
          const id = hasId ? String(r.id) : `demo-${Date.now()}`;
          const name = String(r?.name || '').trim() || `未命名服务链-${id}`;
          const clusterName = String(r?.clusterName || r?.clusterId || '').trim() || '-';
          const clusterId = r?.clusterId || r?.cloudId || r?.cloud_id || r?.cluster_id;
          const tenant = r?.tenant ? { id: r.tenant.id, name: (String(r.tenant.name || '').trim() || String(r.tenant.id || '').trim() || '-') } : undefined;
          const organization = r?.organization ? { id: r.organization.id, name: (String(r.organization.name || '').trim() || String(r.organization.id || '').trim() || '-') } : undefined;
          return { ...r, id, name, clusterName, clusterId, tenant, organization };
        });
      };
      const listNorm = normalize(Array.isArray(list) ? list : []);
      const applyFilters = (items: any[]) => {
        const kw = String(filters?.keyword || '').trim();
        const cl = String(filters?.cluster || '').trim();
        const tp = String(filters?.type || '').trim();
        const st = String(filters?.status || '').trim();
        return items.filter((r: any) => {
          if (kw && !String(r?.name || '').toLowerCase().includes(kw.toLowerCase())) return false;
          if (cl && String(r?.clusterName || '') !== cl) return false;
          if (tp && String(r?.type || '') !== tp) return false;
          if (st && String(r?.status || '') !== st) return false;
          return true;
        });
      };
      const sorted = [...applyFilters(listNorm)].sort((a: any, b: any) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
      setData(sorted);
    } catch (e) {
      console.error(e);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters]);

  const tryDeleteCsmChain = async (record: ServiceChainRow) => {
    const cloudId = record.clusterId || record.cloudId || record.cloud_id;
    if (!cloudId) {
      console.warn('Skipping CSM delete: Missing cloudId for record', record);
      return;
    }

    try {
      const poolRes = await fetchCsmPoolId(cloudId);
      const poolId = poolRes?.data?.pool_id;
      if (!poolId) return;

      const res = await fetchCsmServiceChains(cloudId, { pool_id: poolId });
      const items = Array.isArray(res?.data?.items) ? res.data.items : 
                    Array.isArray(res?.items) ? res.items : 
                    Array.isArray(res) ? res : [];
      
      const target = items.find((item: any) => String(item.name || item.chain_name || '').trim() === record.name);
      
      if (target) {
        const chainId = target.id || target.chain_id || target.service_chain_id;
        if (chainId) {
          await deleteCsmServiceChain(cloudId, chainId, { pool_id: poolId });
          message.success(`已关联删除 CSM 服务链: ${record.name}`);
        }
      }
    } catch (e) {
      console.warn('关联删除 CSM 服务链失败', e);
    }
  };

  const handleBatchDelete = async () => {
    const ids = selectedRowKeys.map(k => String(k));
    if (ids.length === 0) {
      message.warning('请选择要删除的记录');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `将删除 ${ids.length} 条服务链，是否继续？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const recordsToDelete = data.filter(r => ids.includes(r.id));
          await Promise.allSettled(recordsToDelete.map(r => tryDeleteCsmChain(r)));
          await Promise.allSettled(ids.map(id => deleteServiceChain(id)));
          message.success('删除完成');
          setSelectedRowKeys([]);
          loadData();
        } catch (e) {
          message.error('删除失败');
        }
      },
    });
  };

  const columns = [
    { title: '服务链名称/ID', dataIndex: 'name', key: 'name', render: (text: string, record: ServiceChainRow) => (
      <div>
        <div>{text}</div>
        <div style={{ fontSize: 12, color: '#999' }}>{record.id}</div>
      </div>
    )},
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <Tag color={status === 'active' ? 'success' : 'default'}>{status === 'active' ? '已激活' : '未激活'}</Tag>,
    },
    { title: '防护目标', dataIndex: 'protectionTargets', key: 'protectionTargets', render: (val: any, record: any) => {
        let text = '';
        try {
          const obj = typeof val === 'string' ? JSON.parse(val) : val;
          if (obj && obj.mode === 'vr') {
            const list = Array.isArray(obj.objects) ? obj.objects : [];
            text = list.map((o: any) => {
              const name = o.name || o.id || '-';
              const cidr = o.cidr || '';
              return cidr ? `${name}(${cidr})` : name;
            }).join(', ');
          } else if (obj && obj.mode === 'direct') {
            const list = Array.isArray(obj.objects) ? obj.objects : [];
            text = list.join(', ');
          } else {
            text = typeof val === 'string' ? val : '';
          }
        } catch {
          text = typeof val === 'string' ? val : '';
        }
        return <div style={{maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}} title={text}>{text || '-'}</div>;
    }},
    { title: '引流方式', dataIndex: 'steeringMode', key: 'steeringMode', render: (val: string) => val === 'vr' ? 'VR引流' : (val === 'direct' ? '直连引流' : val || '-') },
    { title: '包含安全服务', dataIndex: 'securityServices', key: 'securityServices', render: (val: any) => {
        return <div style={{maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}} title={val}>{val || '-'}</div>;
    }},
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag color={type === 'serial' ? 'blue' : 'cyan'}>{type === 'serial' ? '串行' : '旁路'}</Tag>,
    },
    { title: '所属资源池', dataIndex: 'clusterName', key: 'clusterName' },
    { title: '所属租户/组织', key: 'tenantOrg', render: (_: any, record: ServiceChainRow) => (
        <span>
            {record.tenant?.name || '-'}/{record.organization?.name || '-'}
        </span>
    )},
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[
            { key: 'detail', label: '详情' },
            { key: 'edit', label: '编辑' },
            { key: 'delete', label: <span style={{ color: 'red' }}>删除</span> }
          ]}
          onClick={async ({ key }) => {
            if (key === 'detail') {
              setCurrentChain(record);
              setDetailOpen(true);
            } else if (key === 'edit') {
            } else if (key === 'delete') {
              try {
                await tryDeleteCsmChain(record);
                await deleteServiceChain(record.id);
                message.success('删除成功');
                loadData();
              } catch (e) {
                message.error('删除失败');
              }
            }
          }}
        />
      ),
    },
  ];

  // Detail Topology (Read-only view for now, using static nodes)
  const detailNodes = [
      { id: 'd-in', type: 'input', data: { label: 'Traffic In' }, position: { x: 50, y: 100 } },
      { id: 'd-1', data: { label: 'WAF' }, position: { x: 200, y: 100 } },
      { id: 'd-2', data: { label: 'IPS' }, position: { x: 350, y: 100 } },
      { id: 'd-out', type: 'output', data: { label: 'Traffic Out' }, position: { x: 500, y: 100 } },
  ];
  const detailEdges = [
      { id: 'e1', source: 'd-in', target: 'd-1' },
      { id: 'e2', source: 'd-1', target: 'd-2' },
      { id: 'e3', source: 'd-2', target: 'd-out' },
  ];

  return (
    <PageContainer
      toolbarLeft={
        <Form
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, allValues) => setFilters(allValues)}
        >
          <Form.Item name="keyword" label="关键字" style={{ marginBottom: 0 }}>
            <Input placeholder="搜索服务链名称" style={{ width: 200 }} allowClear />
          </Form.Item>
          <Form.Item name="cluster" label="所属集群" style={{ marginBottom: 0 }}>
            <Select placeholder="所属集群" style={{ width: 150 }} allowClear>
              {Array.from(new Set((data || []).map((r:any)=> String(r?.clusterName || '').trim()).filter(Boolean))).map((name) => (
                <Select.Option key={name} value={name}>{name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="type" label="类型" style={{ marginBottom: 0 }}>
            <Select placeholder="类型" style={{ width: 120 }} allowClear>
              <Select.Option value="serial">串行</Select.Option>
              <Select.Option value="bypass">旁路</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginBottom: 0 }}>
            <Select placeholder="状态" style={{ width: 120 }} allowClear>
              <Select.Option value="active">已激活</Select.Option>
              <Select.Option value="inactive">未激活</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      }
      primaryAction={{
        text: '创建服务链',
        onClick: () => navigate('/admin/security/traffic/service-chains/create'),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新', onClick: loadData },
        { key: 'batch-delete', label: <span style={{ color: 'red' }}>批量删除</span>, danger: true, disabled: selectedRowKeys.length === 0, onClick: handleBatchDelete },
      ]}
      defaultHiddenColumns={[]}
      tableProps={{
        columns,
        dataSource: data,
        loading,
        rowKey: "id",
        rowSelection: {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        },
      }}
    >
      {/* Detail Modal with Topology */}
      <Modal
        open={detailOpen}
        title={`服务链详情: ${currentChain?.name}`}
        width={900}
        onCancel={() => setDetailOpen(false)}
        footer={null}
      >
        <Card title="拓扑视图" variant="borderless">
          <div style={{ height: 400, border: '1px solid #f0f0f0', background: '#f5f5f5' }}>
             <ReactFlow
                nodes={detailNodes}
                edges={detailEdges}
                fitView
                elementsSelectable={false}
             >
                 <Background color="#aaa" gap={16} />
                 <Controls showInteractive={false} />
             </ReactFlow>
          </div>
        </Card>
      </Modal>
    </PageContainer>
  );
};

export default ServiceChains;
