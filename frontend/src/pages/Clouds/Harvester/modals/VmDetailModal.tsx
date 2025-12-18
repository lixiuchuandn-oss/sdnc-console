import React from 'react';
import { App, Modal, Descriptions, Alert, Space, Button, Tabs, Table, Tag, Popover, Checkbox } from 'antd';
import { parseSizeToGi } from './VmWizardUtils';
import { DesktopOutlined, PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, DeleteOutlined, NodeIndexOutlined, HddOutlined, LineChartOutlined, SettingOutlined } from '@ant-design/icons';
import { startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs, fetchHarvesterVmVncUrl } from '../../../../services/api';

type Props = {
  open: boolean;
  cloudId: string;
  vm: any | null;
  volumes?: any[];
  onClose: () => void;
  onRefreshAll?: () => Promise<void> | void;
};

const VmDetailModal: React.FC<Props> = ({ open, cloudId, vm, volumes, onClose, onRefreshAll }) => {
  const { message } = App.useApp();
  const stText = String(vm?.status?.printableStatus || vm?.status?.phase || '').toUpperCase();
  const isRunning = stText.includes('RUN');
  const isStopped = stText.includes('STOP') || stText.includes('HALT') || stText.includes('OFF');
  const isBusy = stText.includes('SCHED') || stText.includes('PENDING') || stText.includes('REBOOT') || stText.includes('PROVISION') || stText.includes('CREAT') || stText.includes('DELET');
  const iid = (() => { const ns = vm?.metadata?.namespace || ''; const name = vm?.metadata?.name || ''; return ns && name ? `${ns}/${name}` : ''; })();
  const vcpu = (() => {
    const cpu = vm?.spec?.template?.spec?.domain?.cpu || {};
    const sockets = parseInt(String(cpu?.sockets ?? 0)) || 0;
    const cores = parseInt(String(cpu?.cores ?? 0)) || 0;
    const threads = parseInt(String(cpu?.threads ?? 0)) || 0;
    const total = sockets && cores ? (sockets * (cores || 1) * (threads || 1)) : (cores || 0);
    return total || '-';
  })();
  const memGb = (() => {
    const raw = String(vm?.spec?.template?.spec?.domain?.resources?.requests?.memory || vm?.spec?.template?.spec?.domain?.memory?.guest || '').toUpperCase();
    const num = parseInt(raw.replace(/[^0-9]/g, '')) || 0;
    if (!raw) return '-';
    if (raw.endsWith('KI')) return `${Math.round(num / (1024 * 1024))}GB`;
    if (raw.endsWith('MI')) return `${Math.round(num / 1024)}GB`;
    if (raw.endsWith('GI')) return `${num}GB`;
    if (raw.endsWith('TI')) return `${num * 1024}GB`;
    return `${Math.round(num / (1024 * 1024 * 1024))}GB`;
  })();
  const nets = Array.isArray(vm?.spec?.template?.spec?.networks) ? vm!.spec!.template!.spec!.networks : [];
  const ifs = Array.isArray(vm?.spec?.template?.spec?.interfaces) ? vm!.spec!.template!.spec!.interfaces : [];
  const vols = Array.isArray(vm?.spec?.template?.spec?.volumes) ? vm!.spec!.template!.spec!.volumes : [];
  const disks = Array.isArray(vm?.spec?.template?.spec?.domain?.devices?.disks) ? vm!.spec!.template!.spec!.domain!.devices!.disks : [];
  const gpus = Array.isArray(vm?.spec?.template?.spec?.domain?.devices?.gpus) ? vm!.spec!.template!.spec!.domain!.devices!.gpus : [];
  const hostDevices = Array.isArray(vm?.spec?.template?.spec?.domain?.devices?.hostDevices) ? vm!.spec!.template!.spec!.domain!.devices!.hostDevices : [];
  const usbDevs = hostDevices.filter((d: any) => {
    const n = String(d?.name || '').toLowerCase();
    const dn = String(d?.deviceName || '').toLowerCase();
    return n.startsWith('usb') || dn.includes('usb');
  });
  const cloudInitUserData = (() => { const v = vols.find((x:any)=> !!x?.cloudInitNoCloud)?.cloudInitNoCloud?.userData; return typeof v === 'string' ? v : ''; })();
  const findVolDetail = (r: any) => {
    const claim = String(r?.persistentVolumeClaim?.claimName || '').trim();
    const ns = String(vm?.metadata?.namespace || '').trim();
    const list = Array.isArray(volumes) ? volumes : [];
    if (!claim) return null;
    return list.find((x: any) => String(x?.pvcName || x?.name || '').split('/').pop() === claim && (String(x?.namespace || x?.metadata?.namespace || '') === ns || !String(x?.namespace || x?.metadata?.namespace || '')));
  };
  const sizeText = (det: any): string => {
    const raw = det?.size ?? det?.status?.capacity?.storage ?? det?.spec?.resources?.requests?.storage;
    const gi = parseSizeToGi(raw);
    return gi > 0 ? `${gi} GiB` : '-';
  };
  const statusBadge = (det: any) => {
    const k = String(det?.state || det?.status?.phase || det?.status?.status || '').toLowerCase();
    const txt = (function(){
      const m: any = { healthy:'健康', degraded:'降级', faulted:'故障', unknown:'未知', detached:'已卸载', attaching:'使用中', attached:'使用中', detaching:'卸载中', maintenance:'维护', restoring:'恢复中', creating:'创建中', deleting:'删除中', error:'错误', bound:'已绑定', pending:'待创建' };
      return m[k] || (det?.state || det?.status?.phase || det?.status?.status || '-')
    })();
    const color = (function(){
      if (k==='healthy' || k==='attached' || k==='bound') return 'green';
      if (k==='degraded' || k.includes('attach') || k.includes('restor') || k==='creating' || k==='deleting' || k==='pending') return 'blue';
      if (k==='faulted' || k==='error') return 'red';
      return undefined;
    })();
    return <Tag color={color}>{txt}</Tag>;
  };
  const [activeTabKey, setActiveTabKey] = React.useState<string>('backup');
  const [visibleCols, setVisibleCols] = React.useState<Record<string, string[]>>({
    backup: ['name','type','resource','state','size','sc','am','vmode','bus','boot'],
    network: ['name','model','mode','net'],
    gpus: ['name','deviceName'],
    usb: ['name','deviceName']
  });
  const diskColumnsBase: any[] = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', key: 'type', render: (_: any, r: any) => (r?.dataVolume ? 'DataVolume' : (r?.persistentVolumeClaim ? 'PVC' : (r?.cloudInitNoCloud ? 'CloudInit' : (r?.containerDisk ? 'ContainerImage' : '-')))) },
    { title: '关联资源', key: 'resource', render: (_: any, r: any) => (r?.dataVolume?.name || r?.persistentVolumeClaim?.claimName || r?.containerDisk?.image || '-') },
    { title: '状态', key: 'state', render: (_: any, r: any) => { const d = findVolDetail(r); return d ? statusBadge(d) : '-'; } },
    { title: '容量', key: 'size', render: (_: any, r: any) => { const d = findVolDetail(r); return d ? sizeText(d) : '-'; } },
    { title: '存储类', key: 'sc', render: (_: any, r: any) => { const d = findVolDetail(r); return d?.storageClassName || d?.spec?.storageClassName || '-'; } },
    { title: '访问模式', key: 'am', render: (_: any, r: any) => { const d = findVolDetail(r); const arr = Array.isArray(d?.accessModes) ? d?.accessModes : (Array.isArray(d?.spec?.accessModes) ? d?.spec?.accessModes : []); return arr.length ? arr.join(',') : '-'; } },
    { title: '卷类型', key: 'vmode', render: (_: any, r: any) => { const d = findVolDetail(r); return d?.volumeMode || d?.spec?.volumeMode || '-'; } },
    { title: '总线类型', key: 'bus', render: (_: any, r: any) => { const d = (disks || []).find((x: any) => String(x?.name || '') === String(r?.name || '')); return d?.bus || d?.disk?.bus || d?.cdrom?.bus || '-'; } },
    { title: '引导顺序', key: 'boot', render: (_: any, r: any) => { const d = (disks || []).find((x: any) => String(x?.name || '') === String(r?.name || '')); return typeof d?.bootOrder === 'number' ? String(d?.bootOrder) : '-'; } },
  ];
  const netColumnsBase: any[] = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '模型', dataIndex: 'model', key: 'model' },
    { title: '模式', key: 'mode', render: (_: any, r: any) => (r?.masquerade ? 'masquerade' : (r?.bridge ? 'bridge' : 'pod')) },
    { title: '网络', key: 'net', render: (_: any, r: any) => { const it = (nets || []).find((n: any) => String(n?.name || '') === String(r?.name || '')); const nad = it?.multus?.networkName || it?.pod || '-'; return nad || '-'; } },
  ];
  const gpuColumnsBase: any[] = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '设备名', dataIndex: 'deviceName', key: 'deviceName' },
  ];
  const usbColumnsBase: any[] = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '设备名', dataIndex: 'deviceName', key: 'deviceName' },
  ];
  const filterCols = (base: any[], keys: string[]) => base.filter((c:any)=> keys.includes(String(c.key)));
  const diskColumns = filterCols(diskColumnsBase, visibleCols.backup);
  const netColumns = filterCols(netColumnsBase, visibleCols.network);
  const gpuColumns = filterCols(gpuColumnsBase, visibleCols.gpus);
  const usbColumns = filterCols(usbColumnsBase, visibleCols.usb);
  const currentCols = (function(){ if (activeTabKey==='backup') return diskColumnsBase; if (activeTabKey==='network') return netColumnsBase; if (activeTabKey==='gpus') return gpuColumnsBase; return usbColumnsBase; })();
  const currentVisibleKeys = visibleCols[activeTabKey] || [];
  const onToggleCol = (key: string, checked: boolean) => {
    const prev = visibleCols[activeTabKey] || [];
    const next = checked ? Array.from(new Set([...prev, key])) : prev.filter(k=>k!==key);
    setVisibleCols({ ...visibleCols, [activeTabKey]: next });
  };
  const extra = (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={(
        <div style={{ minWidth: 200 }}>
          {(currentCols || []).map((c:any)=> (
            <div key={String(c.key)} style={{ padding: '4px 0' }}>
              <Checkbox
                checked={currentVisibleKeys.includes(String(c.key))}
                onChange={(e)=> onToggleCol(String(c.key), e.target.checked)}
              >{c.title}</Checkbox>
            </div>
          ))}
        </div>
      )}
    >
      <Button size="small" type="text" icon={<SettingOutlined />} />
    </Popover>
  );
  return (
    <Modal
      title={`实例详情`}
      open={open}
      onCancel={onClose}
      footer={null}
      width="80vw"
      centered
      destroyOnHidden
      styles={{ content: { height: '80vh' }, body: { paddingTop: 12, paddingRight: 0, paddingLeft: 0, paddingBottom: 0, height: 'calc(80vh - 64px)', overflowY: 'auto' } }}
    >
      {vm ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Descriptions bordered column={2} size="small" style={{ width: '100%' }}>
              <Descriptions.Item label="名称">{vm?.metadata?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="命名空间">{vm?.metadata?.namespace || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Tag color={isRunning ? 'green' : isStopped ? 'volcano' : 'blue'}>{vm?.status?.printableStatus || vm?.status?.phase || '-'}</Tag>
                  <Space size={4}>
                    <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isRunning || isBusy} icon={<PlayCircleOutlined style={{ fontSize: 12, color: 'var(--primary-hex)' }} />} onClick={async () => { if (!iid) return; try { await startCloudProviderEcs(cloudId, iid); message.success('启动指令已下发'); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '启动失败'); } }}>启动</Button>
                    <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isStopped || isBusy} icon={<PoweroffOutlined style={{ fontSize: 12, color: '#f5222d' }} />} onClick={async () => { if (!iid) return; try { await stopCloudProviderEcs(cloudId, iid, false as any); message.success('停止指令已下发'); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '停止失败'); } }}>停止</Button>
                    <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={!isRunning || isBusy} icon={<ReloadOutlined style={{ fontSize: 12, color: 'var(--primary-hex)' }} />} onClick={async () => { if (!iid) return; try { await rebootCloudProviderEcs(cloudId, iid, false as any); message.success('重启指令已下发'); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '重启失败'); } }}>重启</Button>
                    <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} icon={<DesktopOutlined style={{ fontSize: 12, color: 'var(--primary-hex)' }} />} onClick={async () => { const ns = vm?.metadata?.namespace || ''; const nm = vm?.metadata?.name || ''; if (!ns || !nm) return; const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40); const h = Math.max(800, (window.screen?.availHeight || 900) - 80); const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`; const url = `/admin/clouds/${encodeURIComponent(cloudId)}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(nm)}`; window.open(url, 'harvester-vnc', features); }}>VNC</Button>
                    <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} danger disabled={isBusy} icon={<DeleteOutlined style={{ fontSize: 12, color: '#f5222d' }} />} onClick={() => { if (!iid) return; Modal.confirm({ title: '确认删除该实例？', onOk: async () => { try { await deleteCloudProviderEcs(cloudId, iid); message.success('删除成功'); onClose(); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '删除失败'); } } }); }}>删除</Button>
                  </Space>
                </div>
              </Descriptions.Item>
              <Descriptions.Item label="镜像">{(() => { const fromExtra = String((vm as any)?.Extra?.Image || '').trim(); if (fromExtra) return fromExtra; const imgs = vols.map((v: any) => v?.containerDisk?.image).filter(Boolean); return imgs.length ? imgs.join('，') : '-'; })()}</Descriptions.Item>
              <Descriptions.Item label="节点">{vm?.status?.nodeName || (vm as any)?.Extra?.NodeName || '-'}</Descriptions.Item>
              <Descriptions.Item label="规格">{(() => { const cpuText = vcpu ? `${vcpu} vCPU` : '-'; const memText = memGb || '-'; return `${cpuText} / ${memText}`; })()}</Descriptions.Item>
              
              <Descriptions.Item label="运行策略">{vm?.spec?.runStrategy || (typeof vm?.spec?.running === 'boolean' ? (vm?.spec?.running ? 'Running' : 'Stopped') : '-')}</Descriptions.Item>
              <Descriptions.Item label="内部IP">{(() => { const ips = Array.isArray(vm?.status?.interfaces) ? vm!.status!.interfaces.map((x: any) => x?.ipAddress).filter(Boolean) : []; return ips.length ? ips.join('，') : '-'; })()}</Descriptions.Item>
              <Descriptions.Item label="引导序列">{(() => { const seq = (disks || []).filter((d: any) => typeof d?.bootOrder === 'number').sort((a: any, b: any) => (a.bootOrder - b.bootOrder)).map((d: any) => `${d.name}:${d.bootOrder}`); return seq.length ? seq.join('，') : '-'; })()}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{vm?.metadata?.creationTimestamp || '-'}</Descriptions.Item>
              <Descriptions.Item label="UID">{vm?.metadata?.uid || '-'}</Descriptions.Item>
            </Descriptions>
          </div>
          <style>{`.vm-detail-tabs .ant-tabs-tab + .ant-tabs-tab{margin-left:16px !important}`}</style>
          <Tabs
            className="vm-detail-tabs"
            activeKey={activeTabKey}
            onChange={(k)=> setActiveTabKey(String(k))}
            tabBarExtraContent={extra}
            items={[
              {
                key: 'backup',
                label: (
                  <span>
                    <HddOutlined style={{ marginRight: 6 }} />
                    {(Array.isArray(disks) && disks.length > 0) ? `磁盘 ${disks.length}` : '磁盘'}
                  </span>
                ),
                children: (
                  <Table
                    bordered
                    size="small"
                    rowKey={(r: any) => r?.name}
                    columns={diskColumns as any}
                    dataSource={vols}
                    pagination={false}
                  />
                )
              },
              {
                key: 'network',
                label: (
                  <span>
                    <NodeIndexOutlined style={{ marginRight: 6 }} />
                    {(Array.isArray(ifs) && ifs.length > 0) ? `网卡 ${ifs.length}` : '网卡'}
                  </span>
                ),
                children: (
                  <Table
                    bordered
                    size="small"
                    rowKey={(r: any) => r?.name || `${r?.model}-${r?.mac || ''}`}
                    columns={netColumns as any}
                    dataSource={ifs}
                    pagination={false}
                  />
                )
              },
              {
                key: 'gpus',
                label: (
                  <span>
                    <DesktopOutlined style={{ marginRight: 6 }} />
                    {(Array.isArray(gpus) && gpus.length > 0) ? `GPU ${gpus.length}` : 'GPU'}
                  </span>
                ),
                children: (
                  <Table
                    bordered
                    size="small"
                    rowKey={(r: any) => r?.name || r?.deviceName}
                    columns={gpuColumns as any}
                    dataSource={gpus}
                    pagination={false}
                  />
                )
              },
              {
                key: 'usb',
                label: (
                  <span>
                    <DesktopOutlined style={{ marginRight: 6 }} />
                    {(Array.isArray(usbDevs) && usbDevs.length > 0) ? `USB设备 ${usbDevs.length}` : 'USB设备'}
                  </span>
                ),
                children: (
                  <Table
                    bordered
                    size="small"
                    rowKey={(r: any) => r?.name || r?.deviceName}
                    columns={usbColumns as any}
                    dataSource={usbDevs}
                    pagination={false}
                  />
                )
              },
              {
                key: 'monitor',
                label: (<span><LineChartOutlined style={{ marginRight: 6 }} />监控</span>),
                children: (<Alert type="info" message="暂未接入监控" />)
              },
              {
                key: 'cloudinit',
                label: (<span><DesktopOutlined style={{ marginRight: 6 }} />Cloudinit</span>),
                children: (cloudInitUserData ? <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{cloudInitUserData}</pre> : <Alert type="info" message="未配置 CloudInit" />)
              },
            ]}
          />
        </>
      ) : (
        <Alert type="info" message="未加载到实例详情" />
      )}
    </Modal>
  );
};

export default VmDetailModal;
