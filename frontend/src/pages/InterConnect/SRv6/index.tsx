import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Button, Divider, Form, Input, Select, Space, Table, Tag, Modal, Row, Col, message, Dropdown, Steps, Descriptions, Badge, Popover, Checkbox } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, ClusterOutlined, BranchesOutlined, RadarChartOutlined, SafetyCertificateOutlined, ShareAltOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';
import { vrApi } from '../../../services/vrApi';
import { getVRRoles } from '../../../services/vrConfigApi';
// 复用 VR 页的样式（filters-row / filter-tools / filter-actions / vr-table）
import '../../common/filters.css';

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

interface VRRowLite {
  id: string;
  name?: string;
  status?: string;
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
  const [vrs, setVrs] = useState<any[]>([]);
  const [rolesMap, setRolesMap] = useState<Record<string, string>>({});
  const rolesMapRef = useRef<Record<string, string>>({});

  // Columns control
  const defaultCheckedColumns = ['name', 'peA', 'peB', 'ceA', 'ceB', 'status', 'time', 'actions'];
  const [checkedColumns, setCheckedColumns] = useState<any[]>(defaultCheckedColumns);

  useEffect(() => {
    const saved = localStorage.getItem('srv6_columns_settings');
    if (saved) {
      try {
        setCheckedColumns(JSON.parse(saved));
      } catch (e) {
        console.warn('Failed to parse saved columns settings', e);
      }
    }
  }, []);

  const onColumnCheckChange = (checkedValues: any[]) => {
    setCheckedColumns(checkedValues);
    localStorage.setItem('srv6_columns_settings', JSON.stringify(checkedValues));
  };

  const [loading, setLoading] = useState<boolean>(false);
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

  const getActionMenu = (row: Srv6TunnelRow): MenuProps['items'] => ([
    { key: 'topology', label: '查看拓扑' },
    { key: 'update', label: '更新SRv6配置' },
    { key: 'health', label: '健康巡检' },
    { key: 'delete', label: '删除隧道' },
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
              const { deleteSrv6Tunnel } = await import('../../../services/api');
              await deleteSrv6Tunnel(row.id);
              message.success('隧道已删除');
              // 刷新列表
              const { fetchSrv6Tunnels } = await import('../../../services/api');
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
        <Dropdown menu={{ items: getActionMenu(row), onClick: handleRowActionClick(row) }} trigger={["click"]}>
          <Button type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
      )
    }
  ];

  const columns = useMemo(() => {
    return fullColumns.filter(col => checkedColumns.includes(col.key as string));
  }, [checkedColumns, fullColumns]);

  const columnSettingContent = (
    <Checkbox.Group
      style={{ display: 'flex', flexDirection: 'column' }}
      value={checkedColumns}
      onChange={onColumnCheckChange}
    >
      <Checkbox value="name">名称</Checkbox>
      <Checkbox value="peA">PE-A</Checkbox>
      <Checkbox value="peB">PE-B</Checkbox>
      <Checkbox value="ceA">CE-A</Checkbox>
      <Checkbox value="ceB">CE-B</Checkbox>
      <Checkbox value="status">状态</Checkbox>
      <Checkbox value="time">创建时间</Checkbox>
      <Checkbox value="actions" disabled>操作</Checkbox>
    </Checkbox.Group>
  );

  // 加载VR列表与角色映射（用于PE/CE选项）
  const fetchVRsAndRoles = async (pageSize: number = 100, pageNum: number = 1) => {
    setLoading(true);
    try {
      const resp: any = await vrApi.getVRInstances(pageSize, pageNum);
      const data: any = resp?.data ?? resp;
      const list: any[] = Array.isArray(data?.page)
        ? data.page
        : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data)
        ? (data as any[])
        : [];
      setVrs(list);
  
      const ids = list.map((r: any) => r.uuid || r.id || r.vm_id).filter(Boolean) as string[];
      try {
        const roles = await getVRRoles(ids);
        setRolesMap(roles || {});
        rolesMapRef.current = roles || {};
      } catch (e: any) {
        console.warn('获取角色映射失败:', e?.message || e);
        setRolesMap({});
        rolesMapRef.current = {};
      }
    } catch (error: any) {
      console.error('[SRV6_DEBUG_ERROR] 获取VR列表失败:', error);
      message.error(`获取VR列表失败: ${error.message || '请稍后重试'}`);
      setVrs([]);
      setRolesMap({});
      rolesMapRef.current = {};
    } finally {
      setLoading(false);
    }
  };

  // 页面加载时拉取一次
  useEffect(() => {
    fetchVRsAndRoles(100, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 过滤后的隧道
  const filteredTunnels = useMemo(() => {
    return tunnels.filter((t) => {
      const nameLower = (t.name || '').toLowerCase();
      if (keyword && !nameLower.includes(keyword.toLowerCase())) return false;
      if (statusFilter && statusFilter.length && !statusFilter.includes(t.status)) return false;
      return true;
    });
  }, [tunnels, keyword, statusFilter]);

  const peOptions = useMemo(() => (
    (vrs || [])
      .map((r: any) => ({ id: r.uuid || r.id || r.vm_id, label: r.name || (r.uuid || r.id || r.vm_id) }))
      .filter((o: any) => o.id && rolesMap[o.id] === 'PE')
      .map((o: any) => ({ value: o.id, label: o.label }))
  ), [vrs, rolesMap]);

  const ceOptions = useMemo(() => (
    (vrs || [])
      .map((r: any) => ({ id: r.uuid || r.id || r.vm_id, label: r.name || (r.uuid || r.id || r.vm_id) }))
      .filter((o: any) => o.id && rolesMap[o.id] === 'CE')
      .map((o: any) => ({ value: o.id, label: o.label }))
  ), [vrs, rolesMap]);


  const loadSrv6Tunnels = async () => {
    try {
      const { fetchSrv6Tunnels } = await import('../../../services/api');
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
      console.error('加载 SRv6 隧道失败:', e);
      message.error(`加载 SRv6 隧道失败：${e?.message || '请稍后重试'}`);
      setTunnels([]);
    }
  };

  useEffect(() => {
    loadSrv6Tunnels();
  }, []);

  const forceRefresh = () => {
    fetchVRsAndRoles(100, 1);
    loadSrv6Tunnels();
  };

  const moreMenu: MenuProps = {
    items: [
      {
        key: 'refresh',
        label: '刷新列表',
        onClick: forceRefresh
      }
    ]
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
      title="SRv6 隧道管理"
      titleLevel={3}
      subtitle="SRv6（Segment Routing over IPv6）用于在 IPv6 网络中实现基于段的路由，支持灵活的流量工程与业务编排。"
      asCard={false}
    >
      <Divider style={{ margin: '0 0 20px 0' }} />
      <div className="filters-row filters-row--compact">
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status || undefined);
          }}
        >
          <Form.Item name="keyword" label="名称">
            <Input allowClear placeholder="搜索名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select mode="multiple" allowClear placeholder="选择状态" style={{ width: 220 }}>
              <Select.Option value="creating">创建中</Select.Option>
              <Select.Option value="available">可用</Select.Option>
            </Select>
          </Form.Item>
        </Form>

        <Space className="filter-actions">
          <Button type="primary" size="middle" onClick={() => navigate('/admin/interconnect/srv6/create')}>创建SRv6隧道</Button>
          <Dropdown menu={moreMenu} trigger={['click']}>
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <Popover content={columnSettingContent} title="列设置" trigger="click" placement="bottomRight">
            <Button icon={<SettingOutlined />} />
          </Popover>
        </Space>
      </div>

      <>
        <Table
          className="vr-table"
          columns={columns}
          dataSource={filteredTunnels}
          rowKey={(r: Srv6TunnelRow) => r.id}
          pagination={{ pageSize: 10 }}
          loading={loading}
          scroll={{ x: 'max-content' }}
          bordered
        />
      </>

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