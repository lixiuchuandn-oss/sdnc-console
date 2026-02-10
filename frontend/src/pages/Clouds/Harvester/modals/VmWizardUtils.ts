import { startCloudProviderEcs } from '../../../../services/api';
import { fetchHarvesterVmDetail } from '../../../../services/harvesterApi'; // 新增导入

 

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
  capabilities?: any;
  isArm64?: boolean;
  vmId?: string;
}) => {
  const { v, memGi, hostModeState, selectedNodeName, gpuResources, selectedGpu, capabilities, isArm64, vmId } = params;
  
  // 1. Calculate GPU
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

  // 2. Calculate CPU Topology
  const cpu = Number(v.cpu || 1);
  const sockets = Number(v.cpuSockets || 1);
  const cores = Number(v.cpuCores || cpu); // Default cores = total vCPU if not specified? Or 1? Usually sockets*cores*threads = cpu
  const threads = Number(v.cpuThreads || 1);
  
  // 3. Calculate Memory
  const memory = String(v.memory || `${memGi}Gi`);

  // 4. Node Selector & Affinity
  const nodeSelector = (function () { 
      if (hostModeState === 'label') {
          const arr = Array.isArray(v.nodeSelectorPairs) ? v.nodeSelectorPairs : []; 
          const obj: any = {}; 
          arr.forEach((p: any) => { 
              const k = String(p?.key || '').trim(); 
              const val = String(p?.value || '').trim(); 
              if (k && val) { obj[k] = val; } 
          }); 
          return Object.keys(obj).length > 0 ? obj : undefined; 
      }
      return undefined;
  })();
  
  const nodeName = (function () {
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
  })();

  // 5. Construct Manifest
  const disks: any[] = [];
  const volumes: any[] = [];
  const networks: any[] = [];
  const interfaces: any[] = [];
  // Use Harvester's volumeClaimTemplates annotation instead of KubeVirt's dataVolumeTemplates
  // This aligns with Harvester's native UI behavior and ensures proper PVC creation.
  const volumeClaimTemplates: any[] = [];

  // Helper to generate random suffix for PVC names
  const randSuffix = () => Math.random().toString(36).substring(2, 7);

  // --- Network Mapping (Primary NIC) ---
  if (v.primaryNic) {
      const nicName = 'nic-0';
      const netName = v.primaryNic.name;
      
      const iface: any = {
          name: nicName,
          model: v.primaryNic.model || 'virtio',
      };
      if (v.primaryNic.macAddress) {
          iface.macAddress = v.primaryNic.macAddress;
      }
      
      const type = v.primaryNic.type || 'bridge';
      if (type === 'bridge') iface.bridge = {};
      else if (type === 'masquerade') iface.masquerade = {};
      else if (type === 'sriov') iface.sriov = {};
      else if (type === 'macvtap') iface.macvtap = {};
      else iface.bridge = {}; 

      interfaces.push(iface);

      const net: any = { name: nicName };
      if (netName) {
           net.multus = { networkName: netName };
      } else {
           net.pod = {}; 
      }
      networks.push(net);
  }

  // --- Disk Mapping (Root) ---
  const rootDiskName = v.rootName || 'disk-0';
  const rootVolName = rootDiskName; 
  
  disks.push({
      name: rootDiskName,
      bootOrder: 1,
      [v.rootDeviceType || 'disk']: {
          bus: (v.rootDeviceType === 'cd-rom' || v.rootDeviceType === 'cdrom') 
            ? (isArm64 ? 'scsi' : 'sata') 
            : (v.rootBus || 'virtio')
      }
  });

  if ((v.rootSourceType || 'image') === 'existing') {
      volumes.push({
          name: rootVolName,
          persistentVolumeClaim: { claimName: v.rootPvc }
      });
  } else {
      // Image source -> PVC via volumeClaimTemplates
      // Name format: {vmId}-{rootDiskName}-{random}
      const pvcName = `${vmId || v.name}-${rootDiskName}-${randSuffix()}`;
      
      volumes.push({
          name: rootVolName,
          persistentVolumeClaim: { claimName: pvcName }
      });
      
      const imgVal = v.image || '';
      const [imgNs, imgName] = imgVal.includes('/') ? imgVal.split('/') : ['harvester-public', imgVal];
      const fullImgName = imgNs && imgName ? `${imgNs}/${imgName}` : imgVal;
      
      volumeClaimTemplates.push({
          metadata: { 
              name: pvcName,
              annotations: {
                  "harvesterhci.io/imageId": fullImgName
              }
          },
          spec: {
              accessModes: ["ReadWriteMany"], // Harvester defaults to RWX for Longhorn
              resources: {
                  requests: {
                      storage: v.rootSize ? (String(v.rootSize).match(/^[0-9]+$/) ? `${v.rootSize}Gi` : v.rootSize) : '10Gi'
                  }
              },
              volumeMode: "Block",
              storageClassName: v.storageClassName || undefined
          }
      });
  }

  // --- CloudInit / UserData ---
  const userData = (function () { 
      const ud = v.userData || ''; 
      if (v.installGuestAgent && !ud) { 
          return `#cloud-config\npackage_update: true\npackages:\n- qemu-guest-agent\nruncmd:\n- systemctl enable --now qemu-guest-agent || (service qemu-guest-agent start || true)`; 
      } 
      return ud || undefined; 
  })();

  if (userData || (v.sshNames && v.sshNames.length > 0)) {
       const ciName = 'cloudinitdisk';
       disks.push({
           name: ciName,
           disk: { bus: 'virtio' }
       });
       
       const ciConfig: any = {};
       if (userData) ciConfig.userData = userData;
       
       volumes.push({
           name: ciName,
           cloudInitNoCloud: ciConfig
       });
  }

  // --- Extra Disks ---
  if (Array.isArray(v.extraDisks)) {
      v.extraDisks.forEach((d: any, idx: number) => {
          const dName = d.name || `disk-${idx + 1}`;
          const dVolName = dName;
          
          disks.push({
              name: dName,
              [d.type || 'disk']: {
                  bus: (d.type === 'cd-rom' || d.type === 'cdrom') 
                    ? (isArm64 ? 'scsi' : 'sata') 
                    : (d.bus || 'virtio')
              }
          });

          if (d.sourceType === 'existing') {
              volumes.push({
                  name: dVolName,
                  persistentVolumeClaim: { claimName: d.pvc }
              });
          } else {
              const pvcName = `${vmId || v.name}-${dName}-${randSuffix()}`;
              volumes.push({
                  name: dVolName,
                  persistentVolumeClaim: { claimName: pvcName }
              });
              
              volumeClaimTemplates.push({
                  metadata: { name: pvcName },
                  spec: {
                      accessModes: ["ReadWriteMany"],
                      resources: {
                          requests: {
                              storage: d.size ? (String(d.size).endsWith('i') ? d.size : `${d.size}Gi`) : '10Gi'
                          }
                      },
                      volumeMode: "Block",
                      storageClassName: v.storageClassName || undefined
                  }
              });
          }
      });
  }

  const manifest: any = {
    apiVersion: "kubevirt.io/v1",
    kind: "VirtualMachine",
    metadata: {
        namespace: v.namespace || 'default',
        name: vmId || v.name,
        labels: {
            "harvesterhci.io/creator": "harvester",
            "harvesterhci.io/vmName": vmId || v.name,
        },
        annotations: {
             "harvesterhci.io/volumeClaimTemplates": JSON.stringify(volumeClaimTemplates),
             ...(v.name ? { "tower.io/alias": String(v.name) } : {})
        }
    },
    spec: {
        runStrategy: v.runStrategy || "RerunOnFailure",
        template: {
            metadata: {
                labels: {
                    "harvesterhci.io/vmName": vmId || v.name
                },
                annotations: {}
            },
            spec: {
                evictionStrategy: (v.evictionStrategy && v.evictionStrategy !== 'None') ? v.evictionStrategy : undefined,
                hostname: vmId || v.name,
                nodeSelector: nodeSelector,
                affinity: nodeName ? {
                    nodeAffinity: {
                        requiredDuringSchedulingIgnoredDuringExecution: {
                            nodeSelectorTerms: [{
                                matchExpressions: [{
                                    key: "kubernetes.io/hostname",
                                    operator: "In",
                                    values: [nodeName]
                                }]
                            }]
                        }
                    }
                } : undefined,
                domain: {
                    cpu: {
                        cores: cores,
                        sockets: sockets,
                        threads: threads,
                        maxSockets: v.hotExpandEnabled ? sockets * 4 : undefined
                    },
                    memory: {
                        guest: memory,
                        maxGuest: v.hotExpandEnabled ? `${memGi * 4}Gi` : undefined
                    },
                    resources: {
                        limits: {
                            cpu: v.hotExpandEnabled ? String(cpu * 4) : String(cpu),
                            memory: v.hotExpandEnabled ? `${memGi * 4}Gi` : memory
                        },
                        requests: {
                            memory: v.memoryRequestGi ? `${v.memoryRequestGi}Gi` : memory,
                            cpu: v.cpuRequest ? String(v.cpuRequest) : undefined
                        }
                    },
                    features: {
                        acpi: { enabled: true },
                        smm: (v.bootUseEfi && v.efiSecureBoot) ? { enabled: true } : undefined
                    },
                    firmware: v.bootUseEfi ? {
                        bootloader: {
                            efi: {
                                secureBoot: !!v.efiSecureBoot,
                                persistent: !!v.efiPersistent
                            }
                        }
                    } : undefined,
                    devices: {
                        inputs: v.useUsbTablet ? [{ bus: "usb", name: "tablet", type: "tablet" }] : [],
                        interfaces: interfaces,
                        disks: disks,
                        tpm: v.tpmEnabled ? { persistent: !!v.tpmPersistent } : undefined,
                        hostDevices: finalGpuResName ? [
                            {
                                name: "gpu-0",
                                deviceName: finalGpuResName
                            }
                        ] : []
                    },
                    machine: {
                        type: String(v.machineType || (function(){
                           if (capabilities?.recommendedMachineType) return capabilities.recommendedMachineType;
                           const arch = String(capabilities?.architecture || '').toLowerCase();
                           if (arch === 'arm64' || arch === 'aarch64') return 'virt';
                           return 'q35';
                        })())
                    }
                },
                networks: networks,
                volumes: volumes
            }
        }
    }
  };

  // 6. Map SSH Keys (Access Credentials)
  if (v.sshNames && v.sshNames.length > 0) {
      manifest.spec.template.metadata.annotations["harvesterhci.io/sshNames"] = JSON.stringify(v.sshNames);
  }

  // 7. Map CloudInit (UserData)
  // Already handled in CloudInit Disk section above

  return manifest;
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
  cpu: 2,
  memory: `${memGi}Gi`,
  machineType: undefined,
  rootSourceType: 'image',
  rootName: `disk-${Math.random().toString(36).substring(2, 8)}`,
  rootSize: '40',
  rootBus: 'virtio',
  rootDeviceType: 'disk',
  extraDisks: [],
  hostMode: 'auto',
  netMode: 'flat',
  gpuMode: 'none',
  gpuCount: 0,
  hotExpandEnabled: false,
  bootUseEfi: false,
  efiPersistent: false,
  efiSecureBoot: false,
  tpmEnabled: false,
  tpmPersistent: false,
  installGuestAgent: false,
  useUsbTablet: true,
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


export const handleAutoStart = async (cid: string, vmId: string, v: any) => {
    const instanceId = `${v.namespace}/${vmId}`;
    try { await startCloudProviderEcs(cid, instanceId); } catch { }
};

 

export const constructVmPayload = (params: {
  v: any;
  memGi: number;
  hostModeState: string;
  selectedNodeName: string | null;
  gpuResources: any[];
  selectedGpu: any;
  capabilities?: any;
  isArm64?: boolean;
  vmId?: string;
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
      return gi ? `${gi}` : '';
    })();
    form.setFieldsValue({ rootSize: display });
  } catch {}
};

// 新增ID生成逻辑
export const randSeg = (len: number = 4): string => {
  let s = Math.random().toString(36).substring(2, 2 + len);
  if (s.length < len) s = (s + Math.random().toString(36).substring(2)).substring(0, len);
  return s.toLowerCase();
};

const generateVmIdFormat = (): string => {
  return `id-vm-${randSeg(11)}`;
};

export const generateUniqueVmId = async (cloudId: string, namespace: string): Promise<string> => {
  const ns = namespace || 'default';
  for (let i = 0; i < 8; i++) {
    const candidate = generateVmIdFormat();
    try {
      await fetchHarvesterVmDetail(cloudId, ns, candidate);
      continue;
    } catch {
      return candidate;
    }
  }
  throw new Error('生成唯一实例ID失败，请重试');
};