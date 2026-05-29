import React, { useEffect, useMemo, useState } from 'react';
import { Button, Divider, Form, Input, Select, Space, Tag, Modal, Row, Col, message, Steps, Descriptions, Badge } from 'antd';
import type { MenuProps } from 'antd';
import { ClusterOutlined, BranchesOutlined, RadarChartOutlined, SafetyCertificateOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import type { ColumnsType } from 'antd/es/table';
import { apiPost } from '../../../../services/api';
// 复用 VR 页的样式（page-toolbar / toolbar-container / toolbar-actions / vr-table）

interface Srv6TunnelRow {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  status: 'creating' | 'available';
  createdAt: string;
}

// 健康巡检步骤类型定义，兼容 antd Steps 的状态枚举
type HealthStatus = 'wait' | 'process' | 'finish' | 'error';
interface HealthStep {
  key: string;
  title: string;
  status: HealthStatus;
  description?: string;
}

const SRv6Page: React.FC = () => {
  const navigate = useNavigate();
  const [tunnels, setTunnels] = useState<Srv6TunnelRow[]>([]);

  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[] | undefined>();

  // 列表页不再展示拓扑节点

  // 健康巡检弹窗状态
  const [healthModalOpen, setHealthModalOpen] = useState(false);
  const [healthRow, setHealthRow] = useState<Srv6TunnelRow | null>(null);
  const initialHealthSteps: HealthStep[] = [
    { key: 'bgp', title: 'BGP 公网邻居配置检查', status: 'wait', description: '' },
    { key: 'srv6', title: 'SRv6 私网路由迭代配置检查', status: 'wait', description: '' },
    { key: 'ceReach', title: 'CE 可达性检查', status: 'wait', description: '' },
    { key: 'ipsec', title: 'CE IPsec 隧道配置检查', status: 'wait', description: '' },
  ];
  const [healthSteps, setHealthSteps] = useState<HealthStep[]>(initialHealthSteps);

  const getActionMenu = (_row: Srv6TunnelRow): MenuProps['items'] => ([
    { key: 'topology', label: '查看拓扑' },
    { key: 'update', label: '更新SRv6配置' },
    { key: 'health', label: '健康巡检' },
    { type: 'divider' },
    { key: 'delete', label: '删除隧道', danger: true },
  ]);

  const handleRowActionClick = (row: Srv6TunnelRow): MenuProps['onClick'] => ({ key }) => {
    switch (key) {
      case 'topology':
        message.info(`查看拓扑占位：${row.name}`);
        break;
      case 'update':
        navigate(`/admin/interconnect/srv6/create?editId=${encodeURIComponent(row.id)}`);
        break;
      case 'health':
        setHealthRow(row);
        setHealthSteps(initialHealthSteps);
        setHealthModalOpen(true);
        break;
      case 'delete':
        Modal.confirm({
          title: '确认删除该隧道？',
          content: `确定删除：${row.name}`,
          okText: '删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: async () => {
            try {
              const { deleteSrv6Tunnel } = await import('../../../../services/api');
              await deleteSrv6Tunnel(row.id);
              message.success('隧道已删除');
              // 刷新列表
              const { fetchSrv6Tunnels } = await import('../../../../services/api');
              const list = await fetchSrv6Tunnels();
              const rows: Srv6TunnelRow[] = (Array.isArray(list) ? list : []).map((it: any) => ({
                id: it.id,
                name: it.name,
                peA: it.peA,
                peB: it.peB,
                ceA: it.ceA,
                ceB: it.ceB,
                status: it.status,
                createdAt: it.createdAt,
              }));
              setTunnels(rows);
            } catch (e: any) {
              message.error(`删除失败：${e?.message || '请稍后重试'}`);
            }
          },
        });
        break;
      default:
        break;
    }
  };

  // 初始列
  const fullColumns: ColumnsType<Srv6TunnelRow> = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'PE-A', dataIndex: 'peA', key: 'peA' },
    { title: 'PE-B', dataIndex: 'peB', key: 'peB' },
    { title: 'CE-A', dataIndex: 'ceA', key: 'ceA' },
    { title: 'CE-B', dataIndex: 'ceB', key: 'ceB' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => (<Tag color={s === 'available' ? 'green' : 'blue'}>{s === 'available' ? '可用' : '创建中'}</Tag>) },
    { title: '创建时间', dataIndex: 'createdAt', key: 'time', render: (d: string) => new Date(d).toLocaleString() },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_: any, row: Srv6TunnelRow) => (
        <ResourceActionsDropdown
          items={getActionMenu(row)}
          onClick={handleRowActionClick(row) as any}
          buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
        />
      ),
    }
  ];

  const columns = fullColumns;

  // 过滤后的隧道
  const filteredTunnels = useMemo(() => {
    return tunnels.filter((t) => {
      const nameLower = (t.name || '').toLowerCase();
      if (keyword && !nameLower.includes(keyword.toLowerCase())) return false;
      if (statusFilter && statusFilter.length && !statusFilter.includes(t.status)) return false;
      return true;
    });
  }, [tunnels, keyword, statusFilter]);

  const loadSrv6Tunnels = async (force?: boolean) => {
    try {
      const { fetchSrv6Tunnels } = await import('../../../../services/api');
      const list = await fetchSrv6Tunnels({ skipCache: !!force });
      const rows: Srv6TunnelRow[] = (Array.isArray(list) ? list : []).map((it: any) => ({
        id: it.id,
        name: it.name,
        peA: it.peA,
        peB: it.peB,
        ceA: it.ceA,
        ceB: it.ceB,
        status: it.status,
        createdAt: it.createdAt,
      }));
      setTunnels(rows);
    } catch (e: any) {
      console.error('加载 SRv6 隧道失败:', e);
      message.error(`加载 SRv6 隧道失败：${e?.message || '请稍后重试'}`);
      setTunnels([]);
    }
  };

  useEffect(() => {
    loadSrv6Tunnels();
  }, []);

  const forceRefresh = async () => {
    message.loading({ content: '正在同步 VR 与隧道数据...', key: 'srv6_refresh' });
    try {
      await apiPost('/api/vr-instances/refresh', {});
      await loadSrv6Tunnels(true);
      message.success({ content: '同步完成', key: 'srv6_refresh' });
    } catch {
      message.error({ content: '同步失败，请稍后重试', key: 'srv6_refresh' });
    }
  };

  // 开始健康巡检（占位逻辑：依次推进步骤状态）
  const startHealthCheck = () => {
    const stepsCopy: HealthStep[] = initialHealthSteps.map(s => ({ ...s }));
    setHealthSteps(stepsCopy);
    const runStep = (idx: number) => {
      if (idx >= stepsCopy.length) return;
      stepsCopy[idx].status = 'process';
      stepsCopy[idx].description = '检查进行中...';
      setHealthSteps([...stepsCopy]);
      setTimeout(() => {
        stepsCopy[idx].status = 'finish';
        stepsCopy[idx].description = '检查通过（占位）';
        setHealthSteps([...stepsCopy]);
        runStep(idx + 1);
      }, 800);
    };
    runStep(0);
  };

  const stepIconForKey = (key: string) => {
    switch (key) {
      case 'bgp':
        return <ClusterOutlined />;
      case 'srv6':
        return <BranchesOutlined />;
      case 'ceReach':
        return <RadarChartOutlined />;
      case 'ipsec':
        return <SafetyCertificateOutlined />;
      default:
        return undefined;
    }
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      primaryAction={{
        text: '创建SRv6隧道',
        onClick: () => navigate('/admin/interconnect/srv6/create'),
        type: 'primary',
      }}
      onRefresh={() => { void forceRefresh(); }}
      defaultHiddenColumns={[]} // Display all columns by default
      toolbarLeft={(
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status || undefined);
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="名称"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="status" style={{ marginBottom: 0 }}>
            <Select mode="multiple" allowClear placeholder="状态" className="toolbar-filter">
              <Select.Option value="creating">创建中</Select.Option>
              <Select.Option value="available">可用</Select.Option>
            </Select>
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setKeyword('');
              setStatusFilter(undefined);
            }}
          >
            重置
          </button>
        </Form>
      )}
      tableProps={{
        className: "vr-table std-table",
        columns: columns,
        dataSource: filteredTunnels,
        rowKey: (r: Srv6TunnelRow) => r.id,
        pagination: {
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        },
        loading: false,
        scroll: { x: 'max-content' },
        bordered: false
      }}
    >
      <Modal
        title={`健康巡检${healthRow ? ` - ${healthRow.name}` : ''}`}
        open={healthModalOpen}
        onCancel={() => { setHealthModalOpen(false); setHealthRow(null); setHealthSteps(initialHealthSteps); }}
        footer={null}
        destroyOnHidden
        width={900}
      >
        <Row gutter={16}>
          <Col span={10}>
            <div style={{ padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Descriptions column={1} size="small" title="隧道信息">
                <Descriptions.Item label="名称">{healthRow?.name || '-'}</Descriptions.Item>
                <Descriptions.Item label="状态">{healthRow?.status === 'available' ? <Badge status="success" text="可用" /> : <Badge status="processing" text="创建中" />}</Descriptions.Item>
                <Descriptions.Item label="PE-A">{healthRow?.peA || '-'}</Descriptions.Item>
                <Descriptions.Item label="PE-B">{healthRow?.peB || '-'}</Descriptions.Item>
                <Descriptions.Item label="CE-A">{healthRow?.ceA || '-'}</Descriptions.Item>
                <Descriptions.Item label="CE-B">{healthRow?.ceB || '-'}</Descriptions.Item>
              </Descriptions>
              <Divider style={{ margin: '12px 0' }} />
              <Space>
                <Button type="primary" onClick={startHealthCheck}>开始巡检</Button>
                <Button onClick={() => setHealthSteps(initialHealthSteps)}>重置</Button>
                <Button onClick={() => setHealthModalOpen(false)}>关闭</Button>
              </Space>
            </div>
          </Col>
          <Col span={14}>
            <div style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>巡检步骤</div>
              <Steps
                direction="vertical"
                items={healthSteps.map(s => ({ key: s.key, title: s.title, description: s.description, status: s.status, icon: stepIconForKey(s.key) }))}
              />
            </div>
          </Col>
        </Row>
      </Modal>

      {/* 列表页不再展示拓扑节点 */}
    </PageContainer>
  );
};

export default SRv6Page;
