import React, { useMemo, useState } from 'react';
import { App, Button, Input, Table, Space, Tooltip, Typography, Modal } from 'antd';
import { LockOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { statusTag } from '../../Hw/components/Common';
import {
  fetchCloudProviderVpnGateways,
  fetchCloudProviderVpnConnections,
  deleteCloudProviderVpnGateway,
} from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  vpnGateways: any[];
  vpcs: any[];
  onSetVpnGateways: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const parseVpnList = (json: any): any[] =>
  (json?.data?.VpnGateways?.VpnGateway) || (json?.VpnGateways?.VpnGateway) || (json?.data?.vpn_gateways) || (json?.vpn_gateways) || [];

const VpnGatewaySectionAliyun: React.FC<Props> = ({ cloudId, vpnGateways, vpcs, onSetVpnGateways, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [connLoading, setConnLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderVpnGateways(cloudId);
      onSetVpnGateways(parseVpnList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const reloadAfterWrite = async () => {
    await refresh();
    if (onRefreshAll) await onRefreshAll();
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(vpnGateways) ? vpnGateways : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.Name || r?.name || ''} ${r?.VpnGatewayId || r?.id || ''} ${r?.InternetIp || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [vpnGateways, keyword]);

  const viewConnections = async (r: any) => {
    const vid = r?.VpnGatewayId || r?.id;
    setConnLoading(true);
    try {
      const json: any = await fetchCloudProviderVpnConnections(cloudId, vid);
      const list: any[] = (json?.data?.VpnConnections?.VpnConnection) || (json?.VpnConnections?.VpnConnection) || [];
      Modal.info({
        title: `VPN 连接 · ${r?.Name || vid}`,
        width: 760,
        content: (
          <Table
            size="small"
            className="std-table"
            bordered={false}
            rowKey={(c: any) => c?.VpnConnectionId}
            dataSource={Array.isArray(list) ? list : []}
            pagination={false}
            scroll={{ x: true }}
            columns={[
              { title: '名称', dataIndex: 'Name', key: 'name', render: (v: any) => v || '-' },
              { title: '连接 ID', dataIndex: 'VpnConnectionId', key: 'id' },
              { title: '本端网段', dataIndex: 'LocalSubnet', key: 'local' },
              { title: '对端网段', dataIndex: 'RemoteSubnet', key: 'remote' },
              { title: '状态', key: 'status', render: (_: any, c: any) => statusTag(c?.Status) },
            ] as any}
          />
        ),
      });
    } catch (e: any) {
      message.error(e?.message || '查询连接失败');
    } finally {
      setConnLoading(false);
    }
  };

  const handleDelete = (r: any) => {
    const vid = r?.VpnGatewayId || r?.id;
    if (!vid) return;
    Modal.confirm({
      title: '确定删除该 VPN 网关?',
      content: `ID: ${vid}（删除前需先删除其 VPN 连接）`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCloudProviderVpnGateway(cloudId, vid);
          message.success('删除成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '删除失败'); }
      },
    });
  };

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.Name || a?.name || '').localeCompare(String(b?.Name || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.Name || r?.name || '-';
        const idv = r?.VpnGatewayId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={idv !== '-' ? { text: idv } : false}>{idv}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '公网 IP', key: 'ip', width: 150,
      render: (_: any, r: any) => {
        const ip = r?.InternetIp;
        return ip ? <Typography.Text copyable={{ text: ip }}>{ip}</Typography.Text> : '-';
      },
    },
    { title: '规格', key: 'spec', width: 120, render: (_: any, r: any) => r?.Spec || '-' },
    {
      title: '所属 VPC', key: 'vpc', width: 200, ellipsis: true,
      render: (_: any, r: any) => {
        const vid = r?.VpcId || '';
        const hit = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''));
        const name = hit?.VpcName || hit?.name || vid;
        return name ? <Typography.Text type="secondary" ellipsis={{ tooltip: name }}>{name}</Typography.Text> : '-';
      },
    },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[
            { key: 'conn', label: '查看连接' },
            { key: 'del', label: '删除', danger: true },
          ]}
          onClick={({ key }: { key: string }) => {
            if (key === 'conn') viewConnections(r);
            if (key === 'del') handleDelete(r);
          }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [vpcs]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / IP" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading || connLoading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.VpnGatewayId || r?.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <LockOutlined />;
export const Label = 'VPN 网关';
export default VpnGatewaySectionAliyun;
