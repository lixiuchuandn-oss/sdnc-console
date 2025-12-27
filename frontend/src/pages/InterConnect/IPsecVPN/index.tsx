import React, { useEffect, useState } from 'react';
import { Button, Divider, Form, Input, Space, Table, Tag, message, Dropdown, Modal, Switch, Popover, Checkbox, Collapse, Typography, Row, Col, Select } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, ExclamationCircleOutlined, SettingOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';
import '../../common/filters.css';
import { fetchIPsecVPNs, fetchIPsecVPNsMerged, deleteIPsecVPN } from '../../../services/api';
import { vrApi } from '../../../services/vrApi';
import { getVR2Config } from '../../../services/vr2Api';
import ReactFlow, { Background, Controls } from 'react-flow-renderer';

interface IPsecVPNRow {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'error' | 'creating';
  description?: string;
  createdAt: string;
  ike: {
    version: string;
    psk: string;
    encryption: string;
    authentication: string;
    dhGroup: string;
    pfs: string;
    mode: string;
    natTraversal?: boolean;
    dpd?: boolean;
  };
  local: {
    vrId: string;
    subnet: string;
    publicIp?: string;
    privateIp?: string;
  };
  peer: {
    vrId?: string;
    gateway: string;
    subnet: string;
    publicIp?: string;
    privateIp?: string;
  };
}

const IPsecVPNPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<IPsecVPNRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [ikeVersionFilter, setIkeVersionFilter] = useState<string | undefined>(undefined);
  const [localPublicIpFilter, setLocalPublicIpFilter] = useState<string>('');
  const [peerGatewayFilter, setPeerGatewayFilter] = useState<string>('');
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  const [detailRow, setDetailRow] = useState<IPsecVPNRow | null>(null);
  const [topoRow, setTopoRow] = useState<IPsecVPNRow | null>(null);
  const [topoOpen, setTopoOpen] = useState<boolean>(false);
  const [topoLocalCfg, setTopoLocalCfg] = useState<any>(null);
  const [topoPeerCfg, setTopoPeerCfg] = useState<any>(null);
  const [topoLoading, setTopoLoading] = useState<boolean>(false);
  
  // PageContainer handles column visibility
  const defaultHiddenColumns = ['ikeVersion', 'encryption', 'authentication', 'dhGroup', 'pfs', 'mode', 'natTraversal', 'dpd', 'description', 'createdAt'];

  const handleDelete = (row: IPsecVPNRow) => {
    Modal.confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除 IPsec VPN "${row.name}" 吗？`,
      onOk: async () => {
        try {
          await deleteIPsecVPN(row.id);
          message.success('删除成功');
          fetchData();
        } catch (error) {
          console.error('Delete failed:', error);
          message.error('删除失败');
        }
      }
    });
  };

  const getActionMenu = (row: IPsecVPNRow): MenuProps['items'] => ([
    { key: 'detail', label: '查看详情' },
    { key: 'topology', label: '查看拓扑' },
    { key: 'viewConfig', label: '查看本端VR配置' },
    { key: 'viewPeerConfig', label: '查看对端VR配置' },
    { key: 'edit', label: '编辑' },
    { key: 'delete', label: '删除', danger: true },
  ]);

  const handleRowActionClick = (row: IPsecVPNRow): MenuProps['onClick'] => ({ key }) => {
    switch (key) {
      case 'detail':
        setDetailRow(row);
        break;
      case 'topology':
        (async () => {
          setTopoLoading(true);
          setTopoRow(row);
          setTopoOpen(true);
          try {
            const localCfg = await getVR2Config(String(row.local.vrId));
            setTopoLocalCfg(localCfg);
          } catch {
            setTopoLocalCfg(null);
          }
          try {
            const peerId = String(row.peer.vrId || '').trim();
            if (peerId) {
              const peerCfg = await getVR2Config(peerId);
              setTopoPeerCfg(peerCfg);
            } else {
              setTopoPeerCfg(null);
            }
          } catch {
            setTopoPeerCfg(null);
          }
          setTopoLoading(false);
        })();
        break;
      case 'viewConfig':
        if (row.local.vrId) {
          navigate(`/admin/interconnect/vr/${encodeURIComponent(row.local.vrId)}/config`);
        } else {
          message.warning('缺少本端 VR 标识');
        }
        break;
      case 'viewPeerConfig':
        {
          const peerId = String(row.peer.vrId || '').trim();
          if (peerId) {
            navigate(`/admin/interconnect/vr/${encodeURIComponent(peerId)}/config`);
          } else {
            message.warning('无法定位对端 VR（缺少 peerVrId）');
          }
        }
        break;
      case 'edit':
        message.info(`编辑: ${row.name} (暂未实现)`);
        break;
      case 'delete':
        handleDelete(row);
        break;
      default:
        break;
    }
  };

  const allColumns: ColumnsType<IPsecVPNRow> = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 160, fixed: 'left' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, fixed: 'left', render: (s: string) => (
      <Tag color={s === 'active' ? 'green' : s === 'inactive' ? 'default' : s === 'creating' ? 'blue' : 'red'}>
        {s === 'active' ? '活跃' : s === 'inactive' ? '未激活' : s === 'creating' ? '创建中' : '错误'}
      </Tag>
    )},
    // 本端信息
    { title: '本端VR ID', dataIndex: ['local', 'vrId'], key: 'localVrId', width: 200, render: (v: string) => v ? <Typography.Text copyable>{v}</Typography.Text> : '—' },
    { title: '本端公网IP', dataIndex: ['local', 'publicIp'], key: 'localPublic', width: 140, render: (v: string) => v || '—' },
    { title: '本端内网/子网', key: 'localPrivateSubnet', width: 180, render: (_: any, row: IPsecVPNRow) => (
      <div>
        <div>{row.local.privateIp || '—'}</div>
        <div style={{ fontSize: 12, color: '#888' }}>{row.local.subnet || '—'}</div>
      </div>
    )},
    // 对端信息
    { title: '对端VR ID', dataIndex: ['peer', 'vrId'], key: 'peerVrId', width: 200, render: (v: string) => v ? <Typography.Text copyable>{v}</Typography.Text> : '—' },
    { title: '对端公网IP', dataIndex: ['peer', 'publicIp'], key: 'peerPublic', width: 140, render: (v: string, row: IPsecVPNRow) => {
      // If we have resolved public IP from VR, use it. Otherwise use configured gateway.
      return v || row.peer.gateway || '—';
    }},
    { title: '对端内网/子网', key: 'peerPrivateSubnet', width: 180, render: (_: any, row: IPsecVPNRow) => (
      <div>
        <div>{row.peer.privateIp || '—'}</div>
        <div style={{ fontSize: 12, color: '#888' }}>{row.peer.subnet || '—'}</div>
      </div>
    )},
    // 次要信息（默认隐藏）
    { title: 'IKE版本', dataIndex: ['ike', 'version'], key: 'ikeVersion', width: 90 },
    { title: '加密', dataIndex: ['ike', 'encryption'], key: 'encryption', width: 120 },
    { title: '认证', dataIndex: ['ike', 'authentication'], key: 'authentication', width: 120 },
    { title: 'DH', dataIndex: ['ike', 'dhGroup'], key: 'dhGroup', width: 80 },
    { title: 'PFS', dataIndex: ['ike', 'pfs'], key: 'pfs', width: 120 },
    { title: '模式', dataIndex: ['ike', 'mode'], key: 'mode', width: 100 },
    { title: 'NAT-T', dataIndex: ['ike', 'natTraversal'], key: 'natTraversal', width: 90, render: (v?: boolean) => <Switch checked={!!v} disabled /> },
    { title: 'DPD', dataIndex: ['ike', 'dpd'], key: 'dpd', width: 90, render: (v?: boolean) => <Switch checked={!!v} disabled /> },
    { title: '描述', dataIndex: 'description', key: 'description', width: 220 },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180, render: (d: string) => new Date(d).toLocaleString() },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 120,
      render: (_: any, row: IPsecVPNRow) => (
        <Dropdown menu={{ items: getActionMenu(row), onClick: handleRowActionClick(row) }} trigger={["click"]}>
          <Button type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
      )
    }
  ];
  const columns = allColumns;

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetchIPsecVPNsMerged();
      const list: IPsecVPNRow[] = Array.isArray(res) ? res : [];
      setData(list);
    } catch (error) {
      console.error('Fetch failed:', error);
      message.error('获取列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    (async () => {
      try {
        const resp: any = await vrApi.getVRInstances(100, 1);
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
        const map: Record<string, string> = {};
        list.forEach((vr: any) => {
          const id = vr.uuid || vr.id || vr.vm_id;
          const name = vr.name || id;
          if (id) map[String(id)] = String(name);
        });
        setVrNameMap(map);
      } catch (e) {
        console.error('Failed to fetch VR list', e);
      }
    })();
  }, []);

  const moreMenu: MenuProps = {
    items: [
      {
        key: 'refresh',
        label: '刷新列表',
        onClick: fetchData
      }
    ]
  };

  return (
    <PageContainer
      title="IPsecVPN管理"
      titleLevel={3}
      subtitle="通过 IKEv1/IKEv2 协议创建加密虚拟专用网络，支持拓扑查看、配置审计和状态监控，保障跨网络数据传输安全。"
      asCard={false}
      primaryAction={{
        text: '新建连接',
        onClick: () => navigate('/admin/interconnect/ipsec/create'),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新列表', onClick: fetchData }
      ]}
      defaultHiddenColumns={defaultHiddenColumns}
      toolbarLeft={(
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status);
            setIkeVersionFilter(all.ikeVersion);
            setLocalPublicIpFilter(all.localPublicIp || '');
            setPeerGatewayFilter(all.peerGateway || '');
          }}
        >
          <Form.Item name="keyword" label="名称">
            <Input 
              allowClear 
              placeholder="搜索名称、ID" 
              prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.25)' }} />}
              style={{ width: 220 }} 
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="全部" style={{ width: 120 }}>
              <Select.Option value="active">活跃</Select.Option>
              <Select.Option value="inactive">未激活</Select.Option>
              <Select.Option value="creating">创建中</Select.Option>
              <Select.Option value="error">错误</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="ikeVersion" label="IKE版本">
            <Select allowClear placeholder="全部" style={{ width: 120 }}>
              <Select.Option value="ikev1">IKEv1</Select.Option>
              <Select.Option value="ikev2">IKEv2</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="localPublicIp" label="本端公网IP">
            <Input allowClear placeholder="输入IP" style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name="peerGateway" label="对端网关/IP">
            <Input allowClear placeholder="输入IP" style={{ width: 150 }} />
          </Form.Item>
        </Form>
      )}
      tableProps={{
        columns: columns,
        dataSource: data.filter(d => {
          // Keyword filter
          const kw = keyword.trim().toLowerCase();
          let matchKw = true;
          if (kw) {
            const fields = [
              d.name, d.description || '',
              d.local.vrId || '', d.peer.vrId || ''
            ].map(s => String(s || '').toLowerCase());
            matchKw = fields.some(s => s.includes(kw));
          }

          // Status filter
          let matchStatus = true;
          if (statusFilter) {
            matchStatus = d.status === statusFilter;
          }

          // IKE Version filter
          let matchIke = true;
          if (ikeVersionFilter) {
            matchIke = String(d.ike.version).toLowerCase() === ikeVersionFilter.toLowerCase();
          }

          // Local Public IP filter
          let matchLocalIp = true;
          if (localPublicIpFilter) {
            matchLocalIp = String(d.local.publicIp || '').includes(localPublicIpFilter);
          }

          // Peer Gateway filter
          let matchPeerGw = true;
          if (peerGatewayFilter) {
            const gw = String(d.peer.gateway || '');
            const pub = String(d.peer.publicIp || '');
            matchPeerGw = gw.includes(peerGatewayFilter) || pub.includes(peerGatewayFilter);
          }

          return matchKw && matchStatus && matchIke && matchLocalIp && matchPeerGw;
        }),
        rowKey: "id",
        pagination: { pageSize: 10, showSizeChanger: true },
        loading: loading,
        bordered: true,
        scroll: { x: 'max-content' }
      }}
    >
      
      <Modal
        title={detailRow ? `VPN详情 - ${detailRow.name}` : 'VPN详情'}
        open={!!detailRow}
        onCancel={() => setDetailRow(null)}
        footer={null}
        destroyOnHidden
      >
        {detailRow && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><strong>状态</strong><div><Tag color={detailRow.status === 'active' ? 'green' : detailRow.status === 'inactive' ? 'default' : detailRow.status === 'creating' ? 'blue' : 'red'}>{detailRow.status}</Tag></div></div>
            <div><strong>ID</strong><div>{detailRow.id}</div></div>
            <div><strong>本端VR</strong><div>{vrNameMap[detailRow.local.vrId] || detailRow.local.vrId}</div></div>
            <div><strong>本端VR ID</strong><div>{detailRow.local.vrId}</div></div>
            <div><strong>对端VR</strong><div>{detailRow.peer.vrId ? (vrNameMap[detailRow.peer.vrId] || detailRow.peer.vrId) : '—'}</div></div>
            <div><strong>对端VR ID</strong><div>{detailRow.peer.vrId || '—'}</div></div>
            <div><strong>本端子网</strong><div>{detailRow.local.subnet}</div></div>
            <div><strong>对端网关</strong><div>{detailRow.peer.gateway}</div></div>
            <div><strong>对端子网</strong><div>{detailRow.peer.subnet}</div></div>
            <div><strong>IKE版本</strong><div>{detailRow.ike.version}</div></div>
            <div><strong>PSK</strong><div>{detailRow.ike.psk}</div></div>
            <div><strong>加密算法</strong><div>{detailRow.ike.encryption}</div></div>
            <div><strong>认证算法</strong><div>{detailRow.ike.authentication}</div></div>
            <div><strong>DH Group</strong><div>{detailRow.ike.dhGroup}</div></div>
            <div><strong>PFS</strong><div>{detailRow.ike.pfs}</div></div>
            <div><strong>模式</strong><div>{detailRow.ike.mode}</div></div>
            <div><strong>NAT Traversal</strong><div>{detailRow.ike.natTraversal ? '是' : '否'}</div></div>
            <div><strong>DPD</strong><div>{detailRow.ike.dpd ? '是' : '否'}</div></div>
            <div style={{ gridColumn: 'span 2' }}><strong>描述</strong><div>{detailRow.description || '—'}</div></div>
            <div style={{ gridColumn: 'span 2' }}><strong>创建时间</strong><div>{new Date(detailRow.createdAt).toLocaleString()}</div></div>
          </div>
        )}
      </Modal>

      <Modal
        title={topoRow ? `VPN拓扑 - ${topoRow.name}` : 'VPN拓扑'}
        open={topoOpen}
        onCancel={() => { setTopoOpen(false); setTopoRow(null); }}
        footer={null}
        width={800}
        destroyOnHidden
      >
        {topoRow && !topoLoading && (
          <div style={{ height: 420 }}>
            <ReactFlow
              nodes={[
                { id: 'localVR', position: { x: 60, y: 80 }, data: { label: `${vrNameMap[topoRow.local.vrId] || topoRow.local.vrId}\n(${topoRow.local.vrId})\n${String(topoLocalCfg?.ipsec_preset?.public_ip || '')}` }, type: 'default' },
                { id: 'localSubnet', position: { x: 280, y: 80 }, data: { label: topoRow.local.subnet || '—' }, type: 'default' },
                { id: 'remoteGateway', position: { x: 500, y: 80 }, data: { label: topoRow.peer.gateway || '—' }, type: 'default' },
                { id: 'remoteVR', position: { x: 500, y: 220 }, data: { label: (() => {
                  const ip = String(topoRow.peer.gateway || '').trim();
                  const id = topoRow.peer.vrId || '';
                  const name = id ? (vrNameMap[id] || id) : (ip || '—');
                  const peerPub = String(topoPeerCfg?.ipsec_preset?.public_ip || '');
                  return `${name}\n(${id || '—'})\n${peerPub}`;
                })() }, type: 'default' },
                { id: 'remoteSubnet', position: { x: 700, y: 80 }, data: { label: topoRow.peer.subnet || '—' }, type: 'default' },
              ]}
              edges={[
                { id: 'e1', source: 'localVR', target: 'localSubnet' },
                { id: 'e2', source: 'localSubnet', target: 'remoteGateway' },
                { id: 'e3', source: 'remoteGateway', target: 'remoteSubnet' },
                { id: 'e4', source: 'remoteGateway', target: 'remoteVR' },
              ]}
              fitView
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
        )}
        {topoRow && topoLoading && (
          <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>加载中…</div>
        )}
      </Modal>

      {/* 创建改为页面向导，抽屉不再使用 */}
    </PageContainer>
  );
};

export default IPsecVPNPage;
