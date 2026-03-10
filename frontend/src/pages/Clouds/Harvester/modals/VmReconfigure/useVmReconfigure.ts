import { useState, useEffect, useMemo } from 'react';
import { Form, message, Modal } from 'antd';
import yaml from 'js-yaml';
import { 
  updateHarvesterVmSpec, createHarvesterVolume, attachHarvesterVolumeToVmByName, 
  fetchHarvesterGpuResources, patchHarvesterVm, fetchHarvesterNads,
  fetchKubeOvnVpcs, fetchKubeOvnSubnets, fetchHarvesterImages, fetchHarvesterStorageClasses,
  fetchHarvesterVolume, fetchHarvesterVmDetail, updateHarvesterVolume, fetchHarvesterVolumes,
  detachHarvesterVolumeFromVm, fetchHarvesterVMAggregated
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
  // 添加数据盘：创建/挂载两步按钮的 loading 状态
  const [diskCreating, setDiskCreating] = useState(false);
  const [diskAttaching, setDiskAttaching] = useState(false);
  // 添加数据盘：可选择"已有磁盘(PVC)"进行挂载
  const [availableDiskPvcs, setAvailableDiskPvcs] = useState<any[]>([]);
  // 解绑数据盘：loading 状态
  const [diskDetaching, setDiskDetaching] = useState(false);
  
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
       // 使用聚合接口获取 VM 及关联资源（包括 related.volumes），与虚拟卷详情页保持一致
       fetchHarvesterVMAggregated(cloudId, record.metadata.namespace, record.metadata.name)
         .then((res: any) => {
            // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
            const data = res?.data?.vm ? res.data : res;
            
            // 合并 vm 和 related 数据到 latestVm，确保 DetachDataDisk 组件能获取到 related.volumes
            const updatedVm = data?.vm || data;
            if (updatedVm && data?.related) {
              updatedVm.related = data.related;
            }
            
            setLatestVm(updatedVm);
         })
         .catch((err: any) => {
            console.error('Failed to fetch aggregated VM data:', err);
            // 如果聚合接口失败，回退到普通接口
            fetchHarvesterVmDetail(cloudId, record.metadata.namespace, record.metadata.name)
              .then((res: any) => {
                setLatestVm(res?.data || res);
              })
              .catch((fallbackErr: any) => {
                console.error('回退获取也失败:', fallbackErr);
              });
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
      setSelectedKey(initialConfigType === 'mem_advanced' ? 'cpu_advanced' : initialConfigType);
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
    
    // [Harvester 兼容] 在热扩容模式下，优先使用 domain.memory.guest
    // 复刻 Harvester 逻辑：通过 Annotation 判断热扩容状态
    // 如果启用了热扩容，domain.memory.guest 不会被 mutator 修改，是用户实际设置的值
    const annotations = activeRecord?.metadata?.annotations || {};
    const isHotPlug = annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
    if (mem === undefined || mem === null || isHotPlug) {
      // 热扩容模式下，优先使用 domain.memory.guest
      mem = activeRecord?.spec?.template?.spec?.domain?.memory?.guest;
      // 如果没有 guest 内存，再使用 requests.memory（非热扩容模式）
      if (!mem && !isHotPlug) {
        mem = activeRecord?.spec?.template?.spec?.domain?.resources?.requests?.memory;
      }
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

  // [Harvester 兼容] 判断虚拟机是否“配置了”CPU 和内存热扩容（单纯看 Annotation）
  // 复刻 Harvester 逻辑：通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 判断
  const isHotPlugConfiguredOnVm = useMemo(() => {
    const annotations = activeRecord?.metadata?.annotations || {};
    return annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
  }, [activeRecord]);

  // [Harvester 兼容] 判断虚拟机当前是否“可以进行热扩容操作”
  // 逻辑：在已配置热扩容的前提下，如果存在 RestartRequired / HotPlugInProgress，则视为当前不可热扩容
  const isHotPlugEnabledOnVm = useMemo(() => {
    if (!isHotPlugConfiguredOnVm) return false;

    const conditions = activeRecord?.status?.conditions || [];
    const isRestartRequired = conditions.some((c: any) => c.type === 'RestartRequired' && c.status === 'True');
    const isHotPlugInProgress = conditions.some((c: any) => (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True');

    // 存在待重启或正在热扩容中的条件时，本次不允许再走热扩容路径
    if (isRestartRequired || isHotPlugInProgress) return false;

    return true;
  }, [isHotPlugConfiguredOnVm, activeRecord]);

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
        const { cpu, memory } = getCurrentSpec();
        const memGi = getMemoryInGi(memory);

        const cpuSpec = record?.spec?.template?.spec?.domain?.cpu;
        const sockets = cpuSpec?.sockets || 1;
        const cores = cpuSpec?.cores || 1;
        const threads = cpuSpec?.threads || 1;
        
        // 如果已开启热扩容，cpu 应该等于 sockets（因为 cores=1, threads=1）
        const isHotPlug = cpuSpec?.maxSockets && cpuSpec?.maxSockets > sockets;
        
        // 计算总CPU值：
        // 1. 如果已开启热扩容，总CPU = sockets（因为cores=1, threads=1）
        // 2. 否则，优先使用 getCurrentSpec 返回的 cpu 值
        // 3. 如果 cpu 不存在，计算 sockets * cores * threads
        let cpuValue: number;
        if (isHotPlug) {
          // 已开启热扩容：总CPU = sockets
          cpuValue = sockets;
        } else {
          // 未开启热扩容：使用计算值或 getCurrentSpec 的值
          const calculatedCpu = sockets * cores * threads;
          cpuValue = cpu || calculatedCpu;
        }
        
        // 确保 cpuValue 是有效数字
        cpuValue = cpuValue > 0 ? cpuValue : 1;

        form.setFieldsValue({
          cpu: cpuValue,
          memory: memGi,
          cpuSockets: sockets,
          cpuCores: cores,
          cpuThreads: threads
        });
        break;
      }
      case 'hotplug_settings': {
        const { cpu, memory, maxSockets, maxMemory } = getCurrentSpec();
        const maxMemGi = maxMemory ? getMemoryInGi(maxMemory) : undefined;
        // [修复] 使用 getCurrentSpec() 返回的 memory 值计算，确保一致性
        const currentMemGi = getMemoryInGi(memory);

        // [Harvester 兼容] 使用 Annotation 判断热扩容状态
        const annotations = record?.metadata?.annotations || {};
        const isHotPlug = annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';

        form.setFieldsValue({
          enableHotPlug: !!isHotPlug,
          maxSockets: maxSockets || (cpu * 4),
          maxMemory: maxMemGi || (currentMemGi * 4)
        });
        break;
      }
      case 'cpu_advanced': {
        const domain = activeRecord?.spec?.template?.spec?.domain;
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
        const reqMem = resources?.requests?.memory;
        const limMem = resources?.limits?.memory;
        const reqGi = reqMem ? getQuantityInGi(reqMem) : undefined;
        const limGi = limMem ? getQuantityInGi(limMem) : undefined;

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
          memoryRequestGi: reqGi,
          memoryLimitGi: limGi,
          enableHotPlug: !!isHotPlug
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
        // 预加载当前 namespace 下可挂载的 PVC（用于“选择已有磁盘”）
        if (open && cloudId && record?.metadata?.namespace) {
          void (async () => {
            try {
              const res = await fetchHarvesterVolumes(cloudId, false);
              const items = (res as any)?.data?.items || [];
              const ns = record.metadata.namespace;
              const getPvcName = (pvc: any) => pvc?.rawData?.metadata?.name || pvc?.metadata?.name || pvc?.name || '';
              const getPvcNs = (pvc: any) => pvc?.rawData?.metadata?.namespace || pvc?.metadata?.namespace || pvc?.namespace || '';
              const vmClaimNames = new Set(
                (record?.spec?.template?.spec?.volumes || [])
                  .map((v: any) => v?.persistentVolumeClaim?.claimName)
                  .filter(Boolean)
              );
              const filtered = items.filter((pvc: any) => {
                const pvcNs = getPvcNs(pvc);
                const pvcName = getPvcName(pvc);
                if (!pvcName || pvcNs !== ns) return false;
                // 已经在 VM 上的 PVC 不应该再次挂载
                if (vmClaimNames.has(pvcName)) return false;
                return true;
              });
              setAvailableDiskPvcs(filtered);
            } catch {
              // ignore
            }
          })();
        }
        break;
      }
    }
  }, [selectedKey, open, record, latestVm, form]);

  // 专门针对 CPU 高级配置做一次“精确回显”，确保 dedicatedCPUPlacement 等字段与最新 VM 保持一致
  useEffect(() => {
    if (!open) return;
    if (selectedKey !== 'cpu_advanced') return;

    const domain = activeRecord?.spec?.template?.spec?.domain;
    const cpuSpec = domain?.cpu;
    const resources = domain?.resources;
    if (!cpuSpec || !resources) return;

    const parseCpu = (v: any) => {
      if (!v) return null;
      const s = String(v);
      if (s.endsWith('m')) return parseInt(s) / 1000;
      return parseFloat(s);
    };

    const limit = parseCpu(resources?.limits?.cpu);

    form.setFieldsValue({
      dedicatedCPUPlacement: !!cpuSpec?.dedicatedCpuPlacement,
      isolateEmulatorThread: !!cpuSpec?.isolateEmulatorThread,
      cpuRequest: parseCpu(resources?.requests?.cpu),
      cpuLimit: limit,
    });
  }, [open, selectedKey, activeRecord, form]);

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
          // [关键检查] 如果热扩容正在进行中，禁止任何变更操作
          const conditions = activeRecord?.status?.conditions || [];
          const isHotPlugInProgress = conditions.some((c: any) => 
            (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True'
          );
          
          if (isHotPlugInProgress) {
            message.warning('热扩容操作正在进行中，请等待操作完成后再进行变更');
            return;
          }
          
          // 检查当前虚拟机的CPU拓扑和热扩容状态
          const currentDomain = activeRecord?.spec?.template?.spec?.domain;
          const currentCores = currentDomain?.cpu?.cores || 1;
          const currentThreads = currentDomain?.cpu?.threads || 1;
          const currentSockets = currentDomain?.cpu?.sockets || 1;
          const currentTotalCpu = currentSockets * currentCores * currentThreads;
          
          // [热扩容配置判断] 同时检查 Annotation 和 maxSockets，确保准确识别热扩容能力
          // 根据 Harvester 源码（pkg/util/virtualmachine/virtualmachine.go:SupportCPUAndMemoryHotplug），
          // 热扩容能力通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 控制
          const hotPlugAnnotation = activeRecord?.metadata?.annotations?.['harvesterhci.io/enableCPUAndMemoryHotplug'];
          const isHotPlugConfiguredByAnnotation = hotPlugAnnotation?.toLowerCase() === 'true';
          const hasMaxSockets = currentDomain?.cpu?.maxSockets && currentDomain.cpu.maxSockets > currentSockets;
          // 只有当 Annotation 存在且 maxSockets 配置了，才认为已配置热扩容
          const isCurrentlyHotPlug = isHotPlugConfiguredByAnnotation && hasMaxSockets;
          
          // 检查用户是否修改了规格
          // [关键修复] 统一使用 getCurrentSpec 获取当前内存值，确保表单初始化和提交验证使用相同的数据源
          const { memory: currentMemRaw } = getCurrentSpec();
          const currentMemGi = getMemoryInGi(currentMemRaw);
          const cpuChanged = values.cpu !== undefined && values.cpu !== currentTotalCpu;
          
          // [关键修复] 只有当表单中的内存值与当前内存值确实不同时，才认为用户修改了内存
          // 使用容差比较避免浮点数精度问题，但如果差值很小（<=0.01），认为没有变化
          const formMemory = values.memory !== undefined ? Number(values.memory) : undefined;
          const memoryChanged = formMemory !== undefined && Math.abs(formMemory - currentMemGi) > 0.01;
          
          // [注意] change_spec 中不再有 enableHotPlug 字段，热扩容开关已拆分为独立功能
          // 这里只检查当前VM是否已配置热扩容，用于限制规则判断
          
          // [热扩容限制] 如果已开启热扩容，只允许增加资源，不允许减少
          if (isCurrentlyHotPlug) {
            if (cpuChanged && values.cpu < currentTotalCpu) {
              message.warning('热扩容模式下不允许减少CPU，请先关闭热扩容后再修改');
              return;
            }
            // [关键修复] 只有当用户确实修改了内存（memoryChanged=true）且新值小于当前值时，才报错
            // 如果用户没有修改内存（memoryChanged=false），即使进入这个判断也不会报错
            if (memoryChanged && formMemory !== undefined && formMemory < currentMemGi - 0.01) {
              message.warning('热扩容模式下不允许减少内存，请先关闭热扩容后再修改');
              return;
            }
            // 检查是否超出热扩容上限
            const maxSockets = currentDomain?.cpu?.maxSockets;
            const maxMemory = currentDomain?.memory?.maxGuest;
            if (cpuChanged && maxSockets && values.cpu > maxSockets) {
              message.warning(`CPU数量不能超过热扩容上限 ${maxSockets} 核`);
              return;
            }
            if (memoryChanged && maxMemory) {
              const maxMemGi = parseQuantity(maxMemory) / (1024**3);
              if (Number(values.memory) > maxMemGi) {
                message.warning(`内存数量不能超过热扩容上限 ${maxMemGi} GiB`);
                return;
              }
            }
          }
          
          // [注意] change_spec 中不再处理热扩容开关变更，热扩容开关已拆分为独立功能
          
          // 如果已开启热扩容，确保拓扑符合要求（cores=1, threads=1）
          // 如果当前拓扑不符合要求，需要先修复拓扑（但这种情况应该很少见，因为开启热扩容时会自动设置）
          const needTopologyFix = isCurrentlyHotPlug && (currentCores !== 1 || currentThreads !== 1);
          
          if (needTopologyFix) {
            // 第一步：先设置拓扑为 sockets=x（现有CPU数量总和）, cores=1, threads=1（不开启热扩容）
            const topologyPayload: any = {
              cpu: currentTotalCpu, // 保持总CPU数不变
              cpuSockets: currentTotalCpu, // sockets = 现有CPU数量总和
              cpuCores: 1,
              cpuThreads: 1,
              enableHotPlug: false // 先不开启热扩容，只设置拓扑
            };
            
            await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
            message.info('已先设置CPU拓扑为cores=1, threads=1，正在开启热扩容...');
            
            // 刷新VM状态
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              setLatestVm(refreshedVm?.data || refreshedVm);
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
              console.warn('刷新VM状态失败，继续执行', e);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          // 第二步：构建规格变更payload
          // [注意] change_spec 只处理规格变更，不处理热扩容开关变更
          let payload: any = {};
          
          // 如果当前已开启热扩容，使用热扩容模式的最小化 payload
          if (isCurrentlyHotPlug) {
            // [热扩容模式] 只传递必要的字段，避免触发 RestartRequired
            // 1. CPU: 只传递 cpu（后端会转换为 sockets），不传递 cpuCores/cpuThreads（如果已经是1）
            // 2. 内存: 只传递 memory（后端会使用 domain.memory.guest），不传递 resources
            if (values.cpu !== undefined) {
              payload.cpu = values.cpu;
              // 不传递 cpuSockets，因为后端会根据 cpu 自动设置 sockets
              // 不传递 cpuCores 和 cpuThreads，因为后端会检查当前值，如果已经是1则不会在Patch中包含
            }
            if (values.memory !== undefined) {
              payload.memory = `${values.memory}Gi`;
            }
          } else {
            // [标准模式] 传递完整的拓扑信息
            payload = { 
              cpu: values.cpu,
              cpuSockets: values.cpuSockets,
              cpuCores: values.cpuCores,
              cpuThreads: values.cpuThreads,
              memory: `${values.memory}Gi`
            };
          }
          
          // 如果需要修复拓扑，先修复
          if (needTopologyFix) {
            // 先设置正确的拓扑
            const topologyPayload: any = {
              cpu: currentTotalCpu,
              cpuSockets: currentTotalCpu,
              cpuCores: 1,
              cpuThreads: 1
            };
            await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
            message.info('已修复CPU拓扑为cores=1, threads=1');
            
            // 刷新VM状态
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              setLatestVm(refreshedVm?.data || refreshedVm);
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
              console.warn('刷新VM状态失败，继续执行', e);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);

          // [Hot Plug Logic] Check if we can skip restart prompt
          // 如果第一步修改了拓扑，需要重新获取最新的VM状态
          let finalDomain = currentDomain;
          if (needTopologyFix) {
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              const refreshedData = refreshedVm?.data || refreshedVm;
              finalDomain = refreshedData?.spec?.template?.spec?.domain;
              setLatestVm(refreshedData);
            } catch (e) {
              console.warn('刷新VM状态失败，使用原始状态', e);
            }
          }
          
          // [注意] change_spec 中不再有 enableHotPlug 字段，使用 isCurrentlyHotPlug 判断是否“已配置”热扩容
          // 这里的 isHotPlugActive 用于判断“本次操作是否按热扩容路径执行”，因此直接复用 isCurrentlyHotPlug，
          // 上面已经做过 isHotPlugInProgress 校验，这里不再重复依赖状态条件，避免误判为需要重启。
          const isHotPlugActive = !!isCurrentlyHotPlug;

          // Get current resources from active record (source of truth)
          // 使用最新的domain状态（如果刷新了则用新的，否则用原来的）
          const finalSockets = finalDomain?.cpu?.sockets || currentSockets;
          const finalCores = finalDomain?.cpu?.cores || currentCores;
          const finalThreads = finalDomain?.cpu?.threads || currentThreads;
          const finalTotalCpu = finalSockets * finalCores * finalThreads;

          // 使用最新的domain状态获取内存（如果刷新了则用新的，否则用原来的）
          const finalMemRaw = finalDomain?.resources?.requests?.memory || finalDomain?.memory?.guest || currentMemRaw;
          // [关键修复] 统一使用 getMemoryInGi 计算内存值，确保与表单初始化时的计算方式一致（向上取整）
          // 这样可以避免因为计算方式不同（直接除法 vs 向上取整）导致的误判
          const finalMemGi = finalMemRaw ? getMemoryInGi(finalMemRaw) : currentMemGi;

          const newCpu = values.cpu !== undefined ? Number(values.cpu) : finalTotalCpu; // Total Cores，如果未传则保持原值
          // [关键修复] 如果用户没有修改内存（values.memory 为 undefined），应该使用表单初始化时的值（currentMemGi），而不是 finalMemGi
          // 这样可以确保即使用户只改了 CPU，内存比较逻辑也能正确工作
          const newMemGi = values.memory !== undefined ? Number(values.memory) : currentMemGi; // GiB，如果未传则使用表单初始值

          // [热扩容判断] 如果已配置热扩容，且本次操作是"只增不减"的标准热扩容场景，则无需重启
          const arch = activeRecord?.spec?.template?.spec?.architecture;
          const isArm = arch === 'arm64' || arch === 'aarch64';
          
          // [关键修复] 统一使用表单值与初始值的比较来判断是否修改了CPU/内存
          // 这样可以避免因为计算方式不同或刷新后的值变化导致的误判
          // 注意：这里使用之前已经计算好的 cpuChanged 和 memoryChanged（基于表单值和初始值的比较）
          const finalCpuChanged = cpuChanged; // 复用之前计算的 cpuChanged
          const finalMemChanged = memoryChanged; // 复用之前计算的 memoryChanged（基于 formMemory 和 currentMemGi）
          
          // 检查是否是"只增不减"的热扩容场景（基于表单值和当前实际值的比较）
          const isCpuHotAdd = !finalCpuChanged || (newCpu >= finalTotalCpu - 0.01);
          const isMemHotAdd = !finalMemChanged || (newMemGi >= currentMemGi - 0.01); // 使用 currentMemGi 而不是 finalMemGi
          
          // ARM架构不支持CPU热插拔，但支持内存热插拔
          const isCpuHotPlugAllowed = !isArm || !finalCpuChanged;
          
          // [关键修复] 检查 VM 是否可迁移（内存热插拔的前提条件）
          // KubeVirt 要求：Memory-hotplug is only available for migratable VMs
          // 通过检查 VMI 的 status.conditions 中 LiveMigratable condition（status 为 True 表示可迁移）
          const vmi = activeRecord?.vmi || activeRecord?.vmiRaw;
          const vmiConditions = vmi?.status?.conditions || [];
          const isMigratable = vmiConditions.some(
            (c: any) => 
              (c.type === 'LiveMigratable' || c.type === 'VirtualMachineInstanceIsMigratable') && 
              c.status === 'True'
          );
          
          // [关键修复] 如果已配置热扩容（isHotPlugActive），且满足以下条件，则走热扩容路径（无需重启）：
          // 1. CPU：未修改 或 （增加且非ARM架构）- CPU 热插拔不需要 VM 可迁移
          // 2. 内存：未修改 或 （增加 且 VM 可迁移）- 内存热插拔需要 VM 可迁移
          // 根据 Harvester 源码（pkg/api/vm/formatter.go:canCPUAndMemoryHotplug），CPU 热扩容不检查 migratable
          const canUseCpuHotPlug = isHotPlugActive && isCpuHotAdd && isCpuHotPlugAllowed;
          // 内存热插拔需要 VM 可迁移（KubeVirt 要求："Memory-hotplug is only available for migratable VMs"）
          const canUseMemHotPlug = isHotPlugActive && isMemHotAdd && (isMigratable || !finalMemChanged);
          
          // 如果只改了CPU，或只改了内存（且可迁移），或两者都改且都满足条件，则可以使用热扩容
          const canUseHotPlug = 
            (finalCpuChanged && !finalMemChanged && canUseCpuHotPlug) ||
            (!finalCpuChanged && finalMemChanged && canUseMemHotPlug) ||
            (finalCpuChanged && finalMemChanged && canUseCpuHotPlug && canUseMemHotPlug) ||
            (!finalCpuChanged && !finalMemChanged); // 都没改，不需要重启
          
          if (canUseHotPlug) {
             message.success('规格变更已提交（热扩容生效），无需重启实例');
          } else {
             // 如果内存变更但 VM 不可迁移，给出明确提示
             if (finalMemChanged && !isMigratable && isHotPlugActive) {
               message.warning('内存热扩容需要 VM 可迁移，当前 VM 不可迁移，将需要重启生效');
             }
             openRestartConfirm(namespace, vmName, false);
          }
          break;
        }
        case 'hotplug_settings': {
          // [关键检查] 如果热扩容正在进行中，禁止任何变更操作
          const conditions = activeRecord?.status?.conditions || [];
          const isHotPlugInProgress = conditions.some((c: any) => 
            (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True'
          );
          
          if (isHotPlugInProgress) {
            message.warning('热扩容操作正在进行中，请等待操作完成后再进行变更');
            return;
          }
          
          // 检查当前虚拟机的CPU拓扑和热扩容状态
          const currentDomain = activeRecord?.spec?.template?.spec?.domain;
          const currentCores = currentDomain?.cpu?.cores || 1;
          const currentThreads = currentDomain?.cpu?.threads || 1;
          const currentSockets = currentDomain?.cpu?.sockets || 1;
          const currentTotalCpu = currentSockets * currentCores * currentThreads;
          
          // [热扩容配置判断] 同时检查 Annotation 和 maxSockets，确保准确识别热扩容能力
          const hotPlugAnnotation = activeRecord?.metadata?.annotations?.['harvesterhci.io/enableCPUAndMemoryHotplug'];
          const isHotPlugConfiguredByAnnotation = hotPlugAnnotation?.toLowerCase() === 'true';
          const hasMaxSockets = currentDomain?.cpu?.maxSockets && currentDomain.cpu.maxSockets > currentSockets;
          const isCurrentlyHotPlug = isHotPlugConfiguredByAnnotation && hasMaxSockets;
          
          const hotPlugChanged = values.enableHotPlug !== isCurrentlyHotPlug;
          
          // 如果要开启热扩容，且当前拓扑不是cores=1, threads=1，需要先设置拓扑
          const needTopologyFix = values.enableHotPlug && !isCurrentlyHotPlug && (currentCores !== 1 || currentThreads !== 1);
          
          if (needTopologyFix) {
            // 第一步：先设置拓扑为 sockets=x（现有CPU数量总和）, cores=1, threads=1
            // [关键修复] 不传入 enableHotPlug，避免触发热扩容逻辑（设置 maxSockets = 1）
            // 我们只是调整拓扑，不应该修改热扩容状态
            const topologyPayload: any = {
              cpu: currentTotalCpu, // 保持总CPU数不变
              cpuSockets: currentTotalCpu, // sockets = 现有CPU数量总和
              cpuCores: 1,
              cpuThreads: 1
              // 不传入 enableHotPlug，让后端只处理拓扑调整
            };
            
            await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
            message.info('已先设置CPU拓扑为cores=1, threads=1，正在开启热扩容...');
            
            // 刷新VM状态
            try {
              const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
              setLatestVm(refreshedVm?.data || refreshedVm);
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
              console.warn('刷新VM状态失败，继续执行', e);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
          
          // 第二步：提交热扩容设置
          let payload: any;
          
          if (values.enableHotPlug) {
            // 开启热扩容
            // [关键修复] 如果第一步调整了拓扑，需要在第二步时同时传入拓扑参数
            // 确保后端知道拓扑已经调整为单核模式，避免验证失败
            payload = {
              enableHotPlug: true,
              maxSockets: values.maxSockets,
              maxMemory: `${values.maxMemory}Gi`
            };
            
            // 如果第一步调整了拓扑，或者当前拓扑已经是单核模式，传入拓扑参数
            if (needTopologyFix || (currentCores === 1 && currentThreads === 1)) {
              // 获取调整后的拓扑（如果第一步调整了，使用调整后的值；否则使用当前值）
              const finalSockets = needTopologyFix ? currentTotalCpu : currentSockets;
              payload.cpuSockets = finalSockets;
              payload.cpuCores = 1;
              payload.cpuThreads = 1;
            }
          } else {
            // 关闭热扩容
            payload = {
              enableHotPlug: false
            };
          }

          // [调试日志] 输出提交的 payload
          console.log('=== 热扩容设置提交 ===');
          console.log('Payload:', JSON.stringify(payload, null, 2));
          console.log('当前VM状态:', {
            sockets: currentSockets,
            cores: currentCores,
            threads: currentThreads,
            totalCpu: currentTotalCpu,
            isCurrentlyHotPlug,
            needTopologyFix
          });
          console.log('========================');
          
          await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
          message.success('热扩容设置已提交，需要重启生效');
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'cpu_advanced': {
          // 构造最小化 payload，避免将 null 之类的非法 quantity 传给后端
          const advancedPayload: any = {
            cpuSockets: values.cpuSockets,
            cpuCores: values.cpuCores,
            cpuThreads: values.cpuThreads,
            cpuModel: values.cpuModel,
            cpuModelCustom: values.cpuModelCustom,
            dedicatedCPUPlacement: values.dedicatedCPUPlacement,
            isolateEmulatorThread: values.isolateEmulatorThread,
          };

          if (values.dedicatedCPUPlacement) {
            advancedPayload.cpuRequest = null;
            advancedPayload.cpuLimit = null;
          } else {
            // 仅在用户填写了 cpuRequest 时才下发
            if (values.cpuRequest !== undefined && values.cpuRequest !== null && values.cpuRequest !== '') {
              advancedPayload.cpuRequest = Number(values.cpuRequest);
            }

            // 仅在用户填写了 cpuLimit 时才下发；未填写则不修改后端 limit 配置
            if (values.cpuLimit !== undefined && values.cpuLimit !== null && values.cpuLimit !== '') {
              advancedPayload.cpuLimit = Number(values.cpuLimit);
            }
          }

          if (typeof values.memoryRequestGi === 'number') {
            advancedPayload.memoryRequestGi = values.memoryRequestGi > 0 ? values.memoryRequestGi : null;
          }
          if (typeof values.memoryLimitGi === 'number') {
            advancedPayload.memoryLimitGi = values.memoryLimitGi > 0 ? values.memoryLimitGi : null;
          }

          await updateHarvesterVmSpec(cloudId, namespace, vmName, advancedPayload);
          openRestartConfirm(namespace, vmName, false);
          break;
        }
        case 'change_os': {
          // [修复] 处理容量值：空值/“自动选择”/无效 -> 使用默认值 40Gi
          let rootSize = '40Gi';
          const sizeValue = values.newOsRootSize;
          if (sizeValue !== undefined && sizeValue !== null && sizeValue !== '' && sizeValue !== '自动选择') {
            const numSize = Number(sizeValue);
            if (!isNaN(numSize) && numSize > 0) {
              rootSize = `${numSize}Gi`;
            }
          }
          
          // [修复] 验证必填字段
          if (!values.newOsImage) {
            message.error('请选择镜像');
            return;
          }

          // [安全确认] 用户必须勾选“我已知晓风险”复选框才能提交
          if (!values.changeOsConfirmed) {
            message.warning('请勾选确认更换系统盘的风险后再提交');
            return;
          }
          
          await updateHarvesterVmSpec(cloudId, namespace, vmName, {
             action: 'reinstall',
             image: values.newOsImage,
             rootSize: rootSize,
             bus: values.newOsBus || 'virtio',
             storageClassName: values.storageClassName || undefined,
             rootDeviceType: values.rootDeviceType || 'disk'
          });
          // message.success('重装系统请求已提交。请确保实例处于【停止】状态后，再点击【启动】（不要直接重启）。');
          openRestartConfirm(namespace, vmName, true);
          break;
        }
        case 'add_disk': {
          const volName = values.newDiskName;
          const created = !!values.newDiskCreated;

          // 两步流程：
          // - 第一次提交：只创建 PVC（避免 PVC 尚未 Bound 导致挂载需要点两次）
          // - 第二次提交：再执行挂载
          if (!created) {
            const accessMode = values.newDiskAccessMode || 'ReadWriteMany';
            const accessModeText = accessMode === 'ReadWriteOnce' ? 'RWO (ReadWriteOnce)' :
                                   accessMode === 'ReadWriteMany' ? 'RWX (ReadWriteMany)' :
                                   accessMode === 'ReadOnlyMany' ? 'ROX (ReadOnlyMany)' :
                                   'RWX (ReadWriteMany)';
            
            await createHarvesterVolume(cloudId, {
              namespace,
              name: volName,
              size: values.newDiskSize,
              storageClassName: values.newDiskSc,
              accessModes: [accessMode],
            });
            form.setFieldsValue({ newDiskCreated: true });
            message.success(`数据盘创建成功（访问类型: ${accessModeText}），请再次点击【提交】进行挂载`);
            return; // 不关闭弹窗
          }

          await attachHarvesterVolumeToVmByName(cloudId, namespace, vmName, {
            name: volName,
            diskName: volName,
            pvcName: volName,
            pvcNamespace: namespace,
            bus: values.newDiskBus,
          });

          message.success('挂载成功');
          // 清理 step 标记，避免下次复用表单误走挂载
          form.setFieldsValue({ newDiskCreated: false });

          // 通知上层刷新（VM + volumes），并关闭
          try { onOk?.(true); } catch {}
          onClose?.();
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
              // Handle VPC network name (subnet name -> NAD name)
              // For Kube-OVN VPC, subnet name should match NAD name, but networkName needs namespace/name format
              if (nic.mode === 'vpc') {
                  const subnetName = nic.subnet;
                  if (subnetName) {
                      // Try to find subnet's namespace from subnets list (backend injects metadata.namespace)
                      const subnet = subnets.find((s: any) => s?.metadata?.name === subnetName);
                      if (subnet?.metadata?.namespace) {
                          sNetName = `${subnet.metadata.namespace}/${subnetName}`;
                      } else {
                          // Fallback: try to find NAD with same name
                          const nad = nads.find((n: any) => n.metadata.name === subnetName);
                          if (nad) {
                              sNetName = `${nad.metadata.namespace}/${subnetName}`;
                          } else {
                              // Last resort: use subnet name only (may fail if NAD not found)
                              sNetName = subnetName;
                          }
                      }
                  }
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

  // ============================================================================
  // Add Disk: Split Actions (Create vs Attach) for better UX
  // 注意：PVC 就绪等待逻辑在后端 harvesterAddVolumeToVM(*)
  // 已经实现，这里不再阻塞前端交互，只在创建成功后允许挂载。
  // ============================================================================
  const handleCreateDisk = async () => {
    if (diskCreating || diskAttaching) return;
    setDiskCreating(true);
    try {
      const values = await form.validateFields(['newDiskName', 'newDiskSize', 'newDiskSc', 'newDiskAccessMode']);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const volName = values.newDiskName;
      const accessMode = values.newDiskAccessMode || 'ReadWriteMany';
      const accessModeText = accessMode === 'ReadWriteOnce' ? 'RWO (ReadWriteOnce)' :
                             accessMode === 'ReadWriteMany' ? 'RWX (ReadWriteMany)' :
                             accessMode === 'ReadOnlyMany' ? 'ROX (ReadOnlyMany)' :
                             'RWX (ReadWriteMany)';
      
      await createHarvesterVolume(cloudId, {
        namespace,
        name: volName,
        size: values.newDiskSize,
        storageClassName: values.newDiskSc,
        accessModes: [accessMode],
      });

      form.setFieldsValue({ newDiskCreated: true });
      message.success(`数据盘创建成功（访问类型: ${accessModeText}），请点击【挂载磁盘】继续`);
    } catch (e: any) {
      // 表单校验错误交给 antd
      if (e?.errorFields) return;
      message.error(e?.message || '创建磁盘失败');
    } finally {
      setDiskCreating(false);
    }
  };

  const handleAttachDisk = async () => {
    if (diskCreating || diskAttaching) return;
    setDiskAttaching(true);
    try {
      const values = await form.validateFields(['newDiskName', 'newDiskCreated', 'newDiskBus']);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const created = !!values.newDiskCreated;
      if (!created) {
        message.warning('请先创建磁盘');
        return;
      }

      const volName = values.newDiskName;
      await attachHarvesterVolumeToVmByName(cloudId, namespace, vmName, {
        name: volName,
        diskName: volName,
        pvcName: volName,
        pvcNamespace: namespace,
        bus: values.newDiskBus || 'virtio',
      });

      // 检查是否需要重启（添加/删除卷通常会触发 RestartRequired）
      // 使用聚合接口刷新，确保包含 related.volumes 数据
      try {
        const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
        // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
        const data = res?.data?.vm ? res.data : res;
        const updatedVm = data?.vm || data;
        
        // 合并 related 数据，确保 DetachDataDisk 组件能获取到 related.volumes
        if (updatedVm && data?.related) {
          updatedVm.related = data.related;
        }
        
        const conditions = updatedVm?.status?.conditions || [];
        const needsRestart = conditions.some(
          (c: any) => c.type === 'RestartRequired' && c.status === 'True'
        );
        
        setLatestVm(updatedVm);
        
        if (needsRestart) {
          // 挂载成功，但需要重启生效，弹出重启确认对话框
          message.success('挂载成功，设置已保存');
          // 延迟一下，确保消息提示先显示
          setTimeout(() => {
            openRestartConfirm(namespace, vmName, false);
          }, 300);
        } else {
          message.success('挂载成功');
        }
      } catch (refreshErr: any) {
        console.warn('刷新VM数据失败:', refreshErr);
        message.success('挂载成功（设置已保存，请检查是否需要重启）');
      }
      
      // 清理 step 标记，避免下次误走挂载
      form.setFieldsValue({ newDiskCreated: false });
      try { onOk?.(true); } catch {}
      onClose?.();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '挂载失败');
    } finally {
      setDiskAttaching(false);
    }
  };

  // ============================================================================
  // Refresh VM: 刷新虚拟机数据（使用聚合接口，确保包含 related.volumes）
  // ============================================================================
  const refreshVm = async () => {
    if (!cloudId || !record?.metadata?.name || !record?.metadata?.namespace) return;
    try {
      // 使用聚合接口获取 VM 及关联资源（包括 related.volumes）
      const res: any = await fetchHarvesterVMAggregated(cloudId, record.metadata.namespace, record.metadata.name);
      
      // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
      const data = res?.data?.vm ? res.data : res;
      
      // 合并 vm 和 related 数据到 latestVm，确保 DetachDataDisk 组件能获取到 related.volumes
      const updatedVm = data?.vm || data;
      if (updatedVm && data?.related) {
        updatedVm.related = data.related;
      }
      
      setLatestVm(updatedVm);
    } catch (err: any) {
      console.error('刷新VM数据失败:', err);
      // 如果聚合接口失败，回退到普通接口
      try {
        const res: any = await fetchHarvesterVmDetail(cloudId, record.metadata.namespace, record.metadata.name);
        setLatestVm(res?.data || res);
      } catch (fallbackErr: any) {
        console.error('回退刷新也失败:', fallbackErr);
        throw err; // 抛出原始错误
      }
    }
  };

  // ============================================================================
  // Detach Disk: 解绑数据盘
  // ============================================================================
  const handleDetachDisk = async (diskName: string) => {
    if (diskDetaching) return;
    setDiskDetaching(true);
    try {
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const instanceId = `${namespace}/${vmName}`;
      await detachHarvesterVolumeFromVm(cloudId, instanceId, {
        name: diskName,
      });

      // 检查是否需要重启（添加/删除卷通常会触发 RestartRequired）
      // 使用聚合接口刷新，确保包含 related.volumes 数据
      try {
        const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
        // [兼容返回结构] 支持 { data: { vm, related } } 与 { vm, related } 两种形态
        const data = res?.data?.vm ? res.data : res;
        const updatedVm = data?.vm || data;
        
        // 合并 related 数据，确保 DetachDataDisk 组件能获取到 related.volumes
        if (updatedVm && data?.related) {
          updatedVm.related = data.related;
        }
        
        const conditions = updatedVm?.status?.conditions || [];
        const needsRestart = conditions.some(
          (c: any) => c.type === 'RestartRequired' && c.status === 'True'
        );
        
        if (needsRestart) {
          message.warning('解绑成功，设置已保存。需要重启虚拟机后生效，您可以选择立即重启或稍后重启');
        } else {
          message.success('解绑成功');
        }
        setLatestVm(updatedVm);
      } catch (refreshErr: any) {
        console.warn('刷新VM数据失败:', refreshErr);
        message.success('解绑成功（设置已保存，请检查是否需要重启）');
      }
      // 通知上层刷新（VM + volumes）
      try { onOk?.(true); } catch {}
    } catch (e: any) {
      // 提取友好的错误消息
      const errorMessage = e?.message || e?.response?.data?.message || '解绑失败';
      message.error(errorMessage);
      // 不再抛出错误，避免导致 Uncaught runtime error
      // 错误已经通过 message.error 显示给用户了
    } finally {
      setDiskDetaching(false);
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
    isHotPlugConfiguredOnVm,
    isRestartRequired,
    isHotPlugInProgress,
    latestVm,
    // add disk split actions
    diskCreating,
    diskAttaching,
    handleCreateDisk,
    handleAttachDisk,
    availableDiskPvcs,
    // detach disk actions
    diskDetaching,
    handleDetachDisk,
    refreshVm,
  };
};
