import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Table, Select, Button, Dropdown, Modal, Input, Badge, message, Checkbox, Descriptions, Tag, Tabs, Tooltip } from 'antd';
import { EllipsisOutlined, ReloadOutlined, ExclamationCircleOutlined, WarningOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { getAuthHeaders } from '../../../../services/api';
import { fetchHarvesterVmDetail, detachHarvesterVolumeFromVm, fetchHarvesterVncUrl } from '../../../../services/harvesterApi';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import { isSystemNamespace, cnVmStatus } from '../../../../utils/harvesterUtils';

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
  onRefresh: (force?: boolean) => void;
  // onOpenDetail removed
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onSoftReboot?: (iid: string) => void;
  onPause?: (iid: string) => void;
  onUnpause?: (iid: string) => void;
  onDelete: (iid: string, deleteVolumes?: boolean) => void;
  images?: any[];
  namespaces?: any[];
};

const VmSection: React.FC<Props> = ({ vms, loading, namespacesOptions, nodesOptions, cloudId, nsValue, nodeValue, onNsChange, onNodeChange, onRefresh, onOpenReconfigure, onStart, onStop, onReboot, onSoftReboot, onPause, onUnpause, onDelete, images = [], namespaces = [] }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Metadata Modal State
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);
  const [metadataActiveTab, setMetadataActiveTab] = useState('detail');

  const handleShowMetadata = async (record: any, tab: string = 'detail') => {
    setCurrentMetadata(record);
    setMetadataActiveTab(tab);
    setMetadataModalVisible(true);
  };

  const getIid = (r: any): string => {
    if (r?.metadata?.name && r?.metadata?.namespace) {
      return `${r.metadata.namespace}/${r.metadata.name}`;
    }
    return String(r?.InstanceId || r?.id || '');
  };
  
  const SafeRead = {
    name: (r: any) => r?.metadata?.annotations?.['tower.io/alias'] || r?.InstanceName || r?.name || r?.metadata?.name || '', // 优先显示别名
    vmId: (r: any) => r?.metadata?.name || '', // 读取真实ID
    namespace: (r: any) => r?.metadata?.namespace || r?.namespace || '',
    tenant: (r: any) => {
      // 优先从 Namespace Annotations 获取 (tower.io/tenant)
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/tenant']) {
        return nsObj.metadata.annotations['tower.io/tenant'];
      }
      // 其次从 Extra 中获取
      return r?.Extra?.TenantName || '';
    },
    organization: (r: any) => {
      // 优先从 Namespace Annotations 获取 (tower.io/organization)
      const nsName = r?.metadata?.namespace || r?.namespace || '';
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.['tower.io/organization']) {
        return nsObj.metadata.annotations['tower.io/organization'];
      }
      // 其次从 Extra 中获取
      return r?.Extra?.OrganizationName || '';
    },
    uid: (r: any) => r?.metadata?.uid || r?.InstanceId || r?.id || '',
    status: (r: any) => {
      if (typeof r?.status === 'string') return r.status;
      return r?.status?.printableStatus || r?.status?.phase || r?.Status || 'Unknown';
    },
    node: (r: any) => r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.Extra?.NodeName || '',
    cpu: (r: any) => {
      // 优先计算完整拓扑 (cores * sockets * threads)
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu?.cores && cpu?.sockets && cpu?.threads) {
        return Number(cpu.cores) * Number(cpu.sockets) * Number(cpu.threads);
      }
      return r?.cpu || cpu?.cores || r?.vmi?.spec?.domain?.cpu?.cores || r?.Extra?.CPU;
    },
    memory: (r: any) => {
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits?.memory;
      if (lim) return lim;
      const guest = r?.spec?.template?.spec?.domain?.memory?.guest;
      if (guest) return guest;
      return r?.memoryGb || r?.vmi?.spec?.domain?.memory?.guest || r?.Extra?.Memory;
    },
    creationTimestamp: (r: any) => r?.createdAt || r?.metadata?.creationTimestamp,
    networks: (r: any) => {
      if (Array.isArray(r?.networks) && r.networks.length > 0 && typeof r.networks[0] === 'string') return r.networks;
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
    imageDisplayName: (r: any) => {
      const imgId = SafeRead.image(r);
      if (!imgId) return '';
      // Try to find in images prop
      // imgId usually is 'namespace/name' or just 'name'
      // Harvester image IDs are typically 'namespace/name'
      const found = images.find((i: any) => {
         const id = i?.metadata?.name;
         const ns = i?.metadata?.namespace;
         const fullId = `${ns}/${id}`;
         return fullId === imgId || id === imgId || i.id === imgId;
      });
      if (found) {
        // 1. 优先使用 harvesterhci.io/image-name 注解
        const imageName = found.metadata?.annotations?.['harvesterhci.io/image-name'];
        if (imageName) return imageName;

        // 2. 其次使用 field.cattle.io/displayName 注解
        const displayName = found.metadata?.annotations?.['field.cattle.io/displayName'];
        if (displayName) return displayName;
        
        // 3. 再次使用 spec.displayName
        if (found.spec?.displayName) return found.spec.displayName;
      }
      return '';
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
      if (Array.isArray(r?.ips) && r.ips.length > 0) return r.ips.join(', ');
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
      if (Array.isArray(r?.macAddresses) && r.macAddresses.length > 0) return r.macAddresses.join(', ');
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
    os: (r: any) => r?.vmi?.status?.guestOSInfo?.name || r?.vmi?.status?.guestOSInfo?.prettyName || r?.Extra?.OS || '',
    kernel: (r: any) => r?.vmi?.status?.guestOSInfo?.kernelRelease || r?.Extra?.Kernel || '',
    arch: (r: any) => r?.vmi?.status?.guestOSInfo?.architecture || r?.spec?.template?.spec?.architecture || r?.Extra?.Architecture || '',
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

  const allColumns = useMemo(() => [
        { title: '实例名称', key: 'name',  fixed: 'left' as any, ellipsis: true, render: (_: any, r: any) => {
      const text = SafeRead.name(r) || '-';
      return <span className="cell-link" onClick={() => handleShowMetadata(r, 'detail')}>{text}</span>;
    } },
    { title: '实例ID', key: 'vmId', ellipsis: true, render: (_: any, r: any) => {
      const id = SafeRead.vmId(r);
      return id ? <Tooltip title={id}>{id}</Tooltip> : '-';
    } },
    { title: '状态', key: 'status', fixed: 'left' as any, render: (_: any, r: any) => {
      const s = String(SafeRead.status(r));
      const k = s.toLowerCase();
      const status = (function(){
        if (k==='running') return 'success';
        if (k==='starting') return 'processing';
        if (k==='stopping') return 'warning';
        if (k==='terminating') return 'warning';
        if (k==='error' || k==='errorunschedulable') return 'error';
        return 'default';
      })();
      return <Badge status={status as any} text={cnVmStatus(s)} />;
    } },
    { title: '命名空间', key: 'namespace', ellipsis: true, render: (_: any, r: any) => SafeRead.namespace(r) || '-' },
    { title: '租户', key: 'tenant', ellipsis: true, render: (_: any, r: any) => SafeRead.tenant(r) || '-' },
    { title: '组织', key: 'organization', ellipsis: true, render: (_: any, r: any) => SafeRead.organization(r) },
    { title: '节点', key: 'node',  ellipsis: true, render: (_: any, r: any) => {
      const node = String(SafeRead.node(r)).trim();
      return node ? <Tag>{node}</Tag> : '-';
    } },
    { title: 'CPU', key: 'cpu',  render: (_: any, r: any) => {
      const v = SafeRead.cpu(r);
      return v ? `${v} C` : '-';
    } },
    { title: '内存', key: 'memory',  render: (_: any, r: any) => SafeRead.memory(r) || '-' },
    { title: '说明', key: 'memSpec', width: 200, ellipsis: true, render: (_: any, r: any) => SafeRead.memSpec(r) },
    { title: '镜像名称', key: 'imageName',  ellipsis: true, render: (_: any, r: any) => {
        const displayName = SafeRead.imageDisplayName(r);
        return displayName ? <Tooltip title={displayName}>{displayName}</Tooltip> : '-';
     } },
    { title: '镜像ID', key: 'image',  ellipsis: true, render: (_: any, r: any) => {
        const img = SafeRead.image(r);
        return img ? <Tooltip title={img}>{img}</Tooltip> : '-';
     } },
     { title: '镜像大小', key: 'imageSize',  render: (_: any, r: any) => SafeRead.imageSize(r) || '-' },
     { title: '操作系统', key: 'os',  ellipsis: true, render: (_: any, r: any) => SafeRead.os(r) || '-' },
    { title: 'IP地址', key: 'ip',  ellipsis: true, render: (_: any, r: any) => {
       const ip = SafeRead.ip(r);
       return ip ? <Tooltip title={ip}>{ip}</Tooltip> : '-';
    } },
    { title: 'MAC地址', key: 'mac',  ellipsis: true, render: (_: any, r: any) => {
       const mac = SafeRead.macAddress(r);
       return mac ? <Tooltip title={mac}>{mac}</Tooltip> : '-';
    } },
    { title: '存储卷', key: 'volumes',  ellipsis: true, render: (_: any, r: any) => {
       const v = SafeRead.volumes(r);
       return v ? <Tooltip title={v}>{v}</Tooltip> : '-';
    } },
    { title: '创建时间', key: 'created',  render: (_: any, r: any) => {
       const t = SafeRead.creationTimestamp(r);
       return t ? new Date(t).toLocaleString() : '-';
    } },
    { title: '操作', key: 'actions', width: 80, fixed: 'right' as const, render: (_: any, r: any) => {
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
                const j = await fetchHarvesterVncUrl(cloudId, iid);
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
              const status = String(SafeRead.status(r)).toLowerCase();
              const isRunning = status === 'running' || status === 'starting';
              const volumes = (r?.spec?.template?.spec?.volumes || []).filter((v: any) => v.persistentVolumeClaim);
              const volumeNames = volumes.map((v: any) => v.persistentVolumeClaim.claimName).join(', ');
              
              let deleteVolumes = false;
              Modal.confirm({
                title: '确认删除该实例？',
                icon: <ExclamationCircleOutlined />,
                width: 500,
                content: (
                  <div style={{ marginTop: 16 }}>
                    {isRunning && (
                      <div style={{ marginBottom: 16, color: '#ff4d4f', background: '#fff1f0', padding: '8px 12px', border: '1px solid #ffccc7', borderRadius: 4 }}>
                        <WarningOutlined style={{ marginRight: 8 }} />
                        警告：实例正在运行中。删除操作将强制终止实例。建议先停止实例。
                      </div>
                    )}
                    
                    <p>确定要永久删除实例 <b>{SafeRead.name(r)}</b> 吗？此操作不可恢复。</p>
                    
                    {volumeNames && (
                       <div style={{ marginBottom: 16, background: '#f5f5f5', padding: '8px 12px', borderRadius: 4 }}>
                         <div style={{ fontWeight: 500, marginBottom: 4 }}>关联的数据卷 (PVC):</div>
                         <div style={{ color: 'rgba(0,0,0,0.65)' }}>{volumeNames}</div>
                       </div>
                    )}

                    <div style={{ marginTop: 16 }}>
                       <Checkbox onChange={(e) => { deleteVolumes = e.target.checked; }}>同步删除关联卷 (PVC) <span style={{ color:'#999', fontSize:12 }}>(推荐)</span></Checkbox>
                    </div>
                  </div>
                ),
                okText: isRunning ? '强制删除' : '删除',
                okType: 'danger',
                onOk: () => onDelete(iid, deleteVolumes)
              });
      };

      const handleEjectCdrom = async () => {
        const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
        const cdrom = disks[0];
        if (!cdrom) return;
        Modal.confirm({
          title: '确认弹出 CD-ROM？',
          content: `即将弹出设备: ${cdrom.name}`,
          onOk: async () => {
            try {
              await detachHarvesterVolumeFromVm(cloudId, iid, { name: cdrom.name });
              message.success('已发送弹出指令');
              onRefresh();
            } catch(e:any) {
              message.error(`弹出失败: ${e.message}`);
            }
          }
        });
      };

      const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
      const isCdromBoot = disks.length > 0 && !!disks[0].cdrom;

      const statusStr = String(SafeRead.status(r)).toLowerCase();
      const isStopped = ['stopped', 'shutoff', 'down', 'offline'].includes(statusStr);

      const items: any[] = [
        // 基础操作 - 始终显示
        { key: 'detail', label: '资源详情', onClick: () => handleShowMetadata(r, 'detail') },
        { key: 'reconf', label: '资源变配', onClick: () => onOpenReconfigure(r) },
        ...(isCdromBoot ? [{ key: 'eject', label: '弹出CD-ROM', onClick: handleEjectCdrom }] : []),
        
        // WebVNC (仅在非停止状态显示)
        ...(!isStopped ? [{ key: 'webvnc', label: 'WebVNC（浏览器）', onClick: handleWebVnc }] : []),
        
        { type: 'divider' },
        
        // 电源操作 - 启动 (仅在停止状态显示)
        ...(isStopped ? [
          { key: 'start', label: '启动', onClick: () => onStart(iid) }
        ] : []),

        // 电源操作 - 停止/重启/暂停等 (仅在非停止状态显示)
        ...(!isStopped ? [
          { key: 'stop', label: '停止', onClick: () => onStop(iid) },
          { key: 'reboot', label: '重启', onClick: () => onReboot(iid) },
          { key: 'softreboot', label: '软重启', onClick: () => onSoftReboot && onSoftReboot(iid) },
          { key: 'pause', label: '暂停', onClick: () => onPause && onPause(iid) },
          { key: 'unpause', label: '恢复', onClick: () => onUnpause && onUnpause(iid) },
        ] : []),

        { type: 'divider' },
        
        // 删除 - 始终显示
        { key: 'delete', label: '删除', danger: true, onClick: handleDeleteConfirm },
      ];
      return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
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
      
      // 强制过滤系统 Namespace
      if (isSystemNamespace(ns)) return false;

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
  const [deleteVolumes, setDeleteVolumes] = useState(false);

  const batchDelete = () => {
    if (selectedKeys.length === 0) return;
    
    // Create a local variable to capture the checkbox state in the modal closure
    let batchDeleteVolumes = false;

    Modal.confirm({
      title: '确认批量删除所选实例？',
      width: 500,
      content: (
        <div>
          <p>即将删除 {selectedKeys.length} 台虚拟机。此操作不可恢复。</p>
          <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
             <Checkbox onChange={(e) => { batchDeleteVolumes = e.target.checked; }}>
               同步删除关联卷 (PVC)
             </Checkbox>
             <div style={{ color: '#999', fontSize: 12, marginLeft: 24, marginTop: 4 }}>
               注意：将删除所有关联的 DataVolume 和 PVC，数据无法找回。
             </div>
          </div>
        </div>
      ),
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const targets = (vms || []).filter((r:any)=> selectedKeys.includes(getIid(r))).map(getIid);
          const results = await Promise.all(targets.map(async (iid)=> { 
            try { 
              // Pass batchDeleteVolumes to onDelete
              await onDelete(iid, batchDeleteVolumes); 
              return { ok:true, iid }; 
            } catch(e:any){ 
              return { ok:false, iid, err:e?.message||String(e) }; 
            } 
          }));
          
          const ok = results.filter(x=>x.ok).length; 
          const fail = results.filter(x=>!x.ok);
          
          if (ok>0) message.success(`删除指令已发送: ${ok} 台`);
          if (fail.length>0) {
            console.error('Batch delete errors:', fail);
            message.error(`删除失败 ${fail.length} 台`);
          }
          
          setSelectedKeys([]);
          if (onRefresh) onRefresh(true);
          
        } catch(e:any){ 
          message.error(e?.message||'批量删除失败'); 
        }
      }
    });
  };

  const handleDeleteConfirm = (iid: string) => {
    let deleteVolumes = false;
    Modal.confirm({
      title: '确认删除云主机？',
      content: (
        <div>
          <p>确定要删除该云主机吗？此操作不可恢复。</p>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Checkbox onChange={(e) => { deleteVolumes = e.target.checked; }}>同步删除关联卷 (PVC) <span style={{ color:'#999', fontSize:12 }}>(推荐)</span></Checkbox>
            </div>
          </div>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await onDelete(iid, deleteVolumes);
        if (onRefresh) onRefresh(true);
      }
    });
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
            options={[{ value: '', label: '全部' }, ...['Running','Starting','Stopping','Terminating','Stopped','Terminated','Error','Unknown'].map(k=> ({ value: k.toLowerCase(), label: cnVmStatus(k) }))]}
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
            settingsKey="harvester_vm_table_v2"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered={true}
        rowKey={(r:any)=> getIid(r)}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys)=> setSelectedKeys(keys) }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{ size: 'small'}}
      />
      <HarvesterResourceDrawer
        open={metadataModalVisible}
        onClose={() => setMetadataModalVisible(false)}
        resourceType="VirtualMachine"
        record={currentMetadata}
        activeTab={metadataActiveTab}
        onTabChange={setMetadataActiveTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default VmSection;