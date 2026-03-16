import { startCloudProviderEcs } from '../../../../../services/api';
import { generateHarvesterEntityId } from '../../../../../utils/harvesterUtils';

/**
 * ==============================================================================
 * 模块名称: Harvester VM 向导工具集 (VmWizardUtils)
 * 文件路径: src/pages/Clouds/Harvester/modals/VmCreateWizard/VmWizardUtils.ts
 * ==============================================================================
 *
 * [功能描述]
 * 此文件包含了 VM 创建过程中所需的各种辅助逻辑，按照功能模块划分为：
 * 1. 基础工具 (Utils): 通用数据处理、格式转换
 * 2. 资源校验 (Validation): 镜像大小、GPU 可用性检查
 * 3. 表单相关 (Form): 初始值、字段联动
 * 4. 核心构造 (Core): 构建 Kubernetes CRD Payload
 * 5. 模板应用 (Template): 将模板或现有 VM 规格应用到表单
 *
 * [核心逻辑]
 * - [数据转换]: `parseSizeToGi` 统一处理各种 K8s 资源单位 (Gi, Mi, bytes) 转为 GiB。
 * - [ID 生成]: `generateUniqueVmId` 遵循 `id-{entity}-{random}` 规范生成唯一标识。
 * - [资源校验]: `validateAndGetGpu` 确保选择的 GPU 资源存在且满足节点亲和性。
 * - [Payload构造]: `buildHarvesterVmPayload` 将扁平的表单数据转换为嵌套的 K8s VirtualMachine 对象。
 *
 * === 交互依赖 ===
 * - 被 `VmCreateWizardModal` 及各步骤组件引用。
 * - 依赖 `utils/harvesterUtils` 中的 ID 生成逻辑。
 */

// ==========================================
// 1. 基础工具函数 (Utils)
// ==========================================

/**
 * 将各种格式的大小字符串解析为 GiB 数值
 * 支持 '10Gi', '1024Mi', '1073741824' 等格式
 * 
 * @param raw 原始大小值 (string | number)
 * @returns 解析后的 GiB 数值 (number)
 */
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

/**
 * 生成 VM ID（vmid，用于 VirtualMachine 的 metadata.name 等字段）
 *
 * 约定（统一的“集群实体 ID”规范）：
 * - 统一格式：id-{实体缩写}-{11位随机字符串}
 *   - 本函数用于 VM，实体缩写默认为 'vm'
 *   - 示例：id-vm-3k9z0x8af21
 *
 * 作用与解耦：
 * - vmid 作为集群内“技术 ID”，写入：
 *   - VM metadata.name
 *   - spec.template.metadata.labels['harvesterhci.io/vmName']
 *   - spec.template.spec.hostname
 * - 用户在表单中输入的“名称”(v.name) 作为展示名，仅写入：
 *   - annotations['tower.io/alias']（Tower 层面的别名）
 *   通过此约定，将“集群实体 ID”与“展示名称”解耦。
 *
 * 当前生成算法（仅在前端生成，未向后端做唯一性校验）：
 * - 具体实现委托给 utils/harvesterUtils.generateHarvesterEntityId
 * - 对 VM 场景，实体缩写默认为 'vm'
 *
 * 注意：
 * - 该算法只是“尽量降低冲突概率”，并不能严格保证在同一 Namespace 内绝对唯一，
 *   如需强唯一性需配合后端校验或冲突重试机制。
 * - 生成结果满足 Harvester 名称要求：小写字母、数字、中划线。
 *
 * @param cloudId 云平台 ID（当前未参与计算，保留扩展能力）
 * @param namespace 命名空间（当前未参与计算，保留扩展能力）
 * @param baseName 实体缩写前缀 (默认为 'vm'，对应 id-vm-... 中的 vm)
 * @returns {Promise<string>} 生成的 vmid（概率上唯一）
 */
export const generateUniqueVmId = async (cloudId: string, namespace: string, baseName?: string): Promise<string> => {
    // 简单封装：遵循 id-{实体缩写}-{11位随机字符串} 规范，实体缩写默认为 'vm'
    const entity = baseName || 'vm';
    return generateHarvesterEntityId(entity);
};

/**
 * 过滤节点列表
 * 用于节点选择下拉框的搜索
 * 
 * @param nodes 节点列表
 * @param keyword 搜索关键字 (匹配名称或 IP)
 * @returns 过滤后的节点列表
 */
export const filterNodes = (nodes: any[], keyword: string) => {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return nodes;
  return (nodes || []).filter((n:any)=> (
    String(n?.name || '').toLowerCase().includes(kw) ||
    String(n?.internalIP || '').toLowerCase().includes(kw)
  ));
};

// ==========================================
// 2. 资源校验与查询 (Validation)
// ==========================================

/**
 * 校验并获取选中的 GPU 资源
 * 
 * 根据用户选择的 GPU 配置（资源名或 PCI 地址），在可用的 GPU 资源列表中查找并验证。
 * 处理直通 / SR-IOV 模式下的节点亲和性校验。
 * 
 * @param params 参数对象
 * @returns { selectedGpu, finalGpuResName, warning? } warning 为可选
 */
export const validateAndGetGpu = (params: {
  v: any; // 表单数据
  gpuResources: any[]; // 可用 GPU 列表
  hostModeState: string; // 主机调度模式
  selectedNodeName: string | null; // 选定主机名
}) => {
  const { v, gpuResources, hostModeState, selectedNodeName } = params;
  
  // 1. 基础检查
  if (!v.gpuMode) return { selectedGpu: null, finalGpuResName: undefined };

  const list = Array.isArray(gpuResources) ? gpuResources : [];
  if (list.length === 0) return { selectedGpu: null, finalGpuResName: undefined };

  // 2. 查找资源
  let found = null as any;
  // 优先通过资源名称 (resourceName) 查找
  if (v.gpuResourceName) {
    found = list.find((x: any) => String(x?.resourceName) === String(v.gpuResourceName));
  }
  // 其次通过 PCI 设备名称查找
  if (!found && v.gpuPcideviceName) {
    const dn = String(v.gpuPcideviceName || '').trim();
    found = list.find((x: any) => String(x?.raw?.metadata?.name || x?.name || '') === dn);
  }
  
  if (!found) {
    throw new Error(`GPU 资源不可用：${v.gpuPcideviceName || v.gpuResourceName}`);
  }

  // 3. 提取信息
  const selectedGpu = found;
  const finalGpuResName = found?.resourceName || found?.raw?.status?.resourceName || found?.raw?.spec?.resourceName || undefined;
  const mode = String(v.gpuMode || 'passthrough');
  
  // 4. 节点亲和性校验
  // 直通模式或 SR-IOV 模式下，VM 必须调度到 GPU 所在节点
  if (['passthrough', 'sriov'].includes(mode)) {
    const node = String(found?.node || found?.nodeName || '').trim();
    if (!node) {
      throw new Error('该GPU资源未在任何节点就绪，请先在GPU页面确认可用资源');
    }
    // 警告：用户手动选择了主机，但与 GPU 所在主机不一致
    if (hostModeState === 'node' && selectedNodeName && selectedNodeName !== node) {
      return { selectedGpu, finalGpuResName, warning: `已选择GPU所在节点 ${node}，与当前主机选择不一致，将以GPU节点为准` };
    }
  }

  return { selectedGpu, finalGpuResName };
};

/**
 * 校验系统盘大小是否满足镜像要求
 * 
 * @param v 表单数据
 * @param images 镜像列表
 * @returns 错误信息字符串，校验通过返回 null
 */
export const validateImageSize = (v: any, images: any[]) => {
    // 仅当来源类型为 Image 时校验
    if (String(v.rootSourceType || 'image') === 'image') {
        try {
            const imgVal = v.image;
            const it = (images || []).find((x: any) => {
                 const name = x?.metadata?.name || x?.name;
                 const ns = x?.metadata?.namespace || x?.namespace;
                 const val = ns && name ? `${ns}/${name}` : name;
                 return val === imgVal;
            });
            
            // 获取镜像大小 (优先使用 VirtualSize)
            const raw = (function () { 
                const vv = (it as any)?.spec?.virtualSize || (it as any)?.virtualSize; 
                return (vv !== undefined && vv !== null && vv !== 0) ? vv : (it as any)?.size; 
            })();
            const gi = parseSizeToGi(raw);
            
            // 获取用户输入的系统盘大小
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

// ==========================================
// 3. 表单相关 (Form)
// ==========================================

/**
 * 获取创建向导的初始表单值
 * 
 * @param memGi 默认内存大小
 * @param initialVmName 默认 VM 名称
 * @returns 初始表单对象
 */
export const initialWizardValues = (memGi: number, initialVmName: string, cloudId?: string) => ({
  cloudId: cloudId !== 'all' ? cloudId : undefined,
  name: initialVmName,
  cpu: 2,
  cpuModel: 'host-passthrough',
  dedicatedCPUPlacement: false,
  isolateEmulatorThread: false,
  memory: `${memGi}Gi`,
  machineType: undefined,
  rootSourceType: 'image',
  rootName: `disk-${Math.random().toString(36).substring(2, 8)}`,
  rootSize: '40',
  rootBus: 'virtio',
  rootDeviceType: 'disk',
  extraDisks: [],
  nodeSelectorPairs: [],
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
  evictionStrategy: 'LiveMigrateIfPossible',
  loginMethod: 'later',
  loginAccount: 'root',
  primaryNic: { name: '', type: 'bridge', model: 'virtio' },
  netIfaces: [],
  usbDevices: []
});

/**
 * 处理 Root PVC 变更时的联动逻辑
 * 当用户选择现有 PVC 作为系统盘时，自动回填大小
 * 
 * @param form AntD Form 实例
 * @param availableVolumes 可用的 PVC 列表
 * @param pvcName 选中的 PVC 名称
 */
export const handleRootPvcChange = (form: any, availableVolumes: any[], pvcName: string) => {
    if (!pvcName) return;
    const vol = availableVolumes.find(x => x?.metadata?.name === pvcName);
    if (vol) {
        const size = vol.spec?.resources?.requests?.storage;
        if (size) {
             const gi = parseSizeToGi(size);
             form.setFieldsValue({ rootSize: String(gi) });
        }
    }
};

// ==========================================
/**
 * 将 Harvester VirtualMachineTemplate 的规格预填充到创建向导表单
 *
 * 主要映射内容：
 * - CPU/内存
 * - 系统盘容量、名称、设备类型
 * - 数据盘列表
 * - 主网卡和辅助网卡
 * 
 * @param params 参数对象
 * @param params.form - AntD Form 实例
 * @param params.template - 选中的 VM 模板对象
 * @param params.images - 可用镜像列表 (用于匹配 ID)
 * @param params.availableVolumes - 可用卷列表 (用于匹配 PVC)
 * @param params.nadOptions - NAD 选项列表
 * @param params.kubeSubnets - 子网列表
 */
export const applyTemplateToWizardForm = (params: {
  form: any;
  template: any;
  images?: any[];
  availableVolumes?: any[];
  nadOptions?: any[];
  kubeSubnets?: any[];
}) => {
  const { form, template } = params;
  if (!template || !template.spec || !template.spec.template) return;
  const vmSpec = template.spec.template.spec || {};
  const domain = vmSpec.domain || {};
  const devices = domain.devices || {};
  const cpu = domain.cpu || {};
  const resources = domain.resources || {};

  const next: any = {};

  if (cpu.cores || cpu.sockets || cpu.threads) {
    const cores = Number(cpu.cores || 0);
    const sockets = Number(cpu.sockets || 1) || 1;
    const threads = Number(cpu.threads || 1) || 1;
    const total = cores || sockets * threads || 0;
    if (total > 0) {
      next.cpu = total;
    }
  }

  // 修复：优先读取 domain.memory.guest (真实内存)
  // 避免因热扩容导致的 limits 放大 (4x) 误导前端显示
  // 注意：Harvester 模板中 domain.memory.guest 可能不存在
  const memRaw = domain.memory?.guest;
  
  if (memRaw) {
    const gi = parseSizeToGi(memRaw);
    if (gi > 0) {
      next.memory = `${gi}Gi`;
    }
  }

  const disks = Array.isArray(devices.disks) ? devices.disks : [];
  const volumes = Array.isArray(vmSpec.volumes) ? vmSpec.volumes : [];

  let volumeTemplates = Array.isArray(template.spec.volumeClaimTemplates)
    ? template.spec.volumeClaimTemplates
    : [];
  
  // 如果 spec 中没有 volumeClaimTemplates，尝试从 annotation 中读取 (通常用于从现有 VM 克隆场景)
  if (volumeTemplates.length === 0 && template.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates']) {
      try {
          const parsed = JSON.parse(template.metadata.annotations['harvesterhci.io/volumeClaimTemplates']);
          if (Array.isArray(parsed)) volumeTemplates = parsed;
      } catch (e) {
          console.warn('Failed to parse volumeClaimTemplates from annotation', e);
      }
  }

  const findVolumeByName = (name: string) =>
    volumes.find((v: any) => String(v?.name || '') === String(name || ''));

  const pvcVolume = (vol: any) => vol?.persistentVolumeClaim?.claimName;
  const containerDiskVolume = (vol: any) => vol?.containerDisk?.image;

  let rootDisk: any = null;
  if (disks.length > 0) {
    rootDisk = disks[0];
  }

  if (rootDisk) {
    const dName = rootDisk.name;
    const vol = findVolumeByName(dName);
    if (vol) {
      const pvcName = pvcVolume(vol);
      const imageName = containerDiskVolume(vol);

      const tpl = pvcName
        ? volumeTemplates.find(
            (t: any) => String(t?.metadata?.name || '') === String(pvcName || ''),
          )
        : null;

      const tplImageId =
        tpl?.metadata?.annotations?.['harvesterhci.io/imageId'] ||
        tpl?.metadata?.annotations?.['harvesterhci.io/imageID'] ||
        tpl?.metadata?.annotations?.['harvesterhci.io/image'] ||
        undefined;

      if (tpl && tplImageId) {
        next.rootSourceType = 'image';
        next.image = tplImageId;
        const sizeRaw =
          tpl?.spec?.resources?.requests?.storage ||
          tpl?.status?.capacity?.storage;
        if (sizeRaw) {
          const gi = parseSizeToGi(sizeRaw);
          if (gi > 0) {
            next.rootSize = String(gi);
          }
        }
      } else if (pvcName) {
        next.rootSourceType = 'existing';
        next.rootPvc = pvcName;
        const sizeRaw =
          tpl?.spec?.resources?.requests?.storage ||
          tpl?.status?.capacity?.storage;
        if (sizeRaw) {
          const gi = parseSizeToGi(sizeRaw);
          if (gi > 0) {
            next.rootSize = String(gi);
          }
        }
      } else if (imageName) {
        next.rootSourceType = 'image';
        next.image = imageName;
      }
    }

    if (rootDisk.disk) {
      next.rootDeviceType = 'disk';
    } else if (rootDisk.cdrom) {
      next.rootDeviceType = 'cdrom';
    }

    if (rootDisk.disk && rootDisk.disk.bus) {
      next.rootBus = rootDisk.disk.bus;
    } else if (rootDisk.cdrom && rootDisk.cdrom.bus) {
      next.rootBus = rootDisk.cdrom.bus;
    }

    if (rootDisk.name) {
      next.rootName = rootDisk.name;
    }
  }

  const extraDisks: any[] = [];
  disks.slice(rootDisk ? 1 : 0).forEach((d: any) => {
    const dName = d?.name;
    if (!dName) return;
    const vol = findVolumeByName(dName);
    if (!vol) return;

    const pvcName = pvcVolume(vol);
    if (!pvcName) return;

    const tpl = volumeTemplates.find(
      (t: any) => String(t?.metadata?.name || '') === String(pvcName || ''),
    );
    const sizeRaw = tpl?.spec?.resources?.requests?.storage;
    const gi = sizeRaw ? parseSizeToGi(sizeRaw) : 0;

    extraDisks.push({
      name: dName,
      size: gi ? String(gi) : undefined,
      pvc: pvcName,
      sourceType: 'existing',
      type: d?.cdrom ? 'cdrom' : 'disk',
      deviceType: d?.cdrom ? 'cdrom' : 'disk',
      bus: d?.disk?.bus || d?.cdrom?.bus || 'virtio',
      mode: tpl?.spec?.volumeMode || undefined,
      storageClassName: tpl?.spec?.storageClassName || undefined,
    });
  });

  if (extraDisks.length > 0) {
    next.extraDisks = extraDisks;
  }

  const ifaces = Array.isArray(devices.interfaces) ? devices.interfaces : [];
  const nets = Array.isArray(vmSpec.networks) ? vmSpec.networks : [];

  const findNetByName = (nm: string) =>
    nets.find((n: any) => String(n?.name || '') === String(nm || ''));

  if (ifaces.length > 0) {
    const primary = ifaces[0];
    const nName = primary?.name;
    const net = findNetByName(nName);

    const p: any = {};

    p.name = (function () {
      if (!net) return '';
      if (net.pod) return '';
      if (net.multus && net.multus.networkName) return net.multus.networkName;
      return '';
    })();

    p.type = (function () {
      const method = primary?.masquerade ? 'masquerade' : primary?.bridge ? 'bridge' : undefined;
      if (method) return method;
      if (primary?.sriov) return 'sriov';
      if (primary?.macvtap) return 'macvtap';
      return 'bridge';
    })();

    p.model = primary?.model || 'virtio';

    next.primaryNic = p;

    const mode = (function () {
      if (!net) return 'flat';
      if (net.pod) return 'flat';
      return 'flat';
    })();

    next.netMode = mode;
  }

  const extraIfaces: any[] = [];
  if (ifaces.length > 1) {
    ifaces.slice(1).forEach((iface: any) => {
      const nName = iface?.name;
      const net = findNetByName(nName);
      if (!net) return;
      const it: any = {};
      it.name = (function () {
        if (net.pod) return '';
        if (net.multus && net.multus.networkName) return net.multus.networkName;
        return '';
      })();
      it.type = (function () {
        const method = iface?.masquerade ? 'masquerade' : iface?.bridge ? 'bridge' : undefined;
        if (method) return method;
        if (iface?.sriov) return 'sriov';
        if (iface?.macvtap) return 'macvtap';
        return 'bridge';
      })();
      it.model = iface?.model || 'virtio';
      it.mode = 'flat';
      extraIfaces.push(it);
    });
  }

  if (extraIfaces.length > 0) {
    next.netIfaces = extraIfaces;
  }

  form.setFieldsValue(next);
};

// 4. 核心构造逻辑 (Core)
// ==========================================


/**
 * 构建 Harvester 虚拟机创建请求的 Payload (Manifest)
 * 
 * 将前端向导表单数据转换为 Kubernetes VirtualMachine CRD 结构。
 * 包含 CPU/内存/磁盘/网络/CloudInit 等核心配置。
 * 
 * @param params 参数对象
 * @returns VM Manifest 对象
 */
export const buildHarvesterVmPayload = (params: {
  v: any; // 表单完整数据
  memGi: number; // 内存大小 (GiB)
  hostModeState: string; // 主机调度模式
  selectedNodeName: string | null; // 选定的主机名
  gpuResources: any[]; // GPU 资源列表
  selectedGpu: any; // 已验证选中的 GPU 对象
  capabilities?: any; // 集群能力
  isArm64?: boolean; // 架构标识
  vmId?: string; // 预生成的 VM ID
}) => {
  const { v, memGi, hostModeState, selectedNodeName, gpuResources, selectedGpu, capabilities, isArm64, vmId } = params;
  
  // --- 1. GPU 资源处理 ---
  const gpuMode = String(v.gpuMode || 'none').toLowerCase();
  const selectedGpuDeviceName = (function () {
      if (!selectedGpu) return undefined;
      const rawName = selectedGpu?.raw?.metadata?.name;
      if (rawName) return String(rawName);
      const n = selectedGpu?.name;
      if (n) return String(n);
      return undefined;
  })();
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

  // --- 2. 基础计算 (CPU/Memory) ---
  const hotExpandEnabled = isArm64 ? false : !!v.hotExpandEnabled;
  const cpu = Number(v.cpu || 1);
  const sockets = hotExpandEnabled ? cpu : Number(v.cpuSockets || 1);
  const cores = hotExpandEnabled ? 1 : Number(v.cpuCores || cpu);
  const threads = hotExpandEnabled ? 1 : Number(v.cpuThreads || 1);
  const memory = String(v.memory || `${memGi}Gi`);
  const actualMemGi = parseSizeToGi(memory);

  // --- 3. 调度策略 (Node Selector) ---
  // [重要] 使用 nodeSelector 而不是 nodeAffinity 来固定节点
  // 原因：Harvester 的 mutator 会清除 nodeAffinity 中的 kubernetes.io/hostname
  // 但 nodeSelector 不会被清除，所以应该使用 nodeSelector
  
  // 处理节点调度逻辑
  const nodeSelector = (function () {
      // 优先 GPU 节点（如果选择了 GPU）
      const gpuNode = selectedGpu && String(selectedGpu?.node || selectedGpu?.nodeName || '').trim();
      if (gpuNode) {
          return { 'kubernetes.io/hostname': gpuNode };
      }
      
      // 如果没有选择 GPU，尝试从 GPU 资源中获取节点
      if (!selectedGpu && v.gpuPcideviceName) {
          try {
              const list = Array.isArray(gpuResources) ? gpuResources : [];
              const found = list.find((x: any) => String(x?.raw?.metadata?.name || x?.name || '') === String(v.gpuPcideviceName));
              const gn = found && String(found?.node || found?.nodeName || '').trim();
              if (gn) {
                  return { 'kubernetes.io/hostname': gn };
              }
          } catch {}
      }
      if (!selectedGpu && v.gpuResourceName) {
          try {
              const list = Array.isArray(gpuResources) ? gpuResources : [];
              const found = list.find((x:any)=> String(x?.resourceName)===String(v.gpuResourceName));
              const gn = found && String(found?.node||found?.nodeName||'').trim();
              if (gn) {
                  return { 'kubernetes.io/hostname': gn };
              }
          } catch {}
      }
      
      // 标签选择模式
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
      
      // 指定主机模式
      if (hostModeState === 'node' && selectedNodeName) {
          return { 'kubernetes.io/hostname': selectedNodeName };
      }
      
      // 自动调度模式：返回 undefined
      return undefined;
  })();

  // --- 4. 资源集合初始化 ---
  const disks: any[] = [];
  const volumes: any[] = [];
  const networks: any[] = [];
  const interfaces: any[] = [];
  const volumeClaimTemplates: any[] = [];
  
  // 辅助：随机后缀与 MAC 生成
  const randSuffix = () => Math.random().toString(36).substring(2, 7);
  const generateMacAddress = () => {
    const hex = '0123456789ABCDEF';
    let mac = '52:54:00'; 
    for (let i = 0; i < 3; i++) {
      mac += ':' + hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
    }
    return mac;
  };

  // --- 5. 网络配置 (Networks) ---
  const allNics: any[] = [];
  if (v.primaryNic) allNics.push({ ...v.primaryNic, _isPrimary: true, _idx: 0 });
  if (Array.isArray(v.netIfaces)) {
      v.netIfaces.forEach((nic: any, idx: number) => {
          allNics.push({ ...nic, _isPrimary: false, _idx: idx + 1 });
      });
  }

  const hasStaticIP = allNics.some(n => n.ipAddress);
  const networkDataEthernets: any = {};

  allNics.forEach((nic) => {
      const nicName = `nic-${nic._idx}`;
      const netName = nic.name;
      let mac = nic.macAddress;
      
      // 静态 IP 必须有 MAC
      if (hasStaticIP && !mac) mac = generateMacAddress();
      
      // Interface
      const iface: any = { name: nicName, model: nic.model || 'virtio' };
      if (mac) iface.macAddress = mac;
      
      const type = nic.type || 'bridge';
      if (type === 'bridge') iface.bridge = {};
      else if (type === 'masquerade') iface.masquerade = {};
      else if (type === 'sriov') iface.sriov = {};
      else if (type === 'macvtap') iface.macvtap = {};
      else iface.bridge = {}; 
      interfaces.push(iface);

      // Network
      const net: any = { name: nicName };
      if (netName) {
           net.multus = { networkName: netName };
      } else {
           if (nic._isPrimary) net.pod = {}; 
           else net.multus = { networkName: 'default' };
      }
      networks.push(net);

      // NetworkData (Static IP)
      if (hasStaticIP) {
           const ethConfig: any = {
               match: { macaddress: mac },
               dhcp4: !nic.ipAddress,
           };
           if (nic.ipAddress) {
               ethConfig.addresses = [nic.ipAddress];
               if (nic.gateway) ethConfig.gateway4 = nic.gateway;
               if (nic.dns) {
                   const dnsList = nic.dns.split(/[,;\s]+/).filter((d: string) => d.trim());
                   if (dnsList.length > 0) ethConfig.nameservers = { addresses: dnsList };
               }
           }
           networkDataEthernets[nicName] = ethConfig;
      }
  });

  // 构建 NetworkData YAML
  let networkDataYaml = '';
  if (hasStaticIP && Object.keys(networkDataEthernets).length > 0) {
      networkDataYaml = 'version: 2\nethernets:\n';
      Object.keys(networkDataEthernets).forEach(key => {
          const conf = networkDataEthernets[key];
          networkDataYaml += `  ${key}:\n`;
          networkDataYaml += `    match:\n      macaddress: "${conf.match.macaddress}"\n`;
          networkDataYaml += `    dhcp4: ${conf.dhcp4}\n`;
          if (conf.addresses) {
              networkDataYaml += `    addresses:\n`;
              conf.addresses.forEach((addr: string) => networkDataYaml += `      - ${addr}\n`);
          }
          if (conf.gateway4) networkDataYaml += `    gateway4: ${conf.gateway4}\n`;
          if (conf.nameservers && conf.nameservers.addresses) {
              networkDataYaml += `    nameservers:\n      addresses:\n`;
              conf.nameservers.addresses.forEach((addr: string) => networkDataYaml += `        - ${addr}\n`);
          }
      });
  }

  // --- 6. 磁盘配置 (Disks) ---
  // 6.1 系统盘
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
              annotations: { "harvesterhci.io/imageId": fullImgName }
          },
          spec: {
              accessModes: ["ReadWriteMany"],
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

  // 6.2 CloudInit 磁盘
  const userData = (function () { 
      const ud = v.userData || ''; 
      if (v.installGuestAgent && !ud) { 
          return `#cloud-config\npackage_update: true\npackages:\n- qemu-guest-agent\nruncmd:\n- systemctl enable --now qemu-guest-agent || (service qemu-guest-agent start || true)`; 
      } 
      return ud || undefined; 
  })();

  if (userData || (v.sshNames && v.sshNames.length > 0) || networkDataYaml) {
       const ciName = 'cloudinitdisk';
       disks.push({ name: ciName, disk: { bus: 'virtio' } });
       
       const ciConfig: any = {};
       if (userData) ciConfig.userData = userData;
       if (networkDataYaml) ciConfig.networkData = networkDataYaml;
       
       volumes.push({ name: ciName, cloudInitNoCloud: ciConfig });
  }

  // 6.3 数据盘
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
                      volumeMode: d.volumeMode || "Block",
                      storageClassName: d.storageClassName || undefined
                  }
              });
          }
      });
  }

  // --- 7. 组装最终 Manifest ---
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
                labels: { "harvesterhci.io/vmName": vmId || v.name },
                annotations: {}
            },
            spec: {
                evictionStrategy: (v.evictionStrategy && v.evictionStrategy !== 'None') ? v.evictionStrategy : undefined,
                hostname: vmId || v.name,
                nodeSelector: nodeSelector,
                domain: {
                    cpu: {
                        cores: cores,
                        sockets: sockets,
                        threads: threads,
                        maxSockets: hotExpandEnabled ? sockets * 4 : undefined,
                        dedicatedCpuPlacement: !!v.dedicatedCPUPlacement,
                        isolateEmulatorThread: !!v.isolateEmulatorThread,
                        model: (function () {
                          const m = String(v.cpuModel || '').trim();
                          if (m === 'custom') return String(v.cpuModelCustom || '').trim() || undefined;
                          return undefined;
                        })()
                    },
                    memory: {
                        guest: memory,
                        maxGuest: hotExpandEnabled ? `${actualMemGi * 4}Gi` : undefined
                    },
                    resources: {
                        limits: (function () {
                          const obj: any = {};
                          // CPU 总 vCPU = sockets × cores × threads；limit 必须为该乘积
                          const totalCpu = sockets * cores * threads;
                          // CPU Limit（开启热扩容时设为热扩容上限即 maxSockets×cores×threads，否则按自定义或与 Request 一致）
                          if (!v.cpuBurstUnlimited && !v.dedicatedCPUPlacement) {
                            if (hotExpandEnabled) {
                              const maxSockets = sockets * 4;
                              obj.cpu = String(maxSockets * cores * threads);
                            } else if (typeof v.cpuLimit === 'number' && v.cpuLimit > 0) {
                              obj.cpu = String(v.cpuLimit);
                            } else {
                              obj.cpu = String(totalCpu);
                            }
                          }

                          // Memory Limit（开启热扩容时设为热扩容上限，否则按自定义或与 Request 一致）
                          if (!v.memoryBurstUnlimited) {
                            if (hotExpandEnabled) {
                              obj.memory = `${actualMemGi * 4}Gi`;
                            } else if (typeof v.memoryLimitGi === 'number' && v.memoryLimitGi > 0) {
                              obj.memory = `${v.memoryLimitGi}Gi`;
                            } else {
                              obj.memory = memory;
                            }
                          }
                          
                          return obj;
                        })(),
                        requests: (function () {
                            const obj: any = {};
                            
                            // CPU Request
                            if (!v.dedicatedCPUPlacement) {
                              if (typeof v.cpuRequest === 'number' && v.cpuRequest > 0) {
                                  obj.cpu = String(v.cpuRequest);
                              } else {
                                  obj.cpu = String(cpu);
                              }
                            }

                            // Memory Request
                            if (typeof v.memoryRequestGi === 'number' && v.memoryRequestGi > 0) {
                                obj.memory = `${v.memoryRequestGi}Gi`;
                            } else {
                                obj.memory = memory;
                            }
                            
                            return Object.keys(obj).length > 0 ? obj : undefined;
                        })()
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
                        gpus: (gpuMode === 'vgpu' && finalGpuResName) ? [
                            { name: "gpu-0", deviceName: finalGpuResName }
                        ] : [],
                        hostDevices: (gpuMode !== 'vgpu' && finalGpuResName) ? [
                            { name: selectedGpuDeviceName || "gpu-0", deviceName: finalGpuResName }
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

  if (v.sshNames && v.sshNames.length > 0) {
      manifest.spec.template.metadata.annotations["harvesterhci.io/sshNames"] = JSON.stringify(v.sshNames);
  }
  if (gpuMode !== 'vgpu' && finalGpuResName && selectedGpuDeviceName) {
      manifest.metadata.annotations["harvesterhci.io/deviceAllocationDetails"] = JSON.stringify({
          hostdevices: {
              [finalGpuResName]: [selectedGpuDeviceName],
          },
      });
  }

  return manifest;
};

// 兼容旧代码的别名导出
export const constructVmPayload = buildHarvesterVmPayload;

// ==========================================
// 5. 后续操作 (Post-Action)
// ==========================================

/**
 * 处理 VM 创建后的自动启动逻辑
 * 
 * @param cid 集群 ID
 * @param vmId 虚拟机 ID
 * @param v 表单数据
 */
export const handleAutoStart = async (cid: string, vmId: string, v: any) => {
    const instanceId = `${v.namespace}/${vmId}`;
    try { await startCloudProviderEcs(cid, instanceId); } catch { }
};
