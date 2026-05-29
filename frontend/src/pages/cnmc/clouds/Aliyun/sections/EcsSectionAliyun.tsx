import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Badge, Button, Input, Modal, Select, Table, Space, Tooltip, Typography } from 'antd';
import { ReloadOutlined, EllipsisOutlined, CloudServerOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { API_BASE_URL } from '../../../../../services/api';
import { startAliyunEcs, stopAliyunEcs, rebootAliyunEcs, deleteAliyunEcs, fetchAliyunEcsVncUrl } from '../../../../../services/aliyunApi';
import PageDetailSection, { LiveSwitch, RowActionsButton } from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import EcsDetailModal from '../modals/EcsDetailModal';
import { collectIpv4FromAddresses } from '../../Hw/components/Common';
import { getToken } from '../../../../../utils/tokenStorage';

type EcsSectionAliyunProps = {
  cloudId: string;
  ecs: any[];
  onRefreshAll: () => void;
  onOpenVmDetail?: (vm: any) => void;
  showLog?: boolean;
  raw?: any;
};

const ECS_TABLE_SETTINGS_KEY = 'aliyun-ecs-table';
const ECS_TABLE_DEFAULT_HIDDEN: string[] = ['vpc', 'etime'];

const ECS_STATUS_MAP: Record<string, { status: 'success' | 'processing' | 'error' | 'default' | 'warning'; text: string }> = {
  Running: { status: 'success', text: '运行中' },
  Stopped: { status: 'default', text: '已停止' },
  Starting: { status: 'processing', text: '启动中' },
  Stopping: { status: 'warning', text: '停止中' },
  Rebooting: { status: 'processing', text: '重启中' },
  Pending: { status: 'processing', text: '创建中' },
};

const renderEcsStatus = (s?: string) => {
  const key = String(s || '').trim();
  const map = ECS_STATUS_MAP[key] || { status: 'default' as const, text: key || '-' };
  return <Badge status={map.status} text={map.text} />;
};

const formatDateTime = (raw?: string) => {
  if (!raw) return '-';
  try {
    const d = new Date(raw);
    if (d && !isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false });
  } catch {}
  return raw;
};

const getPublicIp = (r: any): string => {
  const { floating } = collectIpv4FromAddresses(r?.addresses);
  if (Array.isArray(floating) && floating.length) return floating.join(', ');
  const arr = r?.PublicIpAddress?.IpAddress;
  if (Array.isArray(arr) && arr.length > 0) return arr.join(', ');
  return String(r?.EipAddress?.IpAddress || r?.publicIpAddress || '');
};

const getPrivateIp = (r: any): string => {
  const { fixed } = collectIpv4FromAddresses(r?.addresses);
  if (Array.isArray(fixed) && fixed.length) return fixed.join(', ');
  const arr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
  if (Array.isArray(arr) && arr.length > 0) return arr.join(', ');
  return String(r?.privateIpAddress || '');
};

const EcsSectionAliyun: React.FC<EcsSectionAliyunProps> = ({ cloudId, ecs, onRefreshAll, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [zoneFilter, setZoneFilter] = useState<string | undefined>(undefined);
  const [cpuFilter, setCpuFilter] = useState<string | undefined>(undefined);
  const [memGbFilter, setMemGbFilter] = useState<string | undefined>(undefined);
  const [vpcFilter, setVpcFilter] = useState<string | undefined>(undefined);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [live, setLive] = useState<boolean>(false);
  const esRef = useRef<EventSource | null>(null);
  const [ecsLocal, setEcsLocal] = useState<any[]>(Array.isArray(ecs) ? ecs : []);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  useEffect(() => { if (!live) setEcsLocal(Array.isArray(ecs) ? ecs : []); }, [ecs, live]);
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [detailInstanceId, setDetailInstanceId] = useState<string>('');
  useEffect(() => { return () => { try { if (esRef.current) { esRef.current.close(); esRef.current = null; } } catch {} }; }, []);

  const openDetail = (r: any) => {
    const iid = String(r?.InstanceId || r?.id || '');
    if (!iid) return;
    setDetailInstanceId(iid);
    setDetailOpen(true);
  };

  const toggleLive = async () => {
    try {
      if (live) {
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
        setLive(false);
        setEcsLocal(Array.isArray(ecs) ? ecs : []);
      } else {
        const token = getToken() || '';
        const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        const es = new EventSource(url);
        esRef.current = es;
        es.addEventListener('vms', (ev: MessageEvent) => {
          try {
            const json = JSON.parse(String(ev.data || '{}'));
            const items: any[] = Array.isArray(json?.items) ? json.items : [];
            setEcsLocal(items);
          } catch {}
        });
        es.addEventListener('vm_created', (ev: MessageEvent) => {
          try {
            const json = JSON.parse(String(ev.data || '{}'));
            const r = json?.item;
            if (!r) return;
            setEcsLocal(prev => {
              const iid = String(r?.InstanceId || r?.id || '');
              if (!iid) return prev;
              if ((prev || []).some((x:any)=> String(x?.InstanceId||x?.id||'')===iid)) return prev;
              return [r, ...(prev || [])];
            });
          } catch {}
        });
        es.addEventListener('vm_deleted', (ev: MessageEvent) => {
          try {
            const json = JSON.parse(String(ev.data || '{}'));
            const iid = String(json?.iid || '');
            if (!iid) return;
            setEcsLocal(prev => (prev || []).filter((x:any)=> String(x?.InstanceId||x?.id||'')!==iid));
          } catch {}
        });
        es.addEventListener('vm_status', (ev: MessageEvent) => {
          try {
            const json = JSON.parse(String(ev.data || '{}'));
            const iid = String(json?.iid || '');
            const status = String(json?.status || '');
            if (!iid) return;
            setEcsLocal(prev => (prev || []).map((x:any)=> {
              const xiid = String(x?.InstanceId||x?.id||'');
              if (xiid === iid) return { ...x, Status: status, status };
              return x;
            }));
            setChangedIds(prev => {
              const next = new Set(prev);
              next.add(iid);
              return next;
            });
            setTimeout(() => {
              setChangedIds(prev => {
                const next = new Set(prev);
                next.delete(iid);
                return next;
              });
            }, 1200);
          } catch {}
        });
        es.onerror = () => { try { es.close(); } catch {} };
        setLive(true);
      }
    } catch {}
  };

  const filteredEcs = useMemo(() => {
    const base = live ? ecsLocal : ecs;
    const list = Array.isArray(base) ? base : [];
    return list.filter((r: any) => {
      const kn = keyword.trim().toLowerCase();
      const nm = String(r?.InstanceName || r?.name || r?.id || r?.InstanceId || '').toLowerCase();
      const ipText = `${getPublicIp(r) || ''} ${getPrivateIp(r) || ''}`.toLowerCase();
      const okKw = !kn || nm.includes(kn) || ipText.includes(kn);
      const st = String(r?.Status || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === String(statusFilter).toLowerCase();
      const zn = String(r?.ZoneId || r?.zone || '').toLowerCase();
      const okZn = !zoneFilter || zn === String(zoneFilter).toLowerCase();
      const cpu = String(r?.Cpu || r?.CPU || '').trim();
      const okCpu = !cpuFilter || String(cpuFilter || '') === cpu;
      const memMb = parseFloat(String(r?.Memory ?? r?.memory ?? 0)) || 0;
      const memGb = memMb > 0 ? Math.round(memMb / 1024) : 0;
      const okMem = !memGbFilter || String(memGbFilter || '') === String(memGb || '');
      const vid = String(r?.VpcAttributes?.VpcId || r?.VpcId || '').trim();
      const okVpc = !vpcFilter || String(vpcFilter || '') === vid;
      return okKw && okSt && okZn && okCpu && okMem && okVpc;
    });
  }, [ecs, ecsLocal, live, keyword, statusFilter, zoneFilter, cpuFilter, memGbFilter, vpcFilter]);

  const allColumns: ColumnsType<any> = useMemo(() => [
    {
      title: '实例',
      key: 'inst',
      fixed: 'left',
      width: 240,
      render: (_: any, r: any) => {
        const name = r?.InstanceName || r?.name || '-';
        const id = r?.InstanceId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Link strong ellipsis={{ tooltip: name } as any} onClick={() => openDetail(r)} style={{ padding: 0 }}>
              {name}
            </Typography.Link>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>
              {id}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_: any, r: any) => renderEcsStatus(r?.Status || r?.status),
    },
    {
      title: '实例规格',
      key: 'spec',
      width: 200,
      sorter: (a: any, b: any) => {
        const vA = parseInt(String(a?.Cpu ?? a?.CPU ?? 0)) || 0;
        const vB = parseInt(String(b?.Cpu ?? b?.CPU ?? 0)) || 0;
        const rAmb = parseFloat(String(a?.Memory ?? a?.memory ?? 0)) || 0;
        const rBmb = parseFloat(String(b?.Memory ?? b?.memory ?? 0)) || 0;
        if (vA !== vB) return vA - vB;
        return rAmb - rBmb;
      },
      render: (_: any, r: any) => {
        const vcpus = String(r?.Cpu || r?.CPU || r?.flavor?.vcpus || '').trim();
        const ramMbRaw = r?.Memory ?? r?.memory;
        let ramGb = '';
        if (ramMbRaw != null) {
          const val = parseFloat(String(ramMbRaw));
          if (!isNaN(val) && val > 0) ramGb = String(Math.round((val / 1024) * 10) / 10);
        }
        const name = r?.InstanceType || r?.flavor?.name || r?.flavor?.id || '';
        const parts: string[] = [];
        if (vcpus) parts.push(`${vcpus} vCPU`);
        if (ramGb) parts.push(`${ramGb} GB`);
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{parts.length ? parts.join(' · ') : '-'}</Typography.Text>
            {name && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: name }}>
                {name}
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: '可用区',
      key: 'zone',
      width: 130,
      render: (_: any, r: any) => r?.ZoneId || r?.zone || '-',
    },
    {
      title: '镜像',
      key: 'image',
      width: 200,
      render: (_: any, r: any) => {
        const name = r?.ImageId || r?.image?.name || r?.metadata?.image_name || '';
        if (!name) return '-';
        return (
          <Typography.Text type="secondary" ellipsis={{ tooltip: name }} style={{ maxWidth: 180 }}>
            {name}
          </Typography.Text>
        );
      },
    },
    {
      title: 'IP 地址',
      key: 'ips',
      width: 220,
      render: (_: any, r: any) => {
        const pub = getPublicIp(r);
        const pri = getPrivateIp(r);
        const bw = r?.InternetMaxBandwidthOut;
        return (
          <Space direction="vertical" size={0}>
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>公</Typography.Text>
              {pub ? (
                <Typography.Text copyable={{ text: pub }} style={{ fontSize: 13 }}>
                  {pub}{bw ? `（${bw}Mbps）` : ''}
                </Typography.Text>
              ) : <Typography.Text type="secondary">-</Typography.Text>}
            </Space>
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>内</Typography.Text>
              {pri ? (
                <Typography.Text copyable={{ text: pri }} style={{ fontSize: 13 }}>{pri}</Typography.Text>
              ) : <Typography.Text type="secondary">-</Typography.Text>}
            </Space>
          </Space>
        );
      },
    },
    {
      title: '所属 VPC',
      key: 'vpc',
      width: 200,
      render: (_: any, r: any) => {
        const vid = r?.VpcAttributes?.VpcId || r?.VpcId || '';
        return vid ? (
          <Typography.Text type="secondary" copyable={{ text: vid }} ellipsis={{ tooltip: vid }} style={{ maxWidth: 170 }}>
            {vid}
          </Typography.Text>
        ) : '-';
      },
    },
    {
      title: '创建时间',
      key: 'ctime',
      width: 170,
      sorter: (a: any, b: any) => String(a?.CreationTime || a?.created || a?.create_time || '').localeCompare(String(b?.CreationTime || b?.created || b?.create_time || '')),
      render: (_: any, r: any) => formatDateTime(r?.CreationTime || r?.created || r?.create_time),
    },
    {
      title: '到期时间',
      key: 'etime',
      width: 170,
      sorter: (a: any, b: any) => String(a?.ExpiredTime || '').localeCompare(String(b?.ExpiredTime || '')),
      render: (_: any, r: any) => {
        const rawV = r?.ExpiredTime || '';
        if (!rawV) return '-';
        try {
          const d = new Date(rawV);
          if (d && !isNaN(d.getTime())) {
            const now = new Date();
            const isExpired = d < now;
            const diffDays = (d.getTime() - now.getTime()) / (1000 * 3600 * 24);
            const color = isExpired ? '#ff4d4f' : (diffDays < 7 ? '#faad14' : 'inherit');
            return <span style={{ color }}>{d.toLocaleString('zh-CN', { hour12: false })}</span>;
          }
        } catch {}
        return rawV;
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 90,
      render: (_: any, r: any) => {
        const iid = r?.InstanceId || r?.id;
        const st = String(r?.Status || r?.status || '').trim();
        const items = [
          { key: 'detail', label: '详情' },
          { key: 'webvnc', label: 'WebVNC（浏览器）' },
          { type: 'divider' as any },
          { key: 'start', label: '启动', disabled: !(st === 'Stopped' || st === 'Stopping') },
          { key: 'stop', label: '停止', disabled: !(st === 'Running' || st === 'Starting') },
          { key: 'reboot', label: '重启', disabled: !(st === 'Running') },
          { type: 'divider' as any },
          { key: 'delete', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }) => {
              if (key === 'detail') { openDetail(r); return; }
              if (key === 'webvnc') {
                try {
                  const json = await fetchAliyunEcsVncUrl(cloudId, iid);
                  const url = json?.data?.VncUrl || json?.data?.vncUrl;
                  if (url) {
                    const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                    const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                    const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                    const osRaw = String(r?.OSName || r?.OSType || r?.Platform || r?.image || '').toLowerCase();
                    const isWindows = osRaw.includes('win');
                    const page = 'https://g.alicdn.com/aliyun/ecs-console-vnc2/0.0.8/index.html';
                    const web = `${page}?vncUrl=${encodeURIComponent(url)}&instanceId=${encodeURIComponent(iid)}&isWindows=${isWindows ? 'true' : 'false'}`;
                    window.open(web, 'aliyun-webvnc', features);
                  } else { message.warning('未获取到VNC地址'); }
                } catch (e: any) { message.error(e?.message || '获取VNC地址失败'); }
                return;
              }
              if (key === 'start') { try { await startAliyunEcs(cloudId, iid); message.success('启动指令已下发'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '启动失败'); } return; }
              if (key === 'stop') { try { await stopAliyunEcs(cloudId, iid, false); message.success('停止指令已下发'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '停止失败'); } return; }
              if (key === 'reboot') { try { await rebootAliyunEcs(cloudId, iid, false); message.success('重启指令已下发'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '重启失败'); } return; }
              if (key === 'delete') {
                Modal.confirm({
                  title: '确认删除该实例？',
                  content: `实例 ${r?.InstanceName || iid} 删除后不可恢复`,
                  okText: '确认删除',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: async ()=> { try { await deleteAliyunEcs(cloudId, iid); message.success('删除成功'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '删除失败'); } },
                });
                return;
              }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cloudId, message, onRefreshAll]);

  const { displayColumns } = useTableColumnSettings(allColumns, ECS_TABLE_SETTINGS_KEY, ECS_TABLE_DEFAULT_HIDDEN);

  const zoneOptions = useMemo(() => Array.from(new Set((ecs || []).map((r: any) => String(r?.ZoneId || r?.zone || '').trim()).filter(Boolean))).map(z => ({ label: z, value: z })), [ecs]);
  const cpuOptions = useMemo(() => Array.from(new Set((ecs || []).map((r: any) => String(r?.Cpu || r?.CPU || '').trim()).filter(Boolean))).map(c => ({ label: `${c} vCPU`, value: c })), [ecs]);
  const memOptions = useMemo(() => Array.from(new Set((ecs || []).map((r: any) => { const mb = parseFloat(String(r?.Memory ?? r?.memory ?? 0)) || 0; const gb = mb > 0 ? Math.round(mb / 1024) : 0; return String(gb || ''); }).filter(Boolean))).map(m => ({ label: `${m} GB`, value: m })), [ecs]);
  const vpcOptions = useMemo(() => Array.from(new Set((ecs || []).map((r: any) => String(r?.VpcAttributes?.VpcId || r?.VpcId || '').trim()).filter(Boolean))).map(v => ({ label: v, value: v })), [ecs]);

  const resetFilters = () => {
    setKeyword('');
    setStatusFilter(undefined);
    setZoneFilter(undefined);
    setCpuFilter(undefined);
    setMemGbFilter(undefined);
    setVpcFilter(undefined);
  };

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input
            className="toolbar-search"
            prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            placeholder="名称 / ID / IP"
            allowClear
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={Object.keys(ECS_STATUS_MAP).map(k => ({ label: ECS_STATUS_MAP[k].text, value: k }))} />
          <Select className="toolbar-filter-sm" placeholder="可用区" allowClear value={zoneFilter} onChange={setZoneFilter} options={zoneOptions} dropdownMatchSelectWidth={false} />
          <Select className="toolbar-filter-sm" placeholder="vCPU" allowClear value={cpuFilter} onChange={setCpuFilter} options={cpuOptions} dropdownMatchSelectWidth={false} />
          <Select className="toolbar-filter-sm" placeholder="内存" allowClear value={memGbFilter} onChange={setMemGbFilter} options={memOptions} dropdownMatchSelectWidth={false} />
          <Select className="toolbar-filter-sm" placeholder="所属 VPC" allowClear value={vpcFilter} onChange={setVpcFilter} options={vpcOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Space size={8}>
            <LiveSwitch checked={!!live} onChange={() => toggleLive()} />
            <ResourceActionsDropdown
              items={[
                { key: 'batch_start', label: '批量启动' },
                { key: 'batch_stop', label: '批量停止' },
                { key: 'batch_reboot', label: '批量重启' },
                { type: 'divider' as any },
                { key: 'batch_delete', label: '批量删除', danger: true },
              ]}
              buttonProps={{ icon: <EllipsisOutlined />, disabled: selectedKeys.length === 0 }}
              onClick={async ({ key }: { key: string }) => {
                const targets = (live ? ecsLocal : ecs || []).filter((r:any)=> selectedKeys.includes(r?.InstanceId || r?.id));
                if (!targets.length) { message.info('请先勾选实例'); return; }
                try {
                  for (const r of targets) {
                    const iid = r?.InstanceId || r?.id;
                    if (!iid) continue;
                    if (key === 'batch_start') await startAliyunEcs(cloudId, iid);
                    else if (key === 'batch_stop') await stopAliyunEcs(cloudId, iid, false);
                    else if (key === 'batch_reboot') await rebootAliyunEcs(cloudId, iid, false);
                    else if (key === 'batch_delete') await deleteAliyunEcs(cloudId, iid);
                  }
                  message.success('批量操作已下发');
                  setSelectedKeys([]);
                  await onRefreshAll();
                } catch(e:any){ message.error(e?.message || '批量操作失败'); }
              }}
            />
            <TableColumnSettingsButton
              allColumns={allColumns}
              settingsKey={ECS_TABLE_SETTINGS_KEY}
              defaultHiddenColumns={ECS_TABLE_DEFAULT_HIDDEN}
            />
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined />} onClick={async ()=> { await onRefreshAll(); }} />
            </Tooltip>
          </Space>
        </div>
      )}
      asCard={false}
    >
      <style>{`.ecs-row-updated{animation:ecsRowBlink .8s ease-in-out 1;background:#fffbe6}@keyframes ecsRowBlink{0%{background:#fffbe6}50%{background:#fff}}`}</style>
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r:any)=> r.InstanceId || r.id}
        dataSource={filteredEcs}
        columns={displayColumns}
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowClassName={(r:any)=> {
          const xiid = String(r?.InstanceId || r?.id || '');
          return changedIds.has(xiid) ? 'ecs-row-updated' : '';
        }}
        rowSelection={{
          fixed: true,
          selectedRowKeys: selectedKeys,
          onChange: (keys)=> setSelectedKeys(keys),
          getCheckboxProps: (r:any)=> ({ value: r?.InstanceId || r?.id }),
        }}
      />
      {!!showLog && (
        <div style={{ marginTop: 12 }}>
          <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
      <EcsDetailModal open={detailOpen} onClose={() => setDetailOpen(false)} cloudId={cloudId} instanceId={detailInstanceId} />
    </PageDetailSection>
  );
};

export const Icon = <CloudServerOutlined />;
export const Label = '云主机';
export default EcsSectionAliyun;
