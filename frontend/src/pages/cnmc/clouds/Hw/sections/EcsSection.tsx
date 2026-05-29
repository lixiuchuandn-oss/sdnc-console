import React, { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Select, Space, Table, Tooltip, Typography } from 'antd';
import { CloudServerOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { statusTag, collectIpv4FromAddresses } from '../components/Common';
import { fetchCloudProviderEcsVncUrl, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs } from '../../../../../services/api';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type EcsSectionProps = {
  cloudId: string;
  ecs: any[];
  onRefreshAll: () => void;
  onOpenVmDetail: (vm: any) => void;
};

const EcsSection: React.FC<EcsSectionProps> = ({ cloudId, ecs, onRefreshAll, onOpenVmDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const filteredEcs = useMemo(() => {
    const list = Array.isArray(ecs) ? ecs : [];
    return list.filter((r: any) => {
      const kn = keyword.trim().toLowerCase();
      const okKw = !kn || String(r?.name || r?.id || r?.InstanceName || r?.InstanceId || '').toLowerCase().includes(kn);
      const st = String(r?.status || r?.Status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [ecs, keyword, statusFilter]);

  const columns = useMemo(() => [
    {
      title: '实例', key: 'inst', fixed: 'left' as const, width: 240,
      render: (_: any, r: any) => {
        const name = r?.name || r?.InstanceName || '-';
        const id = r?.id || r?.InstanceId || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Link strong ellipsis={{ tooltip: name } as any} onClick={() => { if (!r?.id && !r?.InstanceId) return; onOpenVmDetail(r); }} style={{ padding: 0 }}>{name}</Typography.Link>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.status) },
    {
      title: '实例规格', key: 'spec', width: 200,
      sorter: (a: any, b: any) => {
        const vA = parseInt(String(a?.flavor?.vcpus ?? a?.vcpus ?? a?.Cpu ?? a?.CPU ?? 0)) || 0;
        const vB = parseInt(String(b?.flavor?.vcpus ?? b?.vcpus ?? b?.Cpu ?? b?.CPU ?? 0)) || 0;
        return vA - vB;
      },
      render: (_: any, r: any) => {
        const vcpus = String(r?.flavor?.vcpus || r?.flavor?.Vcpus || r?.vcpus || r?.Cpu || r?.CPU || '').trim();
        const ramMbRaw = r?.flavor?.ram ?? r?.flavor?.Ram ?? r?.ram ?? r?.MemoryMB ?? r?.memoryMB ?? r?.memory_mb;
        let ramGb = '';
        if (ramMbRaw != null) {
          const val = parseFloat(String(ramMbRaw));
          if (!isNaN(val) && val > 0) ramGb = String(Math.max(0, Math.round(val / 1024)));
        } else {
          const ramGbRaw = r?.Memory ?? r?.memory;
          if (ramGbRaw != null) { const val = parseFloat(String(ramGbRaw)); if (!isNaN(val) && val > 0) ramGb = String(Math.max(0, Math.round(val))); }
        }
        const name = r?.flavor?.id || r?.flavor?.original_name || r?.flavor?.name || r?.InstanceType || '';
        const parts: string[] = [];
        if (vcpus) parts.push(`${vcpus} vCPU`);
        if (ramGb) parts.push(`${ramGb} GB`);
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{parts.length ? parts.join(' · ') : '-'}</Typography.Text>
            {name && <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: name }}>{name}</Typography.Text>}
          </Space>
        );
      },
    },
    {
      title: '镜像', key: 'image', width: 200,
      render: (_: any, r: any) => {
        const name = r?.metadata?.image_name || r?.image?.name || '';
        if (!name) return '-';
        return <Typography.Text type="secondary" ellipsis={{ tooltip: name }} style={{ maxWidth: 180 }}>{name}</Typography.Text>;
      },
    },
    {
      title: 'IP 地址', key: 'ips', width: 220,
      render: (_: any, r: any) => {
        const { fixed, floating } = collectIpv4FromAddresses(r?.addresses);
        const pub = floating.length ? floating.join(', ') : '';
        const pri = fixed.length ? fixed.join(', ') : '';
        return (
          <Space direction="vertical" size={0}>
            <Space size={4}><Typography.Text type="secondary" style={{ fontSize: 12 }}>公</Typography.Text>{pub ? <Typography.Text copyable={{ text: pub }} style={{ fontSize: 13 }}>{pub}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>}</Space>
            <Space size={4}><Typography.Text type="secondary" style={{ fontSize: 12 }}>内</Typography.Text>{pri ? <Typography.Text copyable={{ text: pri }} style={{ fontSize: 13 }}>{pri}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>}</Space>
          </Space>
        );
      },
    },
    {
      title: '创建时间', key: 'ctime', width: 170,
      render: (_: any, r: any) => {
        const raw = r?.created || r?.create_time || r?.CreationTime || '';
        if (!raw) return '-';
        try { const d = new Date(raw); if (d && !isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false }); } catch {}
        return raw;
      },
    },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 90,
      render: (_: any, r: any) => {
        const iid = r?.id || r?.InstanceId;
        const items = [
          { key: 'detail', label: '详情' },
          { key: 'webvnc', label: 'WebVNC（浏览器）' },
          { type: 'divider' as any },
          { key: 'start', label: '启动' },
          { key: 'stop', label: '停止' },
          { key: 'reboot', label: '重启' },
          { type: 'divider' as any },
          { key: 'delete', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }) => {
              if (key === 'detail') { if (!cloudId || !iid) return; onOpenVmDetail(r); return; }
              if (key === 'webvnc') {
                try {
                  const json = await fetchCloudProviderEcsVncUrl(cloudId, iid);
                  const url = json?.data?.VncUrl || json?.data?.vncUrl;
                  if (url) {
                    const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                    const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                    window.open(url, 'webvnc', `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`);
                  } else { message.warning('未获取到VNC地址'); }
                } catch (e: any) { message.error(e?.message || '获取VNC地址失败'); }
                return;
              }
              if (key === 'start') { try { await startCloudProviderEcs(cloudId, iid); message.success('启动指令已下发'); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '启动失败'); } return; }
              if (key === 'stop') { try { await stopCloudProviderEcs(cloudId, iid, false); message.success('停止指令已下发'); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '停止失败'); } return; }
              if (key === 'reboot') { try { await rebootCloudProviderEcs(cloudId, iid, false); message.success('重启指令已下发'); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '重启失败'); } return; }
              if (key === 'delete') { Modal.confirm({ title: '确认删除该实例？', okText: '确认删除', okType: 'danger', cancelText: '取消', onOk: async () => { try { await deleteCloudProviderEcs(cloudId, iid); message.success('删除成功'); await onRefreshAll(); } catch (e: any) { message.error(e?.message || '删除失败'); } } }); return; }
            }}
          />
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cloudId, onOpenVmDetail, onRefreshAll]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={[{ label: 'ACTIVE', value: 'ACTIVE' }, { label: 'SHUTOFF', value: 'SHUTOFF' }, { label: 'ERROR', value: 'ERROR' }]} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} onClick={async () => { await onRefreshAll(); }} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id || r.InstanceId}
        dataSource={filteredEcs}
        columns={columns as any}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <CloudServerOutlined />;
export const Label = '云主机';
export default EcsSection;
