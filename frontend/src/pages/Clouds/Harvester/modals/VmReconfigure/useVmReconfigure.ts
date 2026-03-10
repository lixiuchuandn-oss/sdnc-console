import { useState, useEffect, useMemo } from 'react';
import { Form, message, Modal } from 'antd';
import yaml from 'js-yaml';
import { 
  updateHarvesterVmSpec, createHarvesterVolume, attachHarvesterVolumeToVmByName, 
  fetchHarvesterGpuResources, patchHarvesterVm, fetchHarvesterNads,
  fetchKubeOvnVpcs, fetchKubeOvnSubnets, fetchHarvesterImages, fetchHarvesterStorageClasses,
  fetchHarvesterVolume, fetchHarvesterVmDetail, updateHarvesterVolume
} from '../../../../../services/harvesterApi';
import { rebootCloudProviderEcs } from '../../../../../services/api';

const parseQuantity = (s: string | number | undefined): number => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    'Ki': 1024, 'Mi': 1024**2, 'Gi': 1024**3, 'Ti': 1024**4, 'Pi': 1024**5,
    'k': 1000, 'M': 1000**2, 'G': 1000**3, 'T': 1000**4, 'P': 1000**5
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) {
      return parseFloat(str.slice(0, -u.length)) * m;
    }
  }
  return parseFloat(str);
};

export const useVmReconfigure = (props: any) => {
  const { 
    open, cloudId, record, onClose, onOk, 
    storageClasses: propStorageClasses, images: propImages, gpuResources: propGpuResources, 
    initialConfigType 
  } = props;

  const [form] = Form.useForm();
  
  // Flattened state: just track the selected menu key
  const [selectedKey, setSelectedKey] = useState<string>('change_spec');
  
  // Resource states
  const [scs, setScs] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [gpuResources, setGpuResources] = useState<any[]>([]);
  const [selectedGpuKey, setSelectedGpuKey] = useState<string | null>(null);
  const [nads, setNads] = useState<any[]>([]);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [gpuKeyword, setGpuKeyword] = useState<string>('');
  const [gpuLoading, setGpuLoading] = useState<boolean>(false);
  const [systemDiskSize, setSystemDiskSize] = useState<number | null>(null);
  const [systemDiskLoading, setSystemDiskLoading] = useState<boolean>(false);

  // --- Add VM Refresh Logic ---
  const [latestVm, setLatestVm] = useState<any>(null);

  useEffect(() => {
    if (open && cloudId && record?.metadata?.name && record?.metadata?.namespace) {
       // Fetch fresh VM details to ensure disk/nic info is up-to-date
       fetchHarvesterVmDetail(cloudId, record.metadata.namespace, record.metadata.name)
         .then((res: any) => {
            setLatestVm(res?.data || res);
         })
         .catch((err: any) => {
            console.error('Failed to fetch latest VM details:', err);
         });
    }
  }, [open, cloudId, record]);

  const activeRecord = latestVm || record;

  const { systemDisk } = useMemo(() => {
    if (!activeRecord) return { systemDisk: '' };
    
    const disks = activeRecord?.spec?.template?.spec?.domain?.devices?.disks || [];
    const volumes = activeRecord?.spec?.template?.spec?.volumes || [];
    
    // 1. Identify System Disk (Boot Disk)
    let sysDiskPvc = '';
    // Priority 1: Boot Order 1 AND Not CDROM
    let bootDisk = disks.find((d: any) => d.bootOrder === 1 && !d.cdrom);
    
    // Priority 2: Named 'disk-0' AND Not CDROM
    if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'disk-0' && !d.cdrom);

    // Priority 3: Named 'rootdisk' AND Not CDROM (Common in some templates)
    if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'rootdisk' && !d.cdrom);

    // Priority 4: First non-CDROM disk
    if (!bootDisk && disks.length > 0) bootDisk = disks.find((d: any) => !d.cdrom);
    
    // Debug log for troubleshooting
    // 磁盘检测逻辑
    
    if (bootDisk) {
       const volume = volumes.find((v: any) => v.name === bootDisk.name);
       if (volume?.persistentVolumeClaim?.claimName) {
          sysDiskPvc = volume.persistentVolumeClaim.claimName;
       }
    }
    // Fallback to backend enriched field if not found in spec
    if (!sysDiskPvc) sysDiskPvc = record?.volumeClaims?.[0] || '';

    return { systemDisk: sysDiskPvc };
  }, [record, activeRecord]);

  const loadSystemDiskSize = async () => {
    if (!systemDisk || !record?.metadata?.namespace) return;
    try {
      setSystemDiskLoading(true);
      const res = await fetchHarvesterVolume(cloudId, record.metadata.namespace, systemDisk);
       const data = res?.data || res;
       // Prefer spec.resources.requests (user intent) over status.capacity (actual/current)
       // This avoids issues where status reflects underlying image size before resize is complete
       const cap = data?.spec?.resources?.requests?.storage || data?.status?.capacity?.storage;
       if (cap) {
         const sizeGi = getQuantityInGi(cap);
         setSystemDiskSize(sizeGi);
         form.setFieldsValue({ systemDiskSize: sizeGi });
       }
     } catch (e) {
      console.error('Failed to load system disk size', e);
    } finally {
      setSystemDiskLoading(false);
    }
  };

  // Delete old diskClaims useMemo

  // --- State Sync & Initialization (状态同步与初始化) ---
  // Sync props to state (同步外部资源数据)
  useEffect(() => { setScs(propStorageClasses || []); }, [propStorageClasses]);
  useEffect(() => { setImages(propImages || []); }, [propImages]);
  useEffect(() => { setGpuResources(propGpuResources || []); }, [propGpuResources]);

  // Handle initial config type (处理初始选中项)
  useEffect(() => {
    if (open && initialConfigType) {
      setSelectedKey(initialConfigType);
    } else if (open && !initialConfigType) {
      setSelectedKey('change_spec');
    }
  }, [open, initialConfigType]);

  const getCurrentSpec = () => {
    let cpu = record?.Extra?.CPU;
    let mem = record?.Extra?.Memory;
    
    // Retrieve maxSockets and maxMemory from the active record (latest state)
    const domain = activeRecord?.spec?.template?.spec?.domain;
    const maxSockets = domain?.cpu?.maxSockets;
    const maxMemory = domain?.memory?.maxGuest;

    if (cpu === undefined || cpu === null) {
       const sockets = domain?.cpu?.sockets || 1;
       const cores = domain?.cpu?.cores || 1;
       const threads = domain?.cpu?.threads || 1;
       cpu = sockets * cores * threads;
    }
    if (mem === undefined || mem === null) {
       mem = activeRecord?.spec?.template?.spec?.domain?.memory?.guest;
       if (!mem) mem = activeRecord?.spec?.template?.spec?.domain?.resources?.requests?.memory;
    }
    return { cpu: Number(cpu || 0), memory: mem, maxSockets, maxMemory };
  };

  // Helper functions
  const generateMacAddress = () => {
    const hex = '0123456789ABCDEF';
    let mac = '52:54:00'; 
    for (let i = 0; i < 3; i++) {
      mac += ':' + hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
    }
    return mac;
  };

  const getParsedNetworkData = (vm: any) => {
    try {
      const volumes = vm?.spec?.template?.spec?.volumes || [];
      const ciVol = volumes.find((v: any) => v.cloudInitNoCloud);
      if (ciVol && ciVol.cloudInitNoCloud.networkData) {
        return yaml.load(ciVol.cloudInitNoCloud.networkData) as any;
      }
    } catch (e) {
      console.warn('Failed to parse existing networkData', e);
    }
    return { network: { version: 2, ethernets: {} } };
  };

  const getQuantityInGi = (q: string | number | undefined): number => {
    const bytes = parseQuantity(q);
    if (!bytes) return 0;
    return Math.ceil(bytes / (1024 ** 3));
  };

  const getMemoryInGi = (memStr: string | number | undefined): number => {
    const bytes = parseQuantity(memStr);
    if (!bytes) return 0;
    // Always round up to next GiB to ensure user sees integer GiB if close enough, or CEIL if it was MiB
    return Math.ceil(bytes / (1024 ** 3));
  };

  const isHotPlugEnabledOnVm = () => {
    const cpuSpec = activeRecord?.spec?.template?.spec?.domain?.cpu;
    const isConfigured = !!(cpuSpec?.maxSockets && cpuSpec?.maxSockets > (cpuSpec?.sockets || 1));

    // If RestartRequired condition is present and True, it means the current configuration (including hotplug)
    // might not be fully applied or the VM is in a state requiring restart.
    // In this case, we cannot perform a hot plug operation.
    const conditions = activeRecord?.status?.conditions || [];
    const isRestartRequired = conditions.some((c: any) => c.type === 'RestartRequired' && c.status === 'True');
    const isHotPlugInProgress = conditions.some((c: any) => (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True');

    // If Hot Plug is in progress, we treat it as "Hot Plug Disabled" temporarily, 
    // which effectively disables the "Hot Plug" UI path in ChangeSpec and forces restart logic (or prevents action).
    // Ideally, we should block the action entirely in the UI if in progress.
    if (isRestartRequired || isHotPlugInProgress) return false;

    return isConfigured;
  };

  const isHotPlugInProgress = useMemo(() => {
    const conditions = activeRecord?.status?.conditions || [];
    return conditions.some((c: any) => (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True');
  }, [activeRecord]);

  const reloadNads = async () => {
    try {
      const res = await fetchHarvesterNads(cloudId);
      const items = res?.data?.items || res?.items || [];
      setNads(items);
      return items;
    } catch (e) { console.error(e); return []; }
  };

  const reloadVpcs = async () => {
    try { 
      const res = await fetchKubeOvnVpcs(cloudId); 
      const items = res?.data?.items || res?.items || [];
      setVpcs(items); 
      return items;
    } catch (e) { console.error(e); return []; }
  };
  const reloadSubnets = async () => {
    try { 
      const res = await fetchKubeOvnSubnets(cloudId); 
      const items = res?.data?.items || res?.items || [];
      setSubnets(items); 
      return items;
    } catch (e) { console.error(e); return []; }
  };

  const reloadImages = async () => {
    try {
      const res = await fetchHarvesterImages(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setImages(items);
    } catch (e) { console.error(e); }
  };

  const reloadScs = async () => {
    try {
      const res = await fetchHarvesterStorageClasses(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setScs(items);
    } catch (e) { console.error(e); }
  };

  const reloadGpuResources = async () => {
    try {
      setGpuLoading(true);
      const res = await fetchHarvesterGpuResources(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setGpuResources(items);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    } finally {
      setGpuLoading(false);
    }
  };

  // Handle form reset and initialization on tab switch
  useEffect(() => {
    if (!open) return;
    
    // Reset all fields when switching tabs to ensure "Single Selection" / "Single Task" isolation
    // 切换功能菜单时，强制重置表单，防止配置冲突
    form.resetFields();
    setSelectedGpuKey(null);

    if (!record) return;

    // Re-populate initial values for specific tabs
    switch (selectedKey) {
      case 'expand_system_disk': {
         loadSystemDiskSize();
         break;
      }
      case 'change_spec': {
        const { cpu, memory, maxSockets, maxMemory } = getCurrentSpec();
        const memGi = getMemoryInGi(memory);
        const maxMemGi = maxMemory ? getMemoryInGi(maxMemory) : undefined;

        const cpuSpec = record?.spec?.template?.spec?.domain?.cpu;
        const isHotPlug = cpuSpec?.maxSockets && cpuSpec?.maxSockets > (cpuSpec?.sockets || 1);

        form.setFieldsValue({
          cpu,
          memory: memGi,
          enableHotPlug: !!isHotPlug,
          cpuSockets: cpuSpec?.sockets || cpu,
          cpuCores: cpuSpec?.cores || 1,
          cpuThreads: cpuSpec?.threads || 1,
          maxSockets,
          maxMemory: maxMemGi
        });
        break;
      }
      case 'cpu_advanced': {
        const domain = record?.spec?.template?.spec?.domain;
        const cpuSpec = domain?.cpu;
        const resources = domain?.resources;

        // Check if Hot Plug is enabled on the VM
        const isHotPlug = cpuSpec?.maxSockets && cpuSpec?.maxSockets > (cpuSpec?.sockets || 1);

        const parseCpu = (v: any) => {
          if (!v) return null;
          const s = String(v);
          if (s.endsWith('m')) return parseInt(s) / 1000;
          return parseFloat(s);
        };

        const limit = parseCpu(resources?.limits?.cpu);

        form.setFieldsValue({
          cpuSockets: cpuSpec?.sockets || 1,
          cpuCores: cpuSpec?.cores || 1,
          cpuThreads: cpuSpec?.threads || 1,
          cpuModel: cpuSpec?.mode || 'host-passthrough',
          cpuModelCustom: cpuSpec?.mode === 'custom' ? cpuSpec?.model : '',
          dedicatedCPUPlacement: !!cpuSpec?.dedicatedCpuPlacement,
          isolateEmulatorThread: !!cpuSpec?.isolateEmulatorThread,
          cpuRequest: parseCpu(resources?.requests?.cpu),
          cpuLimit: limit,
          cpuBurstUnlimited: limit === null || limit === undefined,
          enableHotPlug: !!isHotPlug
        });
        break;
      }
      case 'mem_advanced': {
        const resources = record?.spec?.template?.spec?.domain?.resources;
        const reqMem = resources?.requests?.memory;
        const limMem = resources?.limits?.memory;

        const reqGi = getQuantityInGi(reqMem);
        const limGi = limMem ? getQuantityInGi(limMem) : null;

        form.setFieldsValue({
          memoryRequestGi: reqGi,
          memoryLimitGi: limGi,
          memoryBurstUnlimited: !limMem 
        });
        break;
      }
      case 'change_primary_nic': {
        (async () => {
          const [_, __, loadedSubnets] = await Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()]);
          
          // Initialize with current primary NIC
          const networks = record?.spec?.template?.spec?.networks || [];
          const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
          
          if (interfaces.length > 0) {
            const iface = interfaces[0];
            const net = networks.find((n: any) => n.name === iface.name);
            const networkName = net?.multus?.networkName || '';
            
            // Determine type
            let type = 'bridge';
            if (iface.masquerade) type = 'masquerade';
            else if (iface.sriov) type = 'sriov';
            else if (iface.macvtap) type = 'macvtap';
            
            // Check if it is a VPC subnet
            const targetSubnet = (loadedSubnets || []).find((s: any) => s?.metadata?.name === networkName);
            const isVpc = !!targetSubnet;

            // Load NetworkData for Static IP
            const networkDataObj = getParsedNetworkData(record);
            let eth = networkDataObj?.network?.ethernets?.['nic-0'] || networkDataObj?.network?.ethernets?.['nic0'];
            
            // Fallback: try to find by MAC address if key lookup failed
            if (!eth && iface.macAddress && networkDataObj?.network?.ethernets) {
               eth = Object.values(networkDataObj.network.ethernets).find((e: any) => 
                   e?.match?.macaddress?.toLowerCase() === iface.macAddress.toLowerCase()
               );
            }

            let ipAddress = undefined;
            let gateway = undefined;
            let dns = undefined;

            if (eth) {
               if (eth.addresses && eth.addresses.length > 0) ipAddress = eth.addresses[0];
               if (eth.gateway4) gateway = eth.gateway4;
               if (eth.nameservers?.addresses) dns = eth.nameservers.addresses.join(', ');
            }

            form.setFieldsValue({
              netMode: isVpc ? 'vpc' : 'flat',
              primaryNic: {
                name: networkName,
                type: type,
                model: iface.model || 'virtio',
                macAddress: iface.macAddress,
                vpc: targetSubnet?.spec?.vpc,
                subnet: networkName,
                ipAddress,
                gateway,
                dns
              }
            });
          }
        })();
        break;
      }
      case 'change_secondary_nic': {
        (async () => {
            const [_, __, loadedSubnets] = await Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()]);
            
            // Load existing secondary NICs (index 1+)
            const networks = record?.spec?.template?.spec?.networks || [];
            const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
            const networkDataObj = getParsedNetworkData(record);
            
            const secondaries = interfaces.slice(1).map((iface: any, idx: number) => {
               const net = networks.find((n: any) => n.name === iface.name);
               const networkName = net?.multus?.networkName || '';
               let type = 'bridge';
               if (iface.masquerade) type = 'masquerade';
               else if (iface.sriov) type = 'sriov';
               else if (iface.macvtap) type = 'macvtap';
               
               // Check if it is a VPC subnet
               const targetSubnet = (loadedSubnets || []).find((s: any) => s?.metadata?.name === networkName);
               const isVpc = !!targetSubnet;

               // Load Static IP info
               const ifaceKey = `nic-${idx + 1}`;
               let eth = networkDataObj?.network?.ethernets?.[ifaceKey];
               
               // Fallback: try to find by MAC address if key lookup failed
               if (!eth && iface.macAddress && networkDataObj?.network?.ethernets) {
                  eth = Object.values(networkDataObj.network.ethernets).find((e: any) => 
                      e?.match?.macaddress?.toLowerCase() === iface.macAddress.toLowerCase()
                  );
               }

               let ipAddress = undefined;
               let gateway = undefined;
               let dns = undefined;

               if (eth) {
                   if (eth.addresses && eth.addresses.length > 0) ipAddress = eth.addresses[0];
                   if (eth.gateway4) gateway = eth.gateway4;
                   if (eth.nameservers?.addresses) dns = eth.nameservers.addresses.join(', ');
               }

               return {
                 mode: isVpc ? 'vpc' : 'flat',
                 name: networkName,
                 type,
                 model: iface.model || 'virtio',
                 macAddress: iface.macAddress,
                 vpc: targetSubnet?.spec?.vpc,
                 subnet: networkName,
                 ipAddress,
                 gateway,
                 dns
               };
            });
            form.setFieldsValue({ secondaryNics: secondaries });
        })();
        break;
      }
      case 'change_gpu': {
        const gpus = record?.spec?.template?.spec?.domain?.devices?.gpus || [];
        const gpu = gpus.length > 0 ? gpus[0] : null;
        form.setFieldsValue({
          gpuMode: gpu ? 'passthrough' : undefined, 
          gpuResourceName: gpu?.deviceName,
        });
        break;
      }
      case 'change_os': {
        if (!images || images.length === 0) reloadImages();
        if (!scs || scs.length === 0) reloadScs();
        break;
      }
      case 'add_disk': {
        if (!scs || scs.length === 0) reloadScs();
        break;
      }
    }
  }, [selectedKey, open, record, form]);

  const openRestartConfirm = (namespace: string, vmName: string, force: boolean = false) => {
    Modal.confirm({
      title: '规格变更已提交，需要重启实例生效，是否重启实例',
      okText: '立即重启',
      cancelText: '手动重启',
      onOk: async () => {
        try {
          await rebootCloudProviderEcs(cloudId, `${namespace}/${vmName}`, force);
          message.success('重启指令已下发');
        } catch (e: any) {
          message.error(e?.message || '重启失败');
        }
      },
      onCancel: () => {}
    });
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;

      switch (selectedKey) {
        case 'expand_system_disk': {
          const newSize = values.systemDiskSize;
          if (systemDisk && newSize) {
             // 1. Update PVC
             await updateHarvesterVolume(cloudId, namespace, systemDisk, { sizeGi: newSize });
             
             // 2. Update VM Annotation if exists (for consistency)
             // Use activeRecord to ensure we have the latest annotations
             const currentAnnotations = (latestVm || record)?.metadata?.annotations || {};
             const templateStr = currentAnnotations['harvesterhci.io/volumeClaimTemplates'];
             
             if (templateStr) {
                 try {
                     const templates = JSON.parse(templateStr);
                     let hasChange = false;
                     const updatedTemplates = templates.map((t: any) => {
                         if (t.metadata.name === systemDisk) {
                             hasChange = true;
                             return {
                                 ...t,
                                 spec: {
                                     ...t.spec,
                                     resources: {
                                         ...t.spec.resources,
                                         requests: {
                                             ...t.spec.resources.requests,
                                             storage: `${newSize}Gi`
                                         }
                                     }
                                 }
                             };
                         }
                         return t;
                     });
                     
                     if (hasChange) {
                        await patchHarvesterVm(cloudId, namespace, vmName, {
                            annotations: {
                                'harvesterhci.io/volumeClaimTemplates': JSON.stringify(updatedTemplates)
                            }
                        });
                     }
                 } catch (e) {
                     console.warn('Failed to update volumeClaimTemplates annotation', e);
                 }
             }
             
             message.success('系统盘扩容请求已提交。请注意：您仍需在操作系统内部扩展文件系统。');
          }
          break;
        }
        case 'change_spec': {
          const payload: any = { 
            cpu: values.cpu,
            cpuSockets: values.cpuSockets,
            cpuCores: values.cpuCores,
            cpuThreads: values.cpuThreads,
            memory: `${values.memory}Gi`,
            enableHotPlug: values.enableHotPlug
          };

          // [Hot Plug Fix] Include limits if Hot Plug is enabled
          if (values.enableHotPlug) {
             if (values.maxSockets) payload.maxSockets = values.maxSockets;
             if (values.maxMemory) payload.maxMemory = `${values.maxMemory}Gi`;
          }

          await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);

          // [Hot Plug Logic] Check if we can skip restart prompt
          const isHotPlugActive = isHotPlugEnabledOnVm(); // Checks if currently enabled & no restart required
          const isKeepHotPlug = values.enableHotPlug;

          // Get current resources from active record (source of truth)
          const currentDomain = activeRecord?.spec?.template?.spec?.domain;
          const currentSockets = currentDomain?.cpu?.sockets || 1;
          const currentCores = currentDomain?.cpu?.cores || 1;
          const currentThreads = currentDomain?.cpu?.threads || 1;
          const currentTotalCpu = currentSockets * currentCores * currentThreads;

          const currentMemRaw = currentDomain?.resources?.requests?.memory || currentDomain?.memory?.guest;
          const currentMemGi = parseQuantity(currentMemRaw) / (1024**3);

          const newCpu = values.cpu; // Total Cores
          const newMemGi = Number(values.memory); // GiB

          // If Hot Plug is active, kept enabled, and resources are NOT decreasing (Hot Add), skip restart
          const arch = activeRecord?.spec?.template?.spec?.architecture;
          const isArm = arch === 'arm64' || arch === 'aarch64';
          const cpuChanged = newCpu !== currentTotalCpu;
          if (isHotPlugActive && isKeepHotPlug && newCpu >= currentTotalCpu && newMemGi >= currentMemGi && (!isArm || !cpuChanged)) {
             message.success('规格变更已提交（热扩容生效），无需重启实例');
          } else {
             openRestartConfirm(namespace, vmName, false);
          }
          break;
        }
        case 'cpu_advanced': {
          await updateHarvesterVmSpec(cloudId, namespace, vmName, {
             cpuSockets: values.cpuSockets,
             cpuCores: values.cpuCores,
             cpuThreads: values.cpuThreads,
             cpuModel: values.cpuModel,
             cpuModelCustom: values.cpuModelCustom,
             dedicatedCPUPlacement: values.dedicatedCPUPlacement,
             isolateEmulatorThread: values.isolateEmulatorThread,
             cpuRequest: values.cpuRequest,
             cpuLimit: values.cpuBurstUnlimited ? null : values.cpuLimit
          });
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'mem_advanced': {
          const reqGi = values.memoryRequestGi;
          const limGi = values.memoryLimitGi;
          const unlimited = values.memoryBurstUnlimited;

          await updateHarvesterVmSpec(cloudId, namespace, vmName, {
             memoryRequestGi: reqGi,
             memoryLimit: unlimited ? null : (limGi ? `${limGi}Gi` : null)
          });
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_os': {
          const rootSize = values.newOsRootSize ? `${values.newOsRootSize}Gi` : '40Gi';
          await updateHarvesterVmSpec(cloudId, namespace, vmName, {
             action: 'reinstall',
             image: values.newOsImage,
             rootSize: rootSize,
             bus: values.newOsBus,
             storageClassName: values.storageClassName,
             rootDeviceType: values.rootDeviceType
          });
          // message.success('重装系统请求已提交。请确保实例处于【停止】状态后，再点击【启动】（不要直接重启）。');
          openRestartConfirm(namespace, vmName, true);
          break;
        }
        case 'add_disk': {
          // 1. Create Volume
          const volName = values.newDiskName;
          await createHarvesterVolume(cloudId, {
            namespace,
            name: volName,
            size: values.newDiskSize,
            storageClassName: values.newDiskSc
          });
          // 2. Attach to VM
          await attachHarvesterVolumeToVmByName(cloudId, namespace, vmName, {
            name: volName,
            diskName: volName,
            pvcName: volName,
            pvcNamespace: namespace,
            bus: values.newDiskBus
          });
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_gpu': {
           const mode = values.gpuMode;
           const gpuName = values.gpuResourceName;
           // Patch VM to add/remove GPU
           await patchHarvesterVm(cloudId, namespace, vmName, {
              gpuResourceName: mode === 'none' ? '' : gpuName
           });
           message.success('GPU配置已更新');
           openRestartConfirm(namespace, vmName, false);
           break;
        }
        case 'change_primary_nic': {
           // Construct new networks list with modified primary
           const nic = values.primaryNic;
           const netMode = values.netMode || 'flat';
           // We need to fetch current VM state to be safe, but using record is okay for now
           const networks = [...(record?.spec?.template?.spec?.networks || [])];
           const interfaces = [...(record?.spec?.template?.spec?.domain?.devices?.interfaces || [])];
           
           if (interfaces.length > 0) {
              // Update interface[0]
              const interfaceConfig: any = {
                 name: networks[0]?.name || 'default', // Keep link name
                 model: nic.model || 'virtio',
              };
              
              // Set MAC address if provided
              if (nic.macAddress) {
                 interfaceConfig.macAddress = nic.macAddress;
              }
              
              // Set interface type (bridge, masquerade, sriov, macvtap)
              if (nic.type === 'masquerade') {
                 interfaceConfig.masquerade = {};
              } else if (nic.type === 'sriov') {
                 interfaceConfig.sriov = {};
              } else if (nic.type === 'macvtap') {
                 interfaceConfig.macvtap = {};
              } else {
                 interfaceConfig.bridge = {};
              }
              
              interfaces[0] = interfaceConfig;
              
              // Update network[0]
              let pNetName = nic.name;
              
              // Handle different network modes
              if (netMode === 'vpc') {
                 // VPC network: subnet name is the network name
                 pNetName = nic.subnet || nic.name || '';
              } else if (netMode === 'flat') {
                 // Flat network: NAD name (namespace/name format)
                 if (!pNetName) {
                    // If no name selected, use pod network
                    pNetName = 'default/pod';
                 } else if (!pNetName.includes('/')) {
                    // If name doesn't have namespace, try to resolve it from loaded NADs
                    const found = nads.find((n: any) => n.metadata.name === pNetName);
                    if (found) {
                       pNetName = `${found.metadata.namespace}/${found.metadata.name}`;
                    } else {
                       // Fallback: assume it's in default namespace
                       pNetName = `default/${pNetName}`;
                    }
                 }
              } else if (netMode === 'passthrough') {
                 // Passthrough network: SR-IOV/Macvtap NAD
                 if (!pNetName) {
                    pNetName = 'default/pod';
                 } else if (!pNetName.includes('/')) {
                    const found = nads.find((n: any) => n.metadata.name === pNetName);
                    if (found) {
                       pNetName = `${found.metadata.namespace}/${found.metadata.name}`;
                    } else {
                       pNetName = `default/${pNetName}`;
                    }
                 }
              } else {
                 pNetName = pNetName || 'default/pod';
              }

              // Build network configuration
              if (pNetName === 'default/pod' || !pNetName) {
                 // Pod network: no multus needed
                 networks[0] = {
                    name: networks[0]?.name || 'default',
                 };
              } else {
                 // Multus network: NAD or VPC subnet
                 networks[0] = {
                    name: networks[0]?.name || 'default',
                    multus: { networkName: pNetName }
                 };
              }
              
              const payload: any = { networks, interfaces };

              // --- Static IP Handling (NetworkData) ---
              let networkDataObj = getParsedNetworkData(record);
              let hasNetworkDataChange = false;
              const ifaceName = 'nic-0'; // Primary NIC

              if (nic.ipAddress) {
                 hasNetworkDataChange = true;
                 if (!networkDataObj.network) networkDataObj.network = { version: 2, ethernets: {} };
                 if (!networkDataObj.network.ethernets) networkDataObj.network.ethernets = {};
                 
                 const mac = nic.macAddress || interfaces[0].macAddress;
                 const ethConfig: any = {
                     addresses: [nic.ipAddress]
                 };
                 
                 if (mac) {
                     ethConfig.match = { macaddress: mac };
                 } else {
                     ethConfig.match = { name: 'e*' };
                 }

                 if (nic.gateway) ethConfig.gateway4 = nic.gateway;
                 if (nic.dns) {
                    const dnsList = nic.dns.split(/[,;\s]+/).filter((d: string) => d.trim());
                    if (dnsList.length > 0) {
                        ethConfig.nameservers = { addresses: dnsList };
                    }
                 }
                 // Use nic-0 as key
                 networkDataObj.network.ethernets[ifaceName] = ethConfig;
                 
                 // Clean up legacy 'nic0' key if it exists to avoid duplicates/confusion
                 if (networkDataObj.network.ethernets['nic0']) {
                     delete networkDataObj.network.ethernets['nic0'];
                 }
              } else {
                 // Remove static config if exists
                 if (networkDataObj?.network?.ethernets?.[ifaceName]) {
                     delete networkDataObj.network.ethernets[ifaceName];
                     hasNetworkDataChange = true;
                 }
                 if (networkDataObj?.network?.ethernets?.['nic0']) {
                     delete networkDataObj.network.ethernets['nic0'];
                     hasNetworkDataChange = true;
                 }
              }
                 
              if (hasNetworkDataChange) {
                 payload.networkData = yaml.dump(networkDataObj);
              }
              
              await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
              openRestartConfirm(namespace, vmName, false);
           }
           break;
        }
        case 'change_secondary_nic': {
           const secondaryNics = values.secondaryNics || [];
           
           // Fetch current state
           const currentNetworks = record?.spec?.template?.spec?.networks || [];
           const currentInterfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
           
           // Keep Primary NIC (index 0) if exists
           const newNetworks = currentNetworks.length > 0 ? [currentNetworks[0]] : [];
           const newInterfaces = currentInterfaces.length > 0 ? [currentInterfaces[0]] : [];
           
           let networkDataObj = getParsedNetworkData(record);
           let hasNetworkDataChange = false;

           // Append Secondary NICs
           secondaryNics.forEach((nic: any, idx: number) => {
              const ifaceName = `nic-${idx + 1}`; // consistent naming for secondary nics
              let mac = nic.macAddress;

              // Auto-generate MAC if Static IP is used but MAC is missing
              if (nic.ipAddress && !mac) {
                  mac = generateMacAddress();
              }

              // Interface
              newInterfaces.push({
                 name: ifaceName,
                 model: nic.model || 'virtio',
                 macAddress: mac,
                 [nic.type || 'bridge']: {} 
              });
              
              // Network
              let sNetName = nic.name;
              // Handle flat network name resolution
              if (nic.mode === 'flat' && sNetName && !sNetName.includes('/')) {
                  const found = nads.find((n: any) => n.metadata.name === sNetName);
                  if (found) sNetName = `${found.metadata.namespace}/${found.metadata.name}`;
              }
              // Handle VPC network name (subnet name)
              if (nic.mode === 'vpc') {
                  sNetName = nic.subnet; // For VPC, we use subnet name as networkName
              }

              newNetworks.push({
                 name: ifaceName,
                 multus: { networkName: sNetName }
              });

              // Update NetworkData for Static IP
              if (nic.ipAddress) {
                  hasNetworkDataChange = true;
                  if (!networkDataObj.network) networkDataObj.network = { version: 2, ethernets: {} };
                  if (!networkDataObj.network.ethernets) networkDataObj.network.ethernets = {};
                  
                  const ethConfig: any = {
                      match: { macaddress: mac },
                      addresses: [nic.ipAddress]
                  };
                  if (nic.gateway) ethConfig.gateway4 = nic.gateway;
                  if (nic.dns) {
                      const dnsList = nic.dns.split(/[,;\s]+/).filter((d: string) => d.trim());
                      if (dnsList.length > 0) {
                          ethConfig.nameservers = { addresses: dnsList };
                      }
                  }
                  networkDataObj.network.ethernets[ifaceName] = ethConfig;
              } else {
                  // If switching back to DHCP, remove static config for this interface
                  if (networkDataObj?.network?.ethernets?.[ifaceName]) {
                      delete networkDataObj.network.ethernets[ifaceName];
                      hasNetworkDataChange = true;
                  }
              }
           });

           // Clean up removed secondary NICs from networkData (e.g. if we had nic-2 and now only have nic-1)
           // Logic: Iterate keys in ethernets, if key starts with 'nic-' and index > secondaryNics.length, delete it.
           // However, naming convention 'nic-{i}' relies on order.
           // Safe approach: We rebuilt the list. Any 'nic-X' where X > secondaryNics.length should be removed.
           // Note: Primary is 'nic-0' or 'nic0' usually. Secondary starts at 'nic-1'.
           if (networkDataObj?.network?.ethernets) {
               Object.keys(networkDataObj.network.ethernets).forEach(key => {
                   if (key.startsWith('nic-')) {
                       const idx = parseInt(key.split('-')[1]);
                       if (!isNaN(idx) && idx > secondaryNics.length) {
                           delete networkDataObj.network.ethernets[key];
                           hasNetworkDataChange = true;
                       }
                   }
               });
           }

           const payload: any = {
              networks: newNetworks,
              interfaces: newInterfaces
           };

           if (hasNetworkDataChange) {
               payload.networkData = yaml.dump(networkDataObj);
           }

           await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
           openRestartConfirm(namespace, vmName, false);
           break;
        }
        // ... other cases
        default:
          break;
      }
      onOk();
      onClose();
    } catch (e: any) {
      console.error(e);
      // 如果不是表单校验错误，则提示后端/逻辑异常
      if (!e?.errorFields) {
        let errorMsg = e?.message || '操作失败';
        
        if (typeof errorMsg === 'string') {
          // KubeVirt/Harvester Webhook Error Translation
          if (errorMsg.includes('Guest memory is greater than the configured maxGuest memory')) {
            errorMsg = '调整后的内存超过了配置的最大限制（热扩容上限），请求被拒绝。';
          }
        }

        message.error(errorMsg);
      }
    }
  };

  const isRestartRequired = useMemo(() => {
    const conditions = activeRecord?.status?.conditions || [];
    return conditions.some((c: any) => c.type === 'RestartRequired' && c.status === 'True');
  }, [activeRecord]);

  return {
    form,
    selectedKey, setSelectedKey,
    scs, images, gpuResources, selectedGpuKey, setSelectedGpuKey,
    nads, vpcs, subnets, setVpcs,
    gpuKeyword, setGpuKeyword, gpuLoading,
    reloadScs, reloadImages, reloadGpuResources, reloadNads, reloadVpcs, reloadSubnets,
    handleSubmit,
    systemDisk,
    systemDiskSize,
    systemDiskLoading,
    getCurrentSpec,
    getMemoryInGi,
    isHotPlugEnabledOnVm,
    isRestartRequired,
    isHotPlugInProgress
  };
};
