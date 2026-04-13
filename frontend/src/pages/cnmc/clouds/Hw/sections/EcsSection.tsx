import React, { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import { statusTag, collectIpv4FromAddresses } from '../components/Common';
import { fetchCloudProviderEcsVncUrl, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs } from '../../../../../services/api';
import SharedToolbar from '../../../../../components/SharedToolbar';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { RowActionsButton } from '../../../../../components/PageDetailSection';

type EcsSectionProps = {
  cloudId: string;
  ecs: any[];
  onRefreshAll: () => void;
  onOpenVmDetail: (vm: any) => void;
};

const EcsSection: React.FC<EcsSectionProps> = ({ cloudId, ecs, onRefreshAll, onOpenVmDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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
    { title: '实例', key: 'inst', render: (_: any, r: any) => (
      <span>
        <Typography.Link onClick={() => { const iid = r?.id || r?.InstanceId; if (!iid) return; onOpenVmDetail(r); }} style={{ padding: 0 }}>
          {r?.name || r?.InstanceName || '-'}
        </Typography.Link>
        <br />{r?.id || r?.InstanceId || '-'}
      </span>
    ) },
    { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r?.status) },
    { title: '实例规格', key: 'spec', render: (_: any, r: any) => {
      const vcpus = String(r?.flavor?.vcpus || r?.flavor?.Vcpus || r?.vcpus || r?.Cpu || r?.CPU || '').trim();
      const ramMbRaw = r?.flavor?.ram ?? r?.flavor?.Ram ?? r?.ram ?? r?.MemoryMB ?? r?.memoryMB ?? r?.memory_mb;
      let ramGb = '';
      if (ramMbRaw != null) {
        const val = parseFloat(String(ramMbRaw));
        if (!isNaN(val) && val > 0) ramGb = String(Math.max(0, Math.round(val / 1024)));
      } else {
        const ramGbRaw = r?.Memory ?? r?.memory;
        if (ramGbRaw != null) {
          const val = parseFloat(String(ramGbRaw));
          if (!isNaN(val) && val > 0) ramGb = String(Math.max(0, Math.round(val)));
        } else {
          const ex = r?.flavor?.extra_specs;
          const hw = ex && (ex['hw:mem_size'] || ex['mem_size'] || ex['memory']);
          if (hw != null) {
            const val = parseFloat(String(hw));
            if (!isNaN(val) && val > 0) ramGb = String(Math.max(0, Math.round(val / 1024)));
          }
        }
      }
      const name = r?.flavor?.id || r?.flavor?.original_name || r?.flavor?.name || r?.InstanceType || '-';
      const parts: string[] = [];
      if (vcpus) parts.push(`${vcpus}vCPU`);
      if (ramGb) parts.push(`${ramGb}GB内存`);
      const line1 = parts.length ? parts.join('，') : '-';
      const line2 = `规格名称:${name || '-'}`;
      return (<span>{line1}<br />{line2}</span>);
    }, sorter: (a: any, b: any) => {
      const vA = parseInt(String(a?.flavor?.vcpus ?? a?.vcpus ?? a?.Cpu ?? a?.CPU ?? 0)) || 0;
      const vB = parseInt(String(b?.flavor?.vcpus ?? b?.vcpus ?? b?.Cpu ?? b?.CPU ?? 0)) || 0;
      const rA = parseFloat(String(a?.flavor?.ram ?? a?.flavor?.Ram ?? a?.ram ?? a?.MemoryMB ?? a?.memoryMB ?? a?.memory_mb ?? (typeof a?.Memory === 'number' ? a?.Memory * 1024 : a?.Memory ?? 0))) || 0;
      const rB = parseFloat(String(b?.flavor?.ram ?? b?.flavor?.Ram ?? b?.ram ?? b?.MemoryMB ?? b?.memoryMB ?? b?.memory_mb ?? (typeof b?.Memory === 'number' ? b?.Memory * 1024 : b?.Memory ?? 0))) || 0;
      if (vA !== vB) return vA - vB;
      return rA - rB;
    } },
    { title: '镜像', key: 'image', render: (_: any, r: any) => {
      const name = r?.metadata?.image_name || r?.image?.name || '-';
      const osType = r?.metadata?.os_type || r?.osType || '';
      const osBit = r?.metadata?.os_bit || r?.osBit || '';
      const osLine = (osType || osBit) ? `（${osType || '-'} ${osBit ? `${osBit}位` : ''}`.replace(/\s+\)/, ' )') + ')' : '';
      return (<span>{`${name}${osLine || ''}` || '-'}</span>);
    }, sorter: (a: any, b: any) => String(a?.metadata?.image_name || a?.image?.name || '').localeCompare(String(b?.metadata?.image_name || b?.image?.name || '')) },
    { title: '公网/内网IP', key: 'ips', render: (_: any, r: any) => {
      const { fixed, floating } = collectIpv4FromAddresses(r?.addresses);
      const pub = (floating.length ? floating.join(', ') : '-') || '-';
      const pri = (fixed.length ? fixed.join(', ') : '-') || '-';
      return (<span>{`公网IP：${pub}`}<br />{`内网IP：${pri}`}</span>);
    } },
    { title: '创建时间', key: 'ctime', render: (_: any, r: any) => {
      const raw = r?.created || r?.create_time || r?.CreationTime || '';
      try {
        const d = new Date(raw);
        if (d && !isNaN(d.getTime())) {
          return d.toLocaleString('zh-CN', { hour12: false });
        }
      } catch {}
      return raw || '-';
    } },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
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
            if (key === 'detail') {
              if (!cloudId || !iid) return;
              onOpenVmDetail(r);
              return;
            }
            if (key === 'webvnc') {
              try {
                const json = await fetchCloudProviderEcsVncUrl(cloudId, iid);
                const url = json?.data?.VncUrl || json?.data?.vncUrl;
                if (url) {
                  const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                  const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                  const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                  window.open(url, 'webvnc', features);
                } else { message.warning('未获取到VNC地址'); }
              } catch (e: any) { message.error(e?.message || '获取VNC地址失败'); }
              return;
            }
            if (key === 'start') { try { await startCloudProviderEcs(cloudId, iid); message.success('启动指令已下发'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '启动失败'); } return; }
            if (key === 'stop') { try { await stopCloudProviderEcs(cloudId, iid, false); message.success('停止指令已下发'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '停止失败'); } return; }
            if (key === 'reboot') { try { await rebootCloudProviderEcs(cloudId, iid, false); message.success('重启指令已下发'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '重启失败'); } return; }
            if (key === 'delete') { Modal.confirm({ title: '确认删除该实例？', onOk: async ()=> { try { await deleteCloudProviderEcs(cloudId, iid); message.success('删除成功'); await onRefreshAll(); } catch(e:any){ message.error(e?.message || '删除失败'); } } }); return; }
          }}
        />
      );
    } },
  ], [cloudId, onOpenVmDetail, onRefreshAll]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={e=>setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[
              { label: 'ACTIVE', value: 'ACTIVE' }, { label: 'SHUTOFF', value: 'SHUTOFF' }, { label: 'ERROR', value: 'ERROR' }
            ]} />
          </>
        )}
        right={(
          <>
            <ResourceActionsDropdown
              items={[{ key: 'refresh', label: '刷新' }]}
              onClick={async ({ key }) => {
                if (key === 'refresh') { await onRefreshAll(); }
              }}
            />
          </>
        )}
      />
      <Table bordered tableLayout="auto" rowKey={(r:any)=> r.id || r.InstanceId} dataSource={filteredEcs} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <CloudServerOutlined />;
export const Label = '云主机';
export default EcsSection;
