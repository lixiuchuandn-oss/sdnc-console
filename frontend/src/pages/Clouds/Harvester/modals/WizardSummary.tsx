import React, { useMemo } from 'react';
import { Button, Divider, Modal, Spin } from 'antd';

interface WizardSummaryProps {
  formSnapshot: any;
  currentCloudId: string | undefined;
  cloudId: string;
  clouds: any[];
  hostModeState: string;
  selectedNodeName: string | null;
  netModeState: string;
  kubeSubnets: any[];
  autoStart: boolean;
  jsonModalOpen: boolean;
  setJsonModalOpen: (v: boolean) => void;
  jsonLoading: boolean;
  jsonPreview: any;
  openJsonPreview: () => void;
  memGi: number;
  children?: React.ReactNode;
}

const WizardSummary: React.FC<WizardSummaryProps> = ({
  formSnapshot,
  currentCloudId,
  cloudId,
  clouds,
  hostModeState,
  selectedNodeName,
  netModeState,
  kubeSubnets,
  autoStart,
  jsonModalOpen,
  setJsonModalOpen,
  jsonLoading,
  jsonPreview,
  openJsonPreview,
  memGi,
  children
}) => {
  const summary = useMemo(() => {
    const v = formSnapshot || {};
    const rootType = String(v.rootSourceType || 'image');
    const extras: any[] = Array.isArray(v.extraDisks) ? v.extraDisks : [];
    const extraDiskCnt = extras.length;
    const diskCount = 1 + extraDiskCnt;
    const rootSize = v.rootSize || v.systemDisk || '40Gi';
    const nm = String(v.netMode || netModeState || 'flat');
    const prim = v.primaryNic || {};
    const netExtras: any[] = Array.isArray(v.netIfaces) ? v.netIfaces : [];
    const primaryTxt = nm === 'vpc'
      ? `${prim.vpc || '-'} / ${prim.subnet || '-'}`
      : `${prim.name || '-'} · ${(prim.type || 'bridge')}/${(prim.model || 'virtio')}`;
    const extraNames = netExtras.map((x: any) => x?.name || x?.subnet || '').filter(Boolean).join(', ');
    const macTxt = String(prim?.macAddress || '').trim();
    const subnetCidr = (function () { try { const key = String(prim?.subnet || ''); const it = (kubeSubnets || []).find((x: any) => x?.name === key); return String(it?.cidr || ''); } catch { return ''; } })();
    const hotExpand = v.hotExpandEnabled ? '启用' : '未启用';
    const cpuTopo = (function () { const s = Number(v.cpuSockets || 0); const c = Number(v.cpuCores || 0); if (s && c) return `${s} 插槽 × ${c} 核`; return '-'; })();
    const cpuMode = String(v.cpuModel || 'host-passthrough');
    const cpuBind = v.dedicatedCPUPlacement ? '启用' : '未启用';
    const cpuIso = v.isolateEmulatorThread ? '启用' : '未启用';
    const cpuQos = (function () { const req = v.cpuRequest; const lim = v.cpuLimit; const memLim = v.memoryLimitGi ? `${v.memoryLimitGi}Gi` : undefined; const a = []; if (typeof req === 'number') a.push(`请求 ${req}`); if (typeof lim === 'number') a.push(`上限 ${lim}`); if (memLim) a.push(`内存上限 ${memLim}`); return a.length ? a.join('，') : '-'; })();
    const rootSrc = String(v.rootSourceType || 'image');
    const rootDetail = (function () { if (rootSrc === 'image') { return v.image ? `镜像：${v.image}` : '镜像：-'; } if (rootSrc === 'existing') { return v.rootPvc ? `磁盘：${v.rootPvc}` : '磁盘：-'; } return '-'; })();
    const installTarget = undefined;
    const cloudInit = (function () { const txt = String(v.userData || '').trim(); return txt ? '启用' : '未配置'; })();
    const gpuSummary = (function () { 
      const mode = String(v.gpuMode || '').trim(); 
      const res = String(v.gpuResourceName || '').trim(); 
      const cnt = typeof v.gpuCount === 'number' ? v.gpuCount : 0; 
      if (mode === 'none') return '未配置';
      if (!mode && !res && !cnt) return '未配置'; 
      const modeTxt = (function () { 
        if (mode === 'passthrough') return '直通'; 
        if (mode === 'vgpu') return 'vGPU'; 
        if (mode === 'sriov') return 'SR-IOV'; 
        return '-'; 
      })(); 
      const cntTxt = cnt > 0 ? ` · 数量 ${cnt}` : ''; 
      return `${modeTxt} · ${res || '-'}` + cntTxt; 
    })();
    const usbSummary = (function () { const arr: any[] = Array.isArray(v.usbDevices) ? v.usbDevices : []; return arr.length ? `${arr.length} 个` : '未配置'; })();
    const runStrategy = String(v.runStrategy || 'RerunOnFailure');
    const poolId = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
    const poolName = (function () { try { const it = (clouds || []).find((x: any) => x?.id === poolId); return it?.name || poolId || '-'; } catch { return poolId || '-'; } })();
    return {
      location: {
        pool: poolName, host: (function () {
          if (hostModeState === 'node' && selectedNodeName) return `指定主机：${selectedNodeName}`;
          if (hostModeState === 'label') {
            const arr: any[] = Array.isArray((v as any).nodeSelectorPairs) ? (v as any).nodeSelectorPairs : [];
            const text = arr.map((p: any) => (p?.key && p?.value) ? `${p.key}=${p.value}` : '').filter(Boolean).join(', ');
            return `按标签调度：${text || '-'}`;
          }
          return '自动调度至合适的主机';
        })()
      },
      info: { name: v.name || '-', desc: v.description || '-', group: v.group || '-' },
      compute: { cpu: `${typeof v.cpu === 'number' ? v.cpu : 1} vCPU`, memory: v.memory || `${memGi}Gi`, hotExpand: v.hotExpandEnabled ? hotExpand : undefined, topo: cpuTopo !== '-' ? cpuTopo : undefined, cpuMode: (function () { const m = cpuMode; return (m && m !== 'host-passthrough') ? m : undefined; })(), cpuBind: v.dedicatedCPUPlacement ? cpuBind : undefined, cpuIso: v.isolateEmulatorThread ? cpuIso : undefined, qos: cpuQos !== '-' ? cpuQos : undefined },
      storage: { disks: `${diskCount} 虚拟盘（含系统盘 ${rootSize}）`, rootDetail, installTarget },
      network: { mode: nm === 'vpc' ? 'VPC网络' : '扁平网络', primary: primaryTxt, extras: netExtras.length ? `${netExtras.length} 个辅助网卡：${extraNames || '-'}` : undefined },
      ha: autoStart ? '启用' : '未启用',
      boot: 'BIOS',
      more: `创建完成后自动开机：${autoStart ? '是' : '否'}`,
      mac: macTxt || undefined,
      cidr: subnetCidr || undefined,
      cloudInit: (function () { const enabled = String(v.userData || '').trim().length > 0; return enabled ? cloudInit : undefined; })(),
      gpu: (function () { return /未配置/.test(gpuSummary) ? undefined : gpuSummary; })(),
      usb: (function () { return usbSummary === '未配置' ? undefined : usbSummary; })(),
      dataDisks: (function () { const arr: any[] = Array.isArray(v.extraDisks) ? v.extraDisks : []; const disks = arr.filter((d: any) => String(d?.type || 'disk') !== 'cdrom'); const names = disks.map((d: any) => d?.name || '').filter(Boolean).join(', '); return disks.length ? `${disks.length} 个：${names || '-'}` : undefined; })(),
      runStrategy,
    };
  }, [formSnapshot, autoStart, hostModeState, selectedNodeName, kubeSubnets, netModeState, clouds, currentCloudId, cloudId, memGi]);

  return (
    <div className="wizard-preview" style={{ marginRight: 0 }}>
      <div className="wizard-preview-header">
        <div className="wizard-preview-title">配置预览</div>
        <Button type="link" style={{ padding: 0, fontSize: 14 }} onClick={openJsonPreview}>查看JSON</Button>
      </div>
      <div className="wizard-summary-scroll">
        <div className="wizard-summary-list">
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="资源池">资源池</span><span className="wizard-summary-value" title={summary.location.pool}>{summary.location.pool}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="主机调度">主机调度</span><span className="wizard-summary-value" title={summary.location.host}>{summary.location.host}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="名称">名称</span><span className="wizard-summary-value" title={summary.info.name}>{summary.info.name}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="分组">分组</span><span className="wizard-summary-value" title={summary.info.group}>{summary.info.group}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="vCPU">vCPU</span><span className="wizard-summary-value" title={summary.compute.cpu}>{summary.compute.cpu}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="内存">内存</span><span className="wizard-summary-value" title={summary.compute.memory}>{summary.compute.memory}</span></div>
        {summary.compute.hotExpand ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="热扩容">热扩容</span><span className="wizard-summary-value" title={summary.compute.hotExpand}>{summary.compute.hotExpand}</span></div>) : null}
        {summary.compute.topo ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="CPU 拓扑">CPU 拓扑</span><span className="wizard-summary-value" title={summary.compute.topo}>{summary.compute.topo}</span></div>) : null}
        {summary.compute.cpuMode ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="CPU 模式">CPU 模式</span><span className="wizard-summary-value" title={summary.compute.cpuMode}>{summary.compute.cpuMode}</span></div>) : null}
        {summary.compute.cpuBind ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="CPU 绑定">CPU 绑定</span><span className="wizard-summary-value" title={summary.compute.cpuBind}>{summary.compute.cpuBind}</span></div>) : null}
        {summary.compute.cpuIso ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="CPU 隔离">CPU 隔离</span><span className="wizard-summary-value" title={summary.compute.cpuIso}>{summary.compute.cpuIso}</span></div>) : null}
        {summary.compute.qos ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="QoS">QoS</span><span className="wizard-summary-value" title={summary.compute.qos}>{summary.compute.qos}</span></div>) : null}
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="系统盘">系统盘</span><span className="wizard-summary-value" title={summary.storage.disks}>{summary.storage.disks}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="系统来源">系统来源</span><span className="wizard-summary-value" title={summary.storage.rootDetail}>{summary.storage.rootDetail}</span></div>
        
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="网络类型">网络类型</span><span className="wizard-summary-value" title={summary.network.mode}>{summary.network.mode}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="主网卡">主网卡</span><span className="wizard-summary-value" title={summary.network.primary}>{summary.network.primary}</span></div>
        {summary.mac ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="MAC">MAC</span><span className="wizard-summary-value" title={summary.mac}>{summary.mac}</span></div>) : null}
        {summary.cidr ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="子网CIDR">子网CIDR</span><span className="wizard-summary-value" title={summary.cidr}>{summary.cidr}</span></div>) : null}
        {summary.network.extras ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="辅助网卡">辅助网卡</span><span className="wizard-summary-value" title={summary.network.extras}>{summary.network.extras}</span></div>) : null}
        {summary.dataDisks ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="数据盘">数据盘</span><span className="wizard-summary-value" title={summary.dataDisks}>{summary.dataDisks}</span></div>) : null}
        {summary.cloudInit ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="Cloud-Init">Cloud-Init</span><span className="wizard-summary-value" title={summary.cloudInit}>{summary.cloudInit}</span></div>) : null}
        {summary.gpu ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="GPU">GPU</span><span className="wizard-summary-value" title={summary.gpu}>{summary.gpu}</span></div>) : null}
        {summary.usb ? (<div className="wizard-summary-item"><span className="wizard-summary-label" title="USB">USB</span><span className="wizard-summary-value" title={summary.usb}>{summary.usb}</span></div>) : null}
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="运行策略">运行策略</span><span className="wizard-summary-value" title={summary.runStrategy}>{summary.runStrategy}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="固件">固件</span><span className="wizard-summary-value" title={(function () { const v: any = formSnapshot || {}; if (v.bootUseEfi) { const flags = [v.efiPersistent ? '持久' : '', v.efiSecureBoot ? '安全启动' : ''].filter(Boolean).join('、'); return flags ? `EFI（${flags}）` : 'EFI'; } return 'BIOS'; })()}>{(function () { const v: any = formSnapshot || {}; if (v.bootUseEfi) { const flags = [v.efiPersistent ? '持久' : '', v.efiSecureBoot ? '安全启动' : ''].filter(Boolean).join('、'); return flags ? `EFI（${flags}）` : 'EFI'; } return 'BIOS'; })()}</span></div>
        <div className="wizard-summary-item"><span className="wizard-summary-label" title="更多">更多</span><span className="wizard-summary-value" title={summary.more}>{summary.more}</span></div>
        </div>
      </div>
      <Modal open={jsonModalOpen} onCancel={() => setJsonModalOpen(false)} footer={null} width={800} title="创建配置 JSON">
        {jsonLoading ? (<Spin />) : (<pre style={{ fontSize: 14, maxHeight: 480, overflow: 'auto' }}>{JSON.stringify(jsonPreview, null, 2)}</pre>)}
      </Modal>
      <Divider style={{ margin: '12px 0' }} />
      {children}
    </div>
  );
};

export default WizardSummary;
