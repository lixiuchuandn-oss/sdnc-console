import { startCloudProviderEcs } from '../../../../services/api';

 

export const validateAndGetGpu = (params: {
  v: any;
  gpuResources: any[];
  hostModeState: string;
  selectedNodeName: string | null;
}) => {
  const { v, gpuResources, hostModeState, selectedNodeName } = params;
  if (!v.gpuMode) return { selectedGpu: null, finalGpuResName: undefined };

  const list = Array.isArray(gpuResources) ? gpuResources : [];
  if (list.length === 0) return { selectedGpu: null, finalGpuResName: undefined }; // Caller might want to reload if empty, but here we just check what we have

  let found = null as any;
  if (v.gpuResourceName) {
    found = list.find((x: any) => String(x?.resourceName) === String(v.gpuResourceName));
  }
  if (!found && v.gpuPcideviceName) {
    const dn = String(v.gpuPcideviceName || '').trim();
    found = list.find((x: any) => String(x?.raw?.metadata?.name || x?.name || '') === dn);
  }
  if (!found) {
    throw new Error(`GPU 资源不可用：${v.gpuPcideviceName || v.gpuResourceName}`);
  }

  const selectedGpu = found;
  const finalGpuResName = found?.resourceName || found?.raw?.status?.resourceName || found?.raw?.spec?.resourceName || undefined;
  const mode = String(v.gpuMode || 'passthrough');
  
  if (['passthrough', 'sriov'].includes(mode)) {
    const node = String(found?.node || found?.nodeName || '').trim();
    if (!node) {
      throw new Error('该GPU资源未在任何节点就绪，请先在GPU页面确认可用资源');
    }
    if (hostModeState === 'node' && selectedNodeName && selectedNodeName !== node) {
      // We return a warning or just let the caller handle the warning?
      // The original code uses message.info. We can return a warning flag/message.
      return { selectedGpu, finalGpuResName, warning: `已选择GPU所在节点 ${node}，与当前主机选择不一致，将以GPU节点为准` };
    }
  }

  return { selectedGpu, finalGpuResName };
};

export const buildHarvesterVmPayload = (params: {
  v: any;
  memGi: number;
  hostModeState: string;
  selectedNodeName: string | null;
  gpuResources: any[];
  selectedGpu: any;
}) => {
  const { v, memGi, hostModeState, selectedNodeName, gpuResources, selectedGpu } = params;
  
  const finalGpuResName = (function() {
      if (selectedGpu) {
           return selectedGpu?.resourceName || selectedGpu?.raw?.status?.resourceName || selectedGpu?.raw?.spec?.resourceName || undefined;
      }
      const rn = v.gpuResourceName;
      if (rn) return rn;
      const dn = v.gpuPcideviceName;
      if (!dn) return undefined;
      const list = Array.isArray(gpuResources) ? gpuResources : [];
      const f = list.find((x: any) => String(x?.raw?.metadata?.name || x?.name || '') === String(dn));
      return f?.resourceName || f?.raw?.status?.resourceName || f?.raw?.spec?.resourceName || undefined;
  })();

  return {
    namespace: v.namespace,
    name: v.name,
    cpu: Number(v.cpu),
    memory: String(v.memory || `${memGi}Gi`),
    image: v.image,
    userData: (function () { const ud = v.userData || ''; if (v.installGuestAgent && !ud) { return `#cloud-config\npackage_update: true\npackages:\n- qemu-guest-agent\nruncmd:\n- systemctl enable --now qemu-guest-agent || (service qemu-guest-agent start || true)`; } return ud || undefined; })(),
    systemDiskSize: v.rootSize || v.systemDisk || '40Gi',
    storageClassName: v.storageClassName || undefined,
    
    nodeName: (function () {
      const gpuNode = selectedGpu && String(selectedGpu?.node || selectedGpu?.nodeName || '').trim();
      if (gpuNode) return gpuNode;
      if (!selectedGpu && v.gpuResourceName) {
           try {
            const list = Array.isArray(gpuResources) ? gpuResources : [];
            const found = list.find((x:any)=> String(x?.resourceName)===String(v.gpuResourceName));
            const gn = found && String(found?.node||found?.nodeName||'').trim();
            if (gn) return gn;
           } catch {}
      }
      return hostModeState === 'node' ? (selectedNodeName || undefined) : undefined;
    })(),
    nodeSelector: (function () { if (hostModeState !== 'label') return undefined; const arr = Array.isArray(v.nodeSelectorPairs) ? v.nodeSelectorPairs : []; const obj: any = {}; arr.forEach((p: any) => { const k = String(p?.key || '').trim(); const val = String(p?.value || '').trim(); if (k && val) { obj[k] = val; } }); return Object.keys(obj).length > 0 ? obj : undefined; })(),
    diskBus: v.rootBus || v.diskBus || 'virtio',
    runStrategy: v.runStrategy || undefined,
    bootUseEfi: !!v.bootUseEfi,
    efiPersistent: !!v.efiPersistent,
    efiSecureBoot: !!v.efiSecureBoot,
    tpmEnabled: !!v.tpmEnabled,
    tpmPersistent: !!v.tpmPersistent,
    useUsbTablet: !!v.useUsbTablet,
    installGuestAgent: !!v.installGuestAgent,
    gpuMode: v.gpuMode || undefined,
    gpuResourceName: finalGpuResName || undefined,
    gpuCount: (finalGpuResName ? (typeof v.gpuCount === 'number' ? v.gpuCount : 1) : undefined),
    usbDevices: Array.isArray(v.usbDevices) ? v.usbDevices : undefined,
    cpuSockets: typeof v.cpuSockets === 'number' ? v.cpuSockets : undefined,
    cpuCores: typeof v.cpuCores === 'number' ? v.cpuCores : undefined,
    cpuThreads: typeof v.cpuThreads === 'number' ? v.cpuThreads : 1,
    cpuModel: v.cpuModel || undefined,
    cpuModelCustom: v.cpuModelCustom || undefined,
    dedicatedCPUPlacement: !!v.dedicatedCPUPlacement,
    isolateEmulatorThread: !!v.isolateEmulatorThread,
    cpuRequest: typeof v.cpuRequest === 'number' ? v.cpuRequest : undefined,
    cpuLimit: v.cpuBurstUnlimited ? undefined : (typeof v.cpuLimit === 'number' ? v.cpuLimit : undefined),
    memoryLimit: v.memoryBurstUnlimited ? undefined : (typeof v.memoryLimitGi === 'number' ? `${v.memoryLimitGi}Gi` : undefined),
    memoryRequestGi: typeof v.memoryRequestGi === 'number' ? v.memoryRequestGi : undefined,
    hotExpandEnabled: !!v.hotExpandEnabled,
    sshNames: Array.isArray(v.sshNames) ? v.sshNames : undefined,
    netIfaces: (function () { const prim = v.primaryNic && v.primaryNic.name ? { name: v.primaryNic.name, type: v.primaryNic.type || 'bridge', model: v.primaryNic.model || 'virtio', macAddress: v.primaryNic?.macAddress || undefined, ipAddress: v.primaryNic?.ipAddress || undefined } : undefined; const extras = Array.isArray(v.netIfaces) ? v.netIfaces.map((n: any) => ({ ...n, macAddress: n?.macAddress || undefined })) : []; return (prim ? [prim, ...extras] : extras); })(),
    extraDisks: Array.isArray(v.extraDisks) ? v.extraDisks : [],
    rootSourceType: v.rootSourceType,
    rootImage: v.rootImage || v.image,
    rootPvc: v.rootPvc,
    rootName: v.rootName || v.name,
    rootBus: v.rootBus || v.diskBus,
    rootDeviceType: v.rootDeviceType || 'disk',
    rootSize: v.rootSize || v.systemDisk,
  };
};

export const parseSizeToGi = (raw: any) => {
  let gi = 0;
  if (typeof raw === 'number') { 
      gi = Math.max(1, Math.round(Number(raw) / (1024 * 1024 * 1024))); 
  } else { 
      const ss = String(raw || '').toUpperCase(); 
      const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0; 
      if (/GI$/.test(ss)) gi = num; 
      else if (/MI$/.test(ss)) gi = Math.ceil(num / 1024); 
      else gi = Math.round(num / (1024 * 1024 * 1024)); 
  }
  return gi;
};

export const initialWizardValues = (memGi: number, initialVmName: string) => ({
  name: initialVmName,
  cpu: 1,
  memory: `${memGi}Gi`,
  rootSourceType: 'image',
  rootName: initialVmName,
  rootSize: '40Gi',
  rootBus: 'virtio',
  rootDeviceType: 'disk',
  extraDisks: [],
  hostMode: 'auto',
  netMode: 'flat',
  gpuMode: 'passthrough',
  gpuCount: 0,
  hotExpandEnabled: false,
  bootUseEfi: false,
  efiPersistent: false,
  efiSecureBoot: false,
  tpmEnabled: false,
  tpmPersistent: false,
  installGuestAgent: false,
  useUsbTablet: false,
  runStrategy: 'RerunOnFailure',
  primaryNic: { name: '', type: 'bridge', model: 'virtio' },
  netIfaces: []
});

 


export const filterNodes = (nodes: any[], keyword: string) => {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return nodes;
  return (nodes || []).filter((n:any)=> (
    String(n?.name || '').toLowerCase().includes(kw) ||
    String(n?.internalIP || '').toLowerCase().includes(kw)
  ));
};


export const validateImageSize = (v: any, images: any[]) => {
    if (String(v.rootSourceType || 'image') === 'image') {
        try {
            const imgVal = v.image;
            const it = (images || []).find((x: any) => {
                 const name = x?.metadata?.name || x?.name;
                 const ns = x?.metadata?.namespace || x?.namespace;
                 const val = ns && name ? `${ns}/${name}` : name;
                 return val === imgVal;
            });
            const raw = (function () { const vv = (it as any)?.spec?.virtualSize || (it as any)?.virtualSize; return (vv !== undefined && vv !== null && vv !== 0) ? vv : (it as any)?.size; })();
            const gi = parseSizeToGi(raw);
            const val = String(v.rootSize || '').toUpperCase(); 
            const n = Number(String(val).replace(/[^0-9]/g, '')) || 0; 
            const valGi = /MI$/.test(val) ? Math.ceil(n / 1024) : n;
            if (gi && valGi && valGi < gi) { 
                return '系统盘需≥镜像大小'; 
            }
        } catch { }
    }
  return null;
};


export const handleAutoStart = async (cid: string, v: any) => {
    const instanceId = `${v.namespace}/${v.name}`;
    try { await startCloudProviderEcs(cid, instanceId); } catch { }
};

 

export const constructVmPayload = (params: {
  v: any;
  memGi: number;
  hostModeState: string;
  selectedNodeName: string | null;
  gpuResources: any[];
  selectedGpu: any;
}) => {
   return buildHarvesterVmPayload(params);
};

export const handleRootPvcChange = (form: any, availableVolumes: any[], pvcName: string) => {
  try {
    const it = (availableVolumes||[]).find((v:any)=> v?.pvcName===pvcName);
    const nm = it?.name || pvcName;
    const raw = it?.size;
    const display = (function(){
      let gi = 0;
      if (typeof raw === 'number') { gi = Math.round(raw / (1024 * 1024 * 1024)); }
      else { const ss = String(raw || '').toUpperCase(); const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0; if (/GI$/.test(ss)) { gi = num; } else if (/MI$/.test(ss)) { gi = Math.ceil(num / 1024); } else { gi = Math.round(num / (1024 * 1024 * 1024)); } }
      return gi ? `${gi} GiB` : '';
    })();
    form.setFieldsValue({ rootName: nm, rootSize: display });
  } catch {}
};
