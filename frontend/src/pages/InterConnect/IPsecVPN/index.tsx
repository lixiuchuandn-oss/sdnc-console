import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Tag, message, Dropdown, Modal, Switch, Select } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, ExclamationCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';
import { fetchIPsecVPNsMerged, deleteIPsecVPN } from '../../../services/api';
import { getVR2Config, fetchVrCachePageList } from '../../../services/virtualRouterApi';
import ReactFlow, { Background, Controls } from 'react-flow-renderer';

interface IPsecVPNRow {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'error' | 'creating';
  description?: string;
  createdAt: string;
  updatedAt?: string;
  ipsecInBytes?: number;
  ipsecInPackets?: number;
  ipsecOutBytes?: number;
  ipsecOutPackets?: number;
  ipsecUpdateDate?: string;
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
  
  localVrId: string;
  localVrName?: string;
  localVrWanName?: string;
  localVrWanIP?: string;
  localVrWanEIP?: string;
  localVrLanName?: string;
  localVrLanIP?: string;
  localVrLanSubnet: string;

  peerVrId?: string;
  peerVrName?: string;
  peerVrWanName?: string;
  peerVrWanIP: string;
  peerVrWanEIP?: string;
  peerVrLanName?: string;
  peerVrLanIP?: string;
  peerVrLanSubnet: string;
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
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  // PageContainer handles column visibility
  const defaultHiddenColumns = [
    'localVrWanName', 'localVrLanName', 'localVrLanIP',
    'peerVrWanName', 'peerVrLanName', 'peerVrLanIP',
    'ikeVersion', 'encryption', 'authentication', 'dhGroup', 'pfs', 'mode', 'natTraversal', 'dpd', 
    'description', 'createdAt', 'updatedAt', 'psk'
  ];

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

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '确认批量删除',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除选中的 ${selectedRowKeys.length} 个 IPsec VPN 吗？`,
      onOk: async () => {
        try {
          // Sequential delete to avoid overwhelming backend or race conditions
          for (const key of selectedRowKeys) {
             await deleteIPsecVPN(String(key));
          }
          message.success('批量删除成功');
          setSelectedRowKeys([]); // Clear selection
          fetchData();
        } catch (error) {
          console.error('Batch delete failed:', error);
          message.error('批量删除过程中出现错误');
          fetchData(); // Refresh anyway
        }
      }
    });
  };

  const getActionMenu = (row: IPsecVPNRow): MenuProps['items'] => ([
    { key: 'edit', label: '编辑' },
    { key: 'viewConfig', label: '查看本端VR配置' },
    { key: 'viewPeerConfig', label: '查看对端VR配置' },
    { type: 'divider' },
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
            const localCfg = await getVR2Config(String(row.localVrId));
            setTopoLocalCfg(localCfg);
          } catch {
            setTopoLocalCfg(null);
          }
          try {
            const peerId = String(row.peerVrId || '').trim();
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
        if (row.localVrId) {
          navigate(`/admin/interconnect/vr/${encodeURIComponent(row.localVrId)}/config`);
        } else {
          message.warning('缺少本端 VR 标识');
        }
        break;
      case 'viewPeerConfig':
        {
          const peerId = String(row.peerVrId || '').trim();
          if (peerId) {
            navigate(`/admin/interconnect/vr/${encodeURIComponent(peerId)}/config`);
          } else {
            message.warning('无法定位对端 VR（缺少 peerVrId）');
          }
        }
        break;
      case 'edit':
        navigate(`/admin/interconnect/ipsec/${row.id}/edit`);
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
    { title: '报文(入/出)', key: 'ipsecPackets', width: 140, render: (_: any, r: IPsecVPNRow) => (
      <span>{(r.ipsecInPackets ?? 0)}/{(r.ipsecOutPackets ?? 0)}</span>
    )},
    { title: '字节(入/出)', key: 'ipsecBytes', width: 160, render: (_: any, r: IPsecVPNRow) => (
      <span>{(r.ipsecInBytes ?? 0)}/{(r.ipsecOutBytes ?? 0)}</span>
    )},
    { title: '检测时间', dataIndex: 'ipsecUpdateDate', key: 'ipsecUpdateDate', width: 180, render: (d?: string) => d ? new Date(d).toLocaleString() : '—' },
    // 本端信息
    { title: '本端VR名称/UUID', dataIndex: 'localVrId', key: 'localVr', width: 220, render: (id: string) => {
        const name = vrNameMap[id];
        return name ? (<div>{name}<br/><span style={{fontSize: '12px', color: '#999'}}>{id}</span></div>) : (id || '—');
    }},
    { title: '本端WAN口名称', dataIndex: 'localVrWanName', key: 'localVrWanName', width: 140, render: (v: string) => v || '—' },
    { title: '本端WAN口IP', dataIndex: 'localVrWanIP', key: 'localVrWanIP', width: 140, render: (v: string) => v || '—' },
    { title: '本端EIP', dataIndex: 'localVrWanEIP', key: 'localVrWanEIP', width: 140, render: (v: string) => v || '未配置' },
    { title: '本端LAN口网段', dataIndex: 'localVrLanSubnet', key: 'localVrLanSubnet', width: 160, render: (v: string) => v || '—' },
    { title: '本端LAN口名称', dataIndex: 'localVrLanName', key: 'localVrLanName', width: 140, render: (v: string) => v || '—' },
    { title: '本端LAN口IP', dataIndex: 'localVrLanIP', key: 'localVrLanIP', width: 140, render: (v: string) => v || '—' },
    // 对端信息
    { title: '对端VR名称/UUID', dataIndex: 'peerVrId', key: 'peerVr', width: 220, render: (id: string) => {
        const name = vrNameMap[id];
        return name ? (<div>{name}<br/><span style={{fontSize: '12px', color: '#999'}}>{id}</span></div>) : (id || '—');
    }},
    { title: '对端WAN口名称', dataIndex: 'peerVrWanName', key: 'peerVrWanName', width: 140, render: (v: string) => v || '—' },
    { title: '对端WAN口IP', dataIndex: 'peerVrWanIP', key: 'peerVrWanIP', width: 140, render: (v: string) => v || '—' },
    { title: '对端EIP', dataIndex: 'peerVrWanEIP', key: 'peerVrWanEIP', width: 140, render: (v: string) => v || '未配置' },
    { title: '对端LAN口网段', dataIndex: 'peerVrLanSubnet', key: 'peerVrLanSubnet', width: 160, render: (v: string) => v || '—' },
    { title: '对端LAN口名称', dataIndex: 'peerVrLanName', key: 'peerVrLanName', width: 140, render: (v: string) => v || '—' },
    { title: '对端LAN口IP', dataIndex: 'peerVrLanIP', key: 'peerVrLanIP', width: 140, render: (v: string) => v || '—' },
    // 次要信息（默认隐藏）
    { title: 'IKE版本', dataIndex: ['ike', 'version'], key: 'ikeVersion', width: 90 },
    { title: 'PSK', dataIndex: ['ike', 'psk'], key: 'psk', width: 120 },
    { title: '加密', dataIndex: ['ike', 'encryption'], key: 'encryption', width: 120 },
    { title: '认证', dataIndex: ['ike', 'authentication'], key: 'authentication', width: 120 },
    { title: 'DH', dataIndex: ['ike', 'dhGroup'], key: 'dhGroup', width: 80 },
    { title: 'PFS', dataIndex: ['ike', 'pfs'], key: 'pfs', width: 120 },
    { title: '模式', dataIndex: ['ike', 'mode'], key: 'mode', width: 100 },
    { title: 'NAT-T', dataIndex: ['ike', 'natTraversal'], key: 'natTraversal', width: 90, render: (v?: boolean) => <Switch checked={!!v} disabled /> },
    { title: 'DPD', dataIndex: ['ike', 'dpd'], key: 'dpd', width: 90, render: (v?: boolean) => <Switch checked={!!v} disabled /> },
    { title: '描述', dataIndex: 'description', key: 'description', width: 220 },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180, render: (d: string) => new Date(d).toLocaleString() },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 180, render: (d?: string) => d ? new Date(d).toLocaleString() : '—' },
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
        const resp = await fetchVrCachePageList(1000, 1);
        const data = resp?.data || resp;
        const list: any[] = Array.isArray(data?.page)
          ? data.page
          : Array.isArray(data?.list)
          ? data.list
          : [];
        const map: Record<string, string> = {};
        list.forEach((vr: any) => {
          const id = vr.uuid || vr.id || vr.vm_id;
          const name = vr.name || id;
          if (id) map[String(id)] = String(name);
        });
        setVrNameMap(map);
      } catch (e) {
        console.error('Failed to fetch VR list from cache', e);
      }
    })();
  }, []);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      primaryAction={{
        text: '新建连接',
        onClick: () => navigate('/admin/interconnect/ipsec/create'),
        type: 'primary',
      }}
      onRefresh={fetchData}
      moreMenuItems={[
        { 
          key: 'batchDelete', 
          label: '批量删除', 
          danger: true, 
          disabled: selectedRowKeys.length === 0,
          onClick: handleBatchDelete
        }
      ]}
      defaultHiddenColumns={defaultHiddenColumns}
      toolbarLeft={(
        <Form
          className="toolbar-container"
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
              prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              className="toolbar-search"
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="全部" className="toolbar-filter-sm">
              <Select.Option value="active">活跃</Select.Option>
              <Select.Option value="inactive">未激活</Select.Option>
              <Select.Option value="creating">创建中</Select.Option>
              <Select.Option value="error">错误</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="ikeVersion" label="IKE版本">
            <Select allowClear placeholder="全部" className="toolbar-filter-sm">
              <Select.Option value="ikev1">IKEv1</Select.Option>
              <Select.Option value="ikev2">IKEv2</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="localPublicIp" label="本端IP">
            <Input allowClear placeholder="输入WAN IP或EIP" className="toolbar-filter-sm" />
          </Form.Item>
          <Form.Item name="peerGateway" label="对端IP">
            <Input allowClear placeholder="输入WAN IP或EIP" className="toolbar-filter-sm" />
          </Form.Item>
        </Form>
      )}
      tableProps={{
        rowSelection: {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        },
        columns: columns,
        dataSource: data.filter(d => {
          // Keyword filter
          const kw = keyword.trim().toLowerCase();
          let matchKw = true;
          if (kw) {
            const fields = [
              d.name, d.description || '',
              d.localVrId || '', d.peerVrId || ''
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
            const wan = String(d.localVrWanIP || '');
            const eip = String(d.localVrWanEIP || '');
            matchLocalIp = wan.includes(localPublicIpFilter) || eip.includes(localPublicIpFilter);
          }

          // Peer Gateway filter
          let matchPeerGw = true;
          if (peerGatewayFilter) {
            const gw = String(d.peerVrWanIP || '');
            const pub = String(d.peerVrWanEIP || '');
            matchPeerGw = gw.includes(peerGatewayFilter) || pub.includes(peerGatewayFilter);
          }

          return matchKw && matchStatus && matchIke && matchLocalIp && matchPeerGw;
        }),
        rowKey: "id",
        pagination: {
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        },
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
            <div><strong>本端VR</strong><div>{vrNameMap[detailRow.localVrId] || detailRow.localVrId}</div></div>
            <div><strong>本端VR ID</strong><div>{detailRow.localVrId}</div></div>
            <div><strong>本端WAN口名称</strong><div>{detailRow.localVrWanName || '—'}</div></div>
            <div><strong>本端WAN口IP</strong><div>{detailRow.localVrWanIP || '—'}</div></div>
            <div><strong>本端EIP</strong><div>{detailRow.localVrWanEIP || '未配置'}</div></div>
            <div><strong>本端LAN口名称</strong><div>{detailRow.localVrLanName || '—'}</div></div>
            <div><strong>本端LAN口IP</strong><div>{detailRow.localVrLanIP || '—'}</div></div>
            <div><strong>本端LAN口网段</strong><div>{detailRow.localVrLanSubnet}</div></div>

            <div><strong>对端VR</strong><div>{detailRow.peerVrId ? (vrNameMap[detailRow.peerVrId] || detailRow.peerVrId) : '—'}</div></div>
            <div><strong>对端VR ID</strong><div>{detailRow.peerVrId || '—'}</div></div>
            <div><strong>对端WAN口名称</strong><div>{detailRow.peerVrWanName || '—'}</div></div>
            <div><strong>对端WAN口IP</strong><div>{detailRow.peerVrWanIP}</div></div>
            <div><strong>对端EIP</strong><div>{detailRow.peerVrWanEIP || '未配置'}</div></div>
            <div><strong>对端LAN口名称</strong><div>{detailRow.peerVrLanName || '—'}</div></div>
            <div><strong>对端LAN口IP</strong><div>{detailRow.peerVrLanIP || '—'}</div></div>
            <div><strong>对端LAN口网段</strong><div>{detailRow.peerVrLanSubnet}</div></div>
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
                { id: 'localVR', position: { x: 60, y: 80 }, data: { label: `${vrNameMap[topoRow.localVrId] || topoRow.localVrId}\n(${topoRow.localVrId})\n${String(topoLocalCfg?.ipsec_preset?.public_ip || '')}` }, type: 'default' },
                { id: 'localSubnet', position: { x: 280, y: 80 }, data: { label: topoRow.localVrLanSubnet || '—' }, type: 'default' },
                { id: 'remoteGateway', position: { x: 500, y: 80 }, data: { label: topoRow.peerVrWanIP || '—' }, type: 'default' },
                { id: 'remoteVR', position: { x: 500, y: 220 }, data: { label: (() => {
                  const ip = String(topoRow.peerVrWanIP || '').trim();
                  const id = topoRow.peerVrId || '';
                  const name = id ? (vrNameMap[id] || id) : (ip || '—');
                  const peerPub = String(topoPeerCfg?.ipsec_preset?.public_ip || '');
                  return `${name}\n(${id || '—'})\n${peerPub}`;
                })() }, type: 'default' },
                { id: 'remoteSubnet', position: { x: 700, y: 80 }, data: { label: topoRow.peerVrLanSubnet || '—' }, type: 'default' },
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
