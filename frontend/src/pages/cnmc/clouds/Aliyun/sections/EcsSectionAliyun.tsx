import React, { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Modal, Select, Table, Space, Typography } from 'antd';
import { ReloadOutlined, CloudServerOutlined } from '@ant-design/icons';
import { API_BASE_URL } from '../../../../../services/api';
import { startAliyunEcs, stopAliyunEcs, rebootAliyunEcs, deleteAliyunEcs, fetchAliyunEcsVncUrl } from '../../../../../services/aliyunApi';
import PageDetailSection, { LiveSwitch, RowActionsButton } from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import EcsDetailModal from '../modals/EcsDetailModal';
import { statusTag, collectIpv4FromAddresses } from '../../Hw/components/Common';
import { getToken } from '../../../../../utils/tokenStorage';

type EcsSectionAliyunProps = {
  cloudId: string;
  ecs: any[];
  onRefreshAll: () => void;
  onOpenVmDetail: (vm: any) => void;
  showLog?: boolean;
  raw?: any;
};

const EcsSectionAliyun: React.FC<EcsSectionAliyunProps> = ({ cloudId, ecs, onRefreshAll, onOpenVmDetail, showLog, raw }) => {
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
      const pubArr = r?.PublicIpAddress?.IpAddress;
      const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr.join(',') : (r?.EipAddress?.IpAddress || r?.publicIpAddress || '');
      const priArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
      const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr.join(',') : (r?.privateIpAddress || '');
      const ipText = `${pub||''} ${pri||''}`.toLowerCase();
      const okKw = !kn || nm.includes(kn);
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
      return (okKw || ipText.includes(kn)) && okSt && okZn && okCpu && okMem && okVpc;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecs, keyword, statusFilter, zoneFilter, cpuFilter, memGbFilter, vpcFilter]);

  const columns = useMemo(() => [
    { title: '实例', key: 'inst', render: (_: any, r: any) => (
      <span><Typography.Link onClick={() => { const iid = String(r?.InstanceId || r?.id || ''); if (!iid) return; setDetailInstanceId(iid); setDetailOpen(true); }} style={{ padding: 0 }}>{r?.InstanceName || r?.name || '-'}</Typography.Link><br />{r?.InstanceId || r?.id || '-'}</span>
    ) },
    { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    { title: '可用区', key: 'zone', render: (_: any, r: any) => r?.ZoneId || r?.zone || '-' },
    { title: '实例规格', key: 'spec', render: (_: any, r: any) => {
      const vcpus = String(r?.Cpu || r?.CPU || r?.flavor?.vcpus || '').trim();
      const ramMbRaw = r?.Memory ?? r?.memory;
      let ramGb = '';
      if (ramMbRaw != null) {
        const val = parseFloat(String(ramMbRaw));
        if (!isNaN(val) && val > 0) ramGb = String(Math.round((val / 1024) * 10) / 10);
      }
      const name = r?.InstanceType || r?.flavor?.name || r?.flavor?.id || '-';
      const parts: string[] = [];
      if (vcpus) parts.push(`${vcpus}vCPU`);
      if (ramGb) parts.push(`${ramGb}GB内存`);
      const line1 = parts.length ? parts.join('，') : '-';
      const line2 = `规格名称:${name || '-'}`;
      return (<span>{line1}<br />{line2}</span>);
    }, sorter: (a: any, b: any) => {
      const vA = parseInt(String(a?.Cpu ?? a?.CPU ?? 0)) || 0;
      const vB = parseInt(String(b?.Cpu ?? b?.CPU ?? 0)) || 0;
      const rAmb = parseFloat(String(a?.Memory ?? a?.memory ?? 0)) || 0;
      const rBmb = parseFloat(String(b?.Memory ?? b?.memory ?? 0)) || 0;
      const rA = Math.round((rAmb / 1024) * 10) / 10;
      const rB = Math.round((rBmb / 1024) * 10) / 10;
      if (vA !== vB) return vA - vB;
      if (rA !== rB) return rA - rB;
      const nA = String(a?.InstanceName || a?.name || a?.InstanceId || a?.id || '');
      const nB = String(b?.InstanceName || b?.name || b?.InstanceId || b?.id || '');
      return nA.localeCompare(nB);
    } },
    { title: '镜像', key: 'image', render: (_: any, r: any) => {
      const name = r?.ImageId || r?.image?.name || r?.metadata?.image_name || '-';
      return (<span>{name || '-'}</span>);
    } },
    { title: '公网/内网IP', key: 'ips', render: (_: any, r: any) => {
      let pub = '-';
      let pri = '-';
      const { fixed, floating } = collectIpv4FromAddresses(r?.addresses);
      if (Array.isArray(floating) && floating.length) pub = floating.join(', ');
      if (Array.isArray(fixed) && fixed.length) pri = fixed.join(', ');
      if (pub === '-') {
        const arr = r?.PublicIpAddress?.IpAddress;
        const eip = r?.EipAddress?.IpAddress || r?.publicIpAddress;
        const p = Array.isArray(arr) && arr.length > 0 ? arr[0] : eip;
        if (p) pub = String(p);
      }
      if (pri === '-') {
        const arr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
        const p = Array.isArray(arr) && arr.length > 0 ? arr[0] : r?.privateIpAddress;
        if (p) pri = String(p);
      }
      const bw = r?.InternetMaxBandwidthOut;
      const pubLine = bw ? `${pub || '-'} / ${bw}Mbps` : (pub || '-');
      return (<span>{`公网IP：${pubLine}`}<br />{`内网IP：${pri || '-'}`}</span>);
    } },
    { title: '创建时间', key: 'ctime', render: (_: any, r: any) => {
      const raw = r?.CreationTime || r?.created || r?.create_time || '';
      try {
        const d = new Date(raw);
        if (d && !isNaN(d.getTime())) {
          return d.toLocaleString('zh-CN', { hour12: false });
        }
      } catch {}
      return raw || '-';
    }, sorter: (a: any, b: any) => String(a?.CreationTime || a?.created || a?.create_time || '').localeCompare(String(b?.CreationTime || b?.created || b?.create_time || '')) },
    { title: '到期时间', key: 'etime', render: (_: any, r: any) => {
      const raw = r?.ExpiredTime || '';
      if (!raw) return '-';
      try {
        const d = new Date(raw);
        if (d && !isNaN(d.getTime())) {
          const now = new Date();
          const isExpired = d < now;
          // If less than 7 days, show warning color
          const diffDays = (d.getTime() - now.getTime()) / (1000 * 3600 * 24);
          const color = isExpired ? '#ff4d4f' : (diffDays < 7 ? '#faad14' : 'inherit');
          return <span style={{ color }}>{d.toLocaleString('zh-CN', { hour12: false })}</span>;
        }
      } catch {}
      return raw;
    }, sorter: (a: any, b: any) => String(a?.ExpiredTime || '').localeCompare(String(b?.ExpiredTime || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
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
            if (key === 'detail') { if (!cloudId || !iid) return; onOpenVmDetail(r); return; }
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
            if (key === 'delete') { Modal.confirm({ title: '确认删除该实例？', onOk: async ()=> { try { await deleteAliyunEcs(cloudId, iid); message.success('删除成功'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '删除失败'); } } }); return; }
          }}
        />
      );
    } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cloudId]);

  return (
    <>
      <PageDetailSection
        title={Label}
        icon={Icon}
        toolbarLeft={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={e=>setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="实例状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[
              { label: 'Running', value: 'Running' }, { label: 'Stopped', value: 'Stopped' }, { label: 'Starting', value: 'Starting' }, { label: 'Stopping', value: 'Stopping' }, { label: 'Rebooting', value: 'Rebooting' }
            ]} />
            <Select placeholder="可用区" allowClear value={zoneFilter} onChange={setZoneFilter} style={{ width: 160 }} options={[
              ...Array.from(new Set((ecs||[]).map((r:any)=> String(r?.ZoneId || r?.zone || '').trim()).filter(Boolean))).map(z=> ({ label: z, value: z }))
            ]} />
            <Select placeholder="vCPU 数量" allowClear value={cpuFilter} onChange={setCpuFilter} style={{ width: 140 }} options={[
              ...Array.from(new Set((ecs||[]).map((r:any)=> String(r?.Cpu || r?.CPU || '').trim()).filter(Boolean))).map(c=> ({ label: c, value: c }))
            ]} />
            <Select placeholder="内存容量（GB）" allowClear value={memGbFilter} onChange={setMemGbFilter} style={{ width: 160 }} options={[
              ...Array.from(new Set((ecs||[]).map((r:any)=> { const mb = parseFloat(String(r?.Memory ?? r?.memory ?? 0))||0; const gb = mb>0?Math.round(mb/1024):0; return String(gb||''); }).filter(Boolean))).map(m=> ({ label: m, value: m }))
            ]} />
            <Select placeholder="所属 VPC" allowClear value={vpcFilter} onChange={setVpcFilter} style={{ width: 200 }} options={[
              ...Array.from(new Set((ecs||[]).map((r:any)=> String(r?.VpcAttributes?.VpcId || r?.VpcId || '').trim()).filter(Boolean))).map(v=> ({ label: v, value: v }))
            ]} />
          </>
        )}
        toolbarRight={(
          <Space size={8}>
            <Button icon={<ReloadOutlined />} onClick={async ()=> { await onRefreshAll(); }}>刷新</Button>
            <LiveSwitch checked={!!live} onChange={() => toggleLive()} />
            <ResourceActionsDropdown
              items={[
                { key: 'batch_start', label: '批量启动' },
                { key: 'batch_stop', label: '批量停止' },
                { key: 'batch_reboot', label: '批量重启' },
                { key: 'batch_delete', label: '批量删除', danger: true },
              ]}
              onClick={async ({ key }: { key: string }) => {
                const targets = (ecs || []).filter((r:any)=> selectedKeys.includes(r?.InstanceId || r?.id));
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
                  await onRefreshAll();
                } catch(e:any){ message.error(e?.message || '批量操作失败'); }
              }}
            />
          </Space>
        )}
        asCard={false}
      >
      <style>{`.ecs-row-updated{animation:ecsRowBlink .8s ease-in-out 1;background:#fffbe6}@keyframes ecsRowBlink{0%{background:#fffbe6}50%{background:#fff}}`}</style>
      <Table
        bordered
        tableLayout="auto"
        rowKey={(r:any)=> r.InstanceId || r.id}
        dataSource={filteredEcs}
        columns={columns as any}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowClassName={(r:any)=> {
          const xiid = String(r?.InstanceId || r?.id || '');
          return changedIds.has(xiid) ? 'ecs-row-updated' : '';
        }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys)=> setSelectedKeys(keys),
          getCheckboxProps: (r:any)=> ({ value: r?.InstanceId || r?.id })
        }}
      />
      {!!showLog && (
        <div style={{ marginTop: 12 }}>
          <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
      <EcsDetailModal open={detailOpen} onClose={() => setDetailOpen(false)} cloudId={cloudId} instanceId={detailInstanceId} />
      </PageDetailSection>
    </>
  );
};

export const Icon = <CloudServerOutlined />;
export const Label = '云主机';
export default EcsSectionAliyun;
