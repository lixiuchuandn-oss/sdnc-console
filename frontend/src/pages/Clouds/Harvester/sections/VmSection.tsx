import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Table, Select, Button, Dropdown, Modal, Input, Badge, message, Checkbox, Descriptions, Tag, Tabs, Tooltip } from 'antd';
import { EllipsisOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchCloudProviderEcsVncUrl, getAuthHeaders, fetchHarvesterVmDetail } from '../../../../services/api';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

type Props = {
  vms: any[];
  loading: boolean;
  namespacesOptions: string[];
  nodesOptions: string[];
  cloudId: string;
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;
  onRefresh: () => void;
  // onOpenDetail removed
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onSoftReboot?: (iid: string) => void;
  onPause?: (iid: string) => void;
  onUnpause?: (iid: string) => void;
  onDelete: (iid: string, deleteImage?: boolean) => void;
};

const VmSection: React.FC<Props> = ({ vms, loading, namespacesOptions, nodesOptions, cloudId, nsValue, nodeValue, onNsChange, onNodeChange, onRefresh, onOpenReconfigure, onStart, onStop, onReboot, onSoftReboot, onPause, onUnpause, onDelete }) => {
  const cnVmStatus = (v?: string): string => {
    const k = String(v || '').toLowerCase();
    const m: Record<string, string> = {
      running: '运行中',
      starting: '启动中',
      stopping: '停止中',
      stopped: '已停止',
      terminated: '已删除',
      error: '错误',
      unknown: '未知'
    };
    return m[k] || (v || '-');
  };
  const navigate = useNavigate();
  const location = useLocation();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Metadata Modal State
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);
  const [fullJson, setFullJson] = useState<any>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataActiveTab, setMetadataActiveTab] = useState('detail');

  const handleShowMetadata = async (record: any, tab: string = 'detail') => {
    setCurrentMetadata(record);
    setFullJson(null);
    setMetadataActiveTab(tab);
    setMetadataModalVisible(true);

    const ns = record?.metadata?.namespace;
    const name = record?.metadata?.name;

    if (ns && name) {
      setMetadataLoading(true);
      try {
        // Use backend proxy instead of direct fetch to avoid CORS/network issues with internal IPs
        const json = await fetchHarvesterVmDetail(cloudId, ns, name);
        // Normalize response: backend might wrap result in { data: ... }
        const data = (json as any)?.data || json;
        setFullJson(data);
      } catch (e: any) {
        console.error(e);
        message.error(`获取完整数据出错: ${e.message}`);
      } finally {
        setMetadataLoading(false);
      }
    } else if (record?.links?.view) {
      // Fallback to direct link if namespace/name missing (unlikely for Harvester)
      setMetadataLoading(true);
      try {
        const res = await fetch(record.links.view, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const json = await res.json();
          setFullJson(json);
        } else {
          message.error(`获取完整数据失败: ${res.status} ${res.statusText}`);
        }
      } catch (e: any) {
        console.error(e);
        message.error(`获取完整数据出错: ${e.message}`);
      } finally {
        setMetadataLoading(false);
      }
    }
  };

  const getIid = (r: any): string => {
    if (r?.metadata?.name && r?.metadata?.namespace) {
      return `${r.metadata.namespace}/${r.metadata.name}`;
    }
    return String(r?.InstanceId || r?.id || '');
  };
  
  const SafeRead = {
    name: (r: any) => r?.metadata?.name || r?.InstanceName || r?.name || '',
    namespace: (r: any) => r?.metadata?.namespace || r?.namespace || '',
    uid: (r: any) => r?.metadata?.uid || r?.InstanceId || r?.id || '',
    status: (r: any) => r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown',
    node: (r: any) => r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.Extra?.NodeName || '',
    cpu: (r: any) => r?.spec?.template?.spec?.domain?.cpu?.cores || r?.vmi?.spec?.domain?.cpu?.cores || r?.Extra?.CPU,
    memory: (r: any) => r?.spec?.template?.spec?.domain?.memory?.guest || r?.vmi?.spec?.domain?.memory?.guest || r?.Extra?.Memory,
    creationTimestamp: (r: any) => r?.metadata?.creationTimestamp,
    networks: (r: any) => {
      const nets = r?.spec?.template?.spec?.networks || r?.vmi?.spec?.networks || [];
      const list = nets.map((n: any) => `${n.name} (${n.multus?.networkName || 'default'})`);
      if (list.length > 0) return list;
      return Array.isArray(r?.Extra?.Networks) ? r.Extra.Networks : [];
    },
    image: (r: any) => {
      try {
        const annot = r?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (annot) {
          const arr = JSON.parse(annot);
          for (const item of arr) {
            const img = item?.metadata?.annotations?.['harvesterhci.io/imageId'];
            if (img) return img;
          }
        }
      } catch (e) {}
      return r?.Extra?.Image || '';
    },
    imageSize: (r: any) => {
      try {
        const annot = r?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (annot) {
          const arr = JSON.parse(annot);
          for (const item of arr) {
            const img = item?.metadata?.annotations?.['harvesterhci.io/imageId'];
            if (img) {
                return item?.spec?.resources?.requests?.storage || '';
            }
          }
        }
      } catch (e) {}
      return '';
    },
    ip: (r: any) => {
      try {
        const annot = r?.metadata?.annotations?.['network.harvesterhci.io/ips'];
        if (annot) {
          const arr = JSON.parse(annot);
          if (Array.isArray(arr) && arr.length > 0) return arr.join(', ');
        }
        if (r?.vmi?.status?.interfaces) {
          const ips = r.vmi.status.interfaces.flatMap((i:any) => i.ipAddress || i.ipAddresses || []).filter(Boolean);
          if (ips.length > 0) return ips.join(', ');
        }
      } catch (e) {}
      return '';
    },
    macAddress: (r: any) => {
      try {
        if (r?.status?.interfaces && r.status.interfaces.length > 0) {
          const macs = r.status.interfaces.map((i:any) => i.mac).filter(Boolean);
          if (macs.length > 0) return macs.join(', ');
        }
        const annot = r?.metadata?.annotations?.['harvesterhci.io/mac-address'];
        if (annot) {
          const json = JSON.parse(annot);
          return Object.values(json).join(', ');
        }
      } catch (e) {}
      return '';
    },
    os: (r: any) => r?.metadata?.labels?.['harvesterhci.io/os'] || '',
    arch: (r: any) => r?.spec?.template?.spec?.architecture || '',
    hostname: (r: any) => r?.spec?.template?.spec?.hostname || '',
    evictionStrategy: (r: any) => r?.spec?.evictionStrategy || r?.spec?.template?.spec?.evictionStrategy || '',
    runStrategy: (r: any) => r?.spec?.runStrategy || '',
    cpuSpec: (r: any) => {
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu) return `${cpu.cores} Cores, ${cpu.sockets} Sockets, ${cpu.threads} Threads`;
      return '';
    },
    memSpec: (r: any) => {
        const req = r?.spec?.template?.spec?.domain?.resources?.requests;
        const lim = r?.spec?.template?.spec?.domain?.resources?.limits;
        return `Request: ${req?.memory || '-'} / Limit: ${lim?.memory || '-'}`;
    },
    disks: (r: any) => {
        const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
        return disks.map((d: any) => `${d.name} (${d.disk?.bus || '-'})`).join(', ');
    },
    volumes: (r: any) => {
        const vols = r?.spec?.template?.spec?.volumes || [];
        return vols.map((v: any) => {
            if (v.persistentVolumeClaim) return `${v.name} (PVC: ${v.persistentVolumeClaim.claimName})`;
            if (v.cloudInitNoCloud) return `${v.name} (CloudInit)`;
            return v.name;
        }).join('; ');
    },
    interfaces: (r: any) => {
        const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
        return ifaces.map((i: any) => `${i.name} (${i.model || '-'})`).join(', ');
    },
    gpus: (r: any) => {
        const gpus = r?.spec?.template?.spec?.domain?.devices?.gpus || [];
        return gpus.map((g: any) => g.name).join(', ');
    },
    usb: (r: any) => {
        const hostDevices = r?.spec?.template?.spec?.domain?.devices?.hostDevices || [];
        const usb = hostDevices.filter((d: any) => {
            const n = String(d?.name || '').toLowerCase();
            const dn = String(d?.deviceName || '').toLowerCase();
            return n.startsWith('usb') || dn.includes('usb');
        });
        return usb.map((u: any) => u.name).join(', ');
    }
  };

  const renderDetail = (r: any) => {
    if (!r) return null;
    return (
      <Descriptions bordered column={1} size="small" contentStyle={{ whiteSpace: 'pre-wrap' }}>
        <Descriptions.Item label="名称">{SafeRead.name(r)}</Descriptions.Item>
        <Descriptions.Item label="命名空间">{SafeRead.namespace(r)}</Descriptions.Item>
        <Descriptions.Item label="状态">{cnVmStatus(String(SafeRead.status(r)))}</Descriptions.Item>
        <Descriptions.Item label="IP地址">{SafeRead.ip(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="MAC地址">{SafeRead.macAddress(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="镜像">{SafeRead.image(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="镜像大小">{SafeRead.imageSize(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="操作系统">{SafeRead.os(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="架构">{SafeRead.arch(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="主机名">{SafeRead.hostname(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="驱逐策略">{SafeRead.evictionStrategy(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="运行策略">{SafeRead.runStrategy(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="CPU规格">{SafeRead.cpuSpec(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="内存规格">{SafeRead.memSpec(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="磁盘">{SafeRead.disks(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="存储卷">{SafeRead.volumes(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="网卡">{SafeRead.interfaces(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="网络">{SafeRead.networks(r).join('; ') || '-'}</Descriptions.Item>
        <Descriptions.Item label="GPU">{SafeRead.gpus(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="USB设备">{SafeRead.usb(r) || '-'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{SafeRead.creationTimestamp(r) || '-'}</Descriptions.Item>
      </Descriptions>
    );
  };

  const allColumns = useMemo(() => [
        { title: '实例名称', key: 'name', width: 220, fixed: 'left' as any, ellipsis: true, render: (_: any, r: any) => {
      const text = SafeRead.name(r) || '-';
      return <span className="cell-link" onClick={() => handleShowMetadata(r, 'detail')}>{text}</span>;
    } },
    { title: '状态', key: 'status', width: 100, fixed: 'left' as any, render: (_: any, r: any) => {
      const s = String(SafeRead.status(r));
      const k = s.toLowerCase();
      const status = (function(){
        if (k==='running') return 'success';
        if (k==='starting') return 'processing';
        if (k==='stopping') return 'warning';
        if (k==='error') return 'error';
        return 'default';
      })();
      return <Badge status={status as any} text={cnVmStatus(s)} />;
    } },
    { title: '节点', key: 'node', width: 120, ellipsis: true, render: (_: any, r: any) => {
      const node = String(SafeRead.node(r)).trim();
      return node ? <Tag>{node}</Tag> : '-';
    } },
    { title: 'CPU', key: 'cpu', width: 80, render: (_: any, r: any) => {
      const v = SafeRead.cpu(r);
      return v ? `${v} C` : '-';
    } },
    { title: '内存', key: 'memory', width: 100, render: (_: any, r: any) => SafeRead.memory(r) || '-' },
    { title: '镜像', key: 'image', width: 200, ellipsis: true, render: (_: any, r: any) => {
        const img = SafeRead.image(r);
        return img ? <Tooltip title={img}>{img}</Tooltip> : '-';
     } },
     { title: '镜像大小', key: 'imageSize', width: 100, render: (_: any, r: any) => SafeRead.imageSize(r) || '-' },
     { title: '操作系统', key: 'os', width: 120, ellipsis: true, render: (_: any, r: any) => SafeRead.os(r) || '-' },
    { title: 'IP地址', key: 'ip', width: 140, ellipsis: true, render: (_: any, r: any) => {
       const ip = SafeRead.ip(r);
       return ip ? <Tooltip title={ip}>{ip}</Tooltip> : '-';
    } },
    { title: 'MAC地址', key: 'mac', width: 160, ellipsis: true, render: (_: any, r: any) => {
       const mac = SafeRead.macAddress(r);
       return mac ? <Tooltip title={mac}>{mac}</Tooltip> : '-';
    } },
    { title: '存储卷', key: 'volumes', width: 200, ellipsis: true, render: (_: any, r: any) => {
       const v = SafeRead.volumes(r);
       return v ? <Tooltip title={v}>{v}</Tooltip> : '-';
    } },
    { title: '创建时间', key: 'created', width: 170, render: (_: any, r: any) => {
       const t = SafeRead.creationTimestamp(r);
       return t ? new Date(t).toLocaleString() : '-';
    } },
    { title: '操作', key: 'actions', width: 60, fixed: 'right' as any, render: (_: any, r: any) => {
      const iid = getIid(r);
      
      const handleWebVnc = async () => {
              try {
                if (iid.includes('/')) {
                  const ns = iid.split('/')[0];
                  const name = iid.split('/')[1];
                  const url = `/clouds/${cloudId}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`;
                  // Open in a new tab instead of a popup window
                  window.open(url, '_blank');
                  return;
                }
                const j = await fetchCloudProviderEcsVncUrl(cloudId, iid);
                const url = j?.data?.VncUrl || j?.data?.vncUrl || j?.data?.url;
                if (url) {
                  // Open in a new tab instead of a popup window
                  window.open(url, '_blank');
                  return;
                }
                message.warning('该实例暂不支持 VNC');
                return;
              } catch (e:any) {
                message.error(e?.message || '获取VNC地址失败');
                return;
              }
      };

      const handleDeleteConfirm = () => {
              let deleteImage = false;
              Modal.confirm({
                title: '确认删除该实例？',
                content: (
                  <div>
                    <p>删除后不可恢复。</p>
                    <Checkbox onChange={(e) => { deleteImage = e.target.checked; }}>同步删除关联镜像</Checkbox>
                  </div>
                ),
                onOk: () => onDelete(iid, deleteImage)
              });
      };

      const items: any[] = [
        { key: 'metadata', label: '查看数据', onClick: () => handleShowMetadata(r) },
        { key: 'reconf', label: '资源变配', onClick: () => onOpenReconfigure(r) },
        { key: 'webvnc', label: 'WebVNC（浏览器）', onClick: handleWebVnc },
        { type: 'divider' },
        { key: 'start', label: '启动', onClick: () => onStart(iid) },
        { key: 'stop', label: '停止', onClick: () => onStop(iid) },
        { key: 'reboot', label: '重启', onClick: () => onReboot(iid) },
        { key: 'softreboot', label: '软重启', onClick: () => onSoftReboot && onSoftReboot(iid) },
        { key: 'pause', label: '暂停', onClick: () => onPause && onPause(iid) },
        { key: 'unpause', label: '恢复', onClick: () => onUnpause && onUnpause(iid) },
        { type: 'divider' },
        { key: 'delete', label: '删除', danger: true, onClick: handleDeleteConfirm },
      ];
      return <ResourceActionsDropdown items={items} />;
    } },
  ], [cloudId, navigate, handleShowMetadata, onOpenReconfigure, onStart, onStop, onReboot, onSoftReboot, onPause, onUnpause, onDelete]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    return (vms || []).filter((r: any) => {
      const iid = getIid(r);
      const name = String(SafeRead.name(r)).toLowerCase();
      const ns = SafeRead.namespace(r) || (iid.includes('/') ? iid.split('/')[0] : '');
      const node = String(SafeRead.node(r));
      const sKey = String(SafeRead.status(r)).toLowerCase();
      
      if (nsValue && ns !== nsValue) return false;
      if (nodeValue && node !== nodeValue) return false;
      if (kw && !(iid.toLowerCase().includes(kw) || name.includes(kw))) return false;
      if (st && sKey !== st) return false;
      return true;
    });
  }, [vms, nsValue, nodeValue, keyword, statusFilter]);

  const batchStop = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r))).map(getIid);
      const results = await Promise.all(targets.map(async (iid)=> { try { await onStop(iid); return { ok:true, iid }; } catch(e:any){ return { ok:false, iid, err:e?.message||String(e) }; } }));
      const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
      if (ok>0) message.success(`停止成功 ${ok} 台`);
      if (fail.length>0) message.error(`停止失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
      setSelectedKeys([]);
    } catch(e:any){ message.error(e?.message||'批量停止失败'); }
  };
  const batchReboot = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r))).map(getIid);
      const results = await Promise.all(targets.map(async (iid)=> { try { await onReboot(iid); return { ok:true, iid }; } catch(e:any){ return { ok:false, iid, err:e?.message||String(e) }; } }));
      const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
      if (ok>0) message.success(`重启成功 ${ok} 台`);
      if (fail.length>0) message.error(`重启失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
      setSelectedKeys([]);
    } catch(e:any){ message.error(e?.message||'批量重启失败'); }
  };
  const batchDelete = async () => {
    if (selectedKeys.length === 0) return;
    Modal.confirm({ title:'确认批量删除所选实例？', onOk: async ()=>{
      try {
        const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r))).map(getIid);
        const results = await Promise.all(targets.map(async (iid)=> { try { await onDelete(iid); return { ok:true, iid }; } catch(e:any){ return { ok:false, iid, err:e?.message||String(e) }; } }));
        const ok = results.filter(x=>x.ok).length; const fail = results.filter(x=>!x.ok);
        if (ok>0) message.success(`删除成功 ${ok} 台`);
        if (fail.length>0) message.error(`删除失败 ${fail.length} 台：${fail.map(f=>f.iid).join(', ')}`);
        setSelectedKeys([]);
        
      } catch(e:any){ message.error(e?.message||'批量删除失败'); }
    } });
  };
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" className="toolbar-search" value={keyword} onChange={(e)=> setKeyword(e.target.value)} />
          <Select
            className="toolbar-filter"
            placeholder="命名空间"
            value={nsValue || undefined}
            onChange={(v)=> onNsChange(v || undefined)}
            allowClear
            options={namespacesOptions.map(ns=> ({ value: ns, label: ns }))}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="节点"
            value={nodeValue || undefined}
            onChange={(v)=> onNodeChange(v || undefined)}
            allowClear
            options={nodesOptions.map(n=> ({ value: n, label: n }))}
          />
          <Select
            className="toolbar-filter-sm"
            placeholder="云主机状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            allowClear
            options={[{ value: '', label: '全部' }, ...['Running','Starting','Stopping','Stopped','Terminated','Error','Unknown'].map(k=> ({ value: k.toLowerCase(), label: (function(){ const m:any={ running:'运行中', starting:'启动中', stopping:'停止中', stopped:'已停止', terminated:'已删除', error:'错误', unknown:'未知' }; return m[k.toLowerCase()] || k; })() }))]}
          />
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => navigate(`/clouds/${cloudId}/instances/create`, { state: { backgroundLocation: location } })}>创建实例</Button>
          <Dropdown
            menu={{
              items: [
                { key:'batchStop', label:'批量停止', disabled: selectedKeys.length===0 },
                { key:'batchReboot', label:'批量重启', disabled: selectedKeys.length===0 },
                { type: 'divider' },
                { key:'batchDelete', label:<span style={{ color:'#ff4d4f' }}>批量删除</span>, disabled: selectedKeys.length===0 },
              ],
              onClick: ({ key }) => { if (key==='batchStop') batchStop(); if (key==='batchReboot') batchReboot(); if (key==='batchDelete') batchDelete(); },
            }}
          >
            <Button icon={<EllipsisOutlined />}></Button>
          </Dropdown>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_vm_table"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r:any)=> r.InstanceId || r.id}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys)=> setSelectedKeys(keys) }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{ size: 'small', showSizeChanger:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
      />
      <HarvesterResourceDrawer
        open={metadataModalVisible}
        onClose={() => setMetadataModalVisible(false)}
        record={currentMetadata}
        resource={fullJson}
        loading={metadataLoading}
        activeTab={metadataActiveTab}
        onTabChange={setMetadataActiveTab}
        renderDetail={renderDetail}
      />
    </PageDetailSection>
  );
};

export default VmSection;
