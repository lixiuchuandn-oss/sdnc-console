/**
 * 变配表单统一提交：由 useVmReconfigure 注入依赖，调用时读取最新 props/state。
 */
import { message, Modal } from 'antd';
import type { FormInstance } from 'antd/es/form';
import yaml from 'js-yaml';
import {
  updateHarvesterVmSpec,
  createHarvesterVolume,
  patchHarvesterVm,
  fetchHarvesterVmDetail,
  fetchHarvesterVMAggregated,
  updateHarvesterVolume,
} from '../../../../../../../services/harvesterApi';
import { isHarvesterVmImageReady, resolveVmImageKind } from '../../../../../../../utils/harvesterUtils';
import { harvesterCreatedPvcNameFromResponse } from './lib/vmReconfigureHarvesterResponse';
import { applyBootOrderCdromFirst } from './lib/vmReconfigureBootOrder';
import {
  allocateSecondaryNicNames,
  getMissingNadsFromNetworks,
  hasDuplicateFlatSubnetsInNetworks,
} from './lib/vmReconfigureNetwork';
import { parseQuantity, storageQuantityToGiB } from './lib/vmReconfigureQuantity';
import { parseVmCloudInitNetworkData, generateMacAddressForStaticNic } from './lib/vmReconfigureCloudInit';
import { getVmReconfigureCurrentSpec } from './lib/vmReconfigureCurrentSpec';
import { isVmStopped } from './lib/vmReconfigureVmStatus';

export type VmReconfigureSubmitDeps = {
  form: FormInstance;
  cloudId: string;
  record: any;
  latestVm: any;
  activeRecord: any;
  selectedKey: string;
  systemDisk: string;
  subnets: any[];
  nads: any[];
  images: any[];
  gpuResources: any[];
  usbResources: any[];
  setLatestVm: (vm: any) => void;
  ensureNadsLoaded: () => Promise<any[]>;
  openRestartConfirm: (
    namespace: string,
    vmName: string,
    force?: boolean,
    options?: { cdrom?: boolean },
  ) => void;
  maybePromptRestart: (namespace: string, vmName: string, options?: { force?: boolean }) => Promise<void>;
  fetchAggregatedVm: (namespace: string, vmName: string) => Promise<any>;
  onOk?: (refresh?: boolean) => void;
  onClose?: () => void;
};

export async function runVmReconfigureSubmit(d: VmReconfigureSubmitDeps): Promise<void> {
  const {
    form,
    cloudId,
    record,
    latestVm,
    activeRecord,
    selectedKey,
    systemDisk,
    subnets,
    nads,
    images,
    gpuResources,
    usbResources,
    setLatestVm,
    ensureNadsLoaded,
    openRestartConfirm,
    maybePromptRestart,
    fetchAggregatedVm,
    onOk,
    onClose,
  } = d;

  const getCurrentSpec = () => getVmReconfigureCurrentSpec(record, activeRecord);
  const getMemoryInGi = (q: string | number | undefined) => storageQuantityToGiB(q);
  const getQuantityInGi = (q: string | number | undefined) => storageQuantityToGiB(q);
  const getParsedNetworkData = (vm: any) => parseVmCloudInitNetworkData(vm);
  const generateMacAddress = () => generateMacAddressForStaticNic();
  const CDROM_BUS: 'sata' = 'sata';

  try {
    const values = await form.validateFields();
    const vmName = record?.metadata?.name;
    const namespace = record?.metadata?.namespace;

    if (selectedKey !== 'change_primary_nic' && selectedKey !== 'change_secondary_nic') {
      const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
      const nadList = await ensureNadsLoaded();
      const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
      if (missing.length > 0) {
        message.error(`更新失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再进行该操作。`);
        return;
      }
    }

    switch (selectedKey) {
      case 'expand_disk': {
        const newSize = values.systemDiskSize;
        const targetPvc = String(values.expandDiskPvc || '').trim() || systemDisk;
        if (!targetPvc || !newSize) {
          message.error('请选择要扩容的卷并输入新容量');
          return;
        }
        await updateHarvesterVolume(cloudId, namespace, targetPvc, { sizeGi: newSize });

        const currentAnnotations = (latestVm || record)?.metadata?.annotations || {};
        const templateStr = currentAnnotations['harvesterhci.io/volumeClaimTemplates'];

        if (templateStr) {
          try {
            const templates = JSON.parse(templateStr);
            let hasChange = false;
            const updatedTemplates = templates.map((t: any) => {
              if (t.metadata.name === targetPvc) {
                hasChange = true;
                return {
                  ...t,
                  spec: {
                    ...t.spec,
                    resources: {
                      ...t.spec.resources,
                      requests: {
                        ...t.spec.resources.requests,
                        storage: `${newSize}Gi`,
                      },
                    },
                  },
                };
              }
              return t;
            });

            if (hasChange) {
              await patchHarvesterVm(cloudId, namespace, vmName, {
                annotations: {
                  'harvesterhci.io/volumeClaimTemplates': JSON.stringify(updatedTemplates),
                },
              });
            }
          } catch (e) {
            console.warn('Failed to update volumeClaimTemplates annotation', e);
          }
        }

        try {
          const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
          const data = res?.data?.vm ? res.data : res;
          const updatedVm = data?.vm || data;
          if (updatedVm && data?.related) {
            updatedVm.related = data.related;
          }
          setLatestVm(updatedVm);
        } catch {}

        message.success('磁盘扩容请求已提交，设置已保存');
        void maybePromptRestart(namespace, vmName);
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

        const newCpu = values.cpu !== undefined ? Number(values.cpu) : finalTotalCpu; // Total Cores，如果未传则保持原值
        // [关键修复] 如果用户没有修改内存（values.memory 为 undefined），应该使用表单初始化时的值（currentMemGi）
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
        const isMemHotAdd = !finalMemChanged || (newMemGi >= currentMemGi - 0.01); // 与表单初始化时的 currentMemGi 比较
        
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
           // [修复] 检查虚拟机是否处于停止状态，停止状态的虚拟机在启动时会自动应用配置，无需重启
           try {
             const updatedVm = await fetchAggregatedVm(namespace, vmName);
             if (isVmStopped(updatedVm)) {
               message.success('设置已保存，下次启动时将自动应用新配置');
             } else {
               openRestartConfirm(namespace, vmName, false);
             }
           } catch {
             // 如果获取VM状态失败，仍然提示重启（保守策略）
             openRestartConfirm(namespace, vmName, false);
           }
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

        await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
        message.success('热扩容设置已提交');
        // [修复] 开启热扩容应该无条件提示重启对话框
        // 只要开启了热扩容（values.enableHotPlug === true），就需要重启生效
        if (values.enableHotPlug) {
          openRestartConfirm(namespace, vmName, false);
        } else {
          // 关闭热扩容也需要重启生效
          openRestartConfirm(namespace, vmName, false);
        }
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
        message.success('性能设置已更新');
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
        const diskSrc = String(values.newDiskSource || 'create');

        // 两步流程：
        // - 第一次提交：只创建 PVC（避免 PVC 尚未 Bound 导致挂载需要点两次）
        // - 第二次提交：通过修改 VM 规格模板挂载数据盘（支持自定义总线类型，需重启生效）
        if (!created) {
          if (diskSrc === 'existing') {
            message.warning('已选择已有磁盘时，请使用底部【挂载磁盘】完成挂载');
            return;
          }
          const accessMode = values.newDiskAccessMode || 'ReadWriteMany';

          if (diskSrc === 'iso') {
            const imgVal = String(values.newDiskIsoImage || '').trim();
            const hit = (images || []).find((x: any) => {
              const name = x?.metadata?.name || x?.name;
              const ns = x?.metadata?.namespace || x?.namespace;
              const v = ns && name ? `${ns}/${name}` : name;
              return v === imgVal;
            });
            if (!hit || resolveVmImageKind(hit) !== 'iso' || !isHarvesterVmImageReady(hit)) {
              message.error('请选择有效的 ISO 镜像');
              return;
            }
            const createRes: any = await createHarvesterVolume(cloudId, {
              namespace,
              name: volName,
              size: values.newDiskSize,
              storageClassName: values.newDiskSc,
              accessModes: [accessMode],
              volumeMode: 'Block',
              annotations: { 'harvesterhci.io/imageId': imgVal },
            });
            const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
            form.setFieldsValue({ newDiskCreated: true, newDiskName: actualName });
            message.success('光盘卷已创建');
            return;
          }

          const createRes: any = await createHarvesterVolume(cloudId, {
            namespace,
            name: volName,
            size: values.newDiskSize,
            storageClassName: values.newDiskSc,
            accessModes: [accessMode],
            volumeMode: 'Block',
          });
          const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
          form.setFieldsValue({ newDiskCreated: true, newDiskName: actualName });
          message.success('磁盘卷已创建');
          return; // 不关闭弹窗
        }

        // 第二步：通过修改 VM 规格模板挂载数据盘，而不是走在线热插拔 API
        {
          const vmSpecSource = latestVm || record;
          const vmSpec = vmSpecSource?.spec || {};
          const tplSpec = vmSpec?.template?.spec || {};
          const domain = tplSpec?.domain || {};
          const devices = domain?.devices || {};
          const volumes = Array.isArray(tplSpec?.volumes) ? [...tplSpec.volumes] : [];
          const disks = Array.isArray(devices?.disks) ? [...devices.disks] : [];

          // 确保 PVC 作为 volume 存在
          const volExisting = volumes.find((v: any) => v?.name === volName);
          if (!volExisting) {
            volumes.push({
              name: volName,
              persistentVolumeClaim: { claimName: volName },
            });
          }

          if (diskSrc === 'iso') {
            const diskExisting = disks.find((d: any) => d?.name === volName);
            if (diskExisting) {
              if (diskExisting.disk && !diskExisting.cdrom) {
                message.error(`名称 ${volName} 已被数据盘占用，无法作为光驱挂载`);
                return;
              }
              diskExisting.cdrom = { bus: CDROM_BUS };
              delete diskExisting.disk;
            } else {
              disks.push({
                name: volName,
                cdrom: { bus: CDROM_BUS },
              });
            }
            if (values.newDiskBootFromCdrom) {
              applyBootOrderCdromFirst(disks, volName);
            }
          } else {
            // 为该 volume 添加/更新磁盘信息（总线类型由用户选择）
            const targetBus = values.newDiskBus || 'virtio';
            const diskExisting = disks.find((d: any) => d?.name === volName);
            if (diskExisting) {
              diskExisting.disk = diskExisting.disk || {};
              diskExisting.disk.bus = targetBus;
            } else {
              disks.push({
                name: volName,
                disk: { bus: targetBus },
              });
            }
          }

          const patchPayload: any = {
            spec: {
              template: {
                spec: {
                  ...tplSpec,
                  domain: {
                    ...domain,
                    devices: {
                      ...devices,
                      disks,
                    },
                  },
                  volumes,
                },
              },
            },
          };

          await patchHarvesterVm(cloudId, namespace, vmName, patchPayload);
        }

        try {
          const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
          const data = res?.data?.vm ? res.data : res;
          const updatedVm = data?.vm || data;
          if (updatedVm && data?.related) {
            updatedVm.related = data.related;
          }
          setLatestVm(updatedVm);
        } catch {
          // 刷新失败不影响后续重启提示
        }
        // 无论后端是否显式打上 RestartRequired，都统一给出“需重启”提示
        message.success(
          diskSrc === 'iso'
            ? values.newDiskBootFromCdrom
              ? '光盘挂载成功，已设为优先从光驱启动；须重启虚拟机后生效（光驱总线固定 SCSI）'
              : '光盘挂载成功，设置已保存；须重启虚拟机后生效（光驱总线固定 SCSI）'
            : '磁盘挂载成功，设置已保存，需要重启后生效',
        );
        openRestartConfirm(namespace, vmName, false, diskSrc === 'iso' ? { cdrom: true } : undefined);
        form.setFieldsValue({
          newDiskCreated: false,
          ...(diskSrc === 'iso' ? { newDiskIsoImage: undefined, newDiskBootFromCdrom: false } : {}),
        });

        // 通知上层刷新（VM + volumes），并关闭
        try { onOk?.(true); } catch {}
        onClose?.();
        break;
      }
      case 'change_gpu': {
        const mode = values.gpuMode || 'none';
        const names = Array.isArray(values.gpuResourceNames) ? values.gpuResourceNames : [];
        const deviceNames = Array.isArray(values.gpuDeviceNames) ? values.gpuDeviceNames : [];
        const gpuNodeName = values.gpuNodeName !== undefined ? values.gpuNodeName : undefined;
        
        // [节点选择器校验] 如果是直通GPU（非vGPU），需要校验节点选择器
        if (mode !== 'none' && mode !== 'vgpu' && names.length > 0) {
          const activeVm = latestVm || record;
          const currentNodeSelector = activeVm?.spec?.template?.spec?.nodeSelector || {};
          const currentNodeName = currentNodeSelector['kubernetes.io/hostname'];
          
          // 获取要挂载的GPU设备所在的节点
          const gpuList = Array.isArray(gpuResources) ? gpuResources : [];
          const targetGpus = names.map((rn: string) => gpuList.find((g: any) => String(g?.resourceName || '') === String(rn))).filter(Boolean);
          const targetNodes = targetGpus.map((g: any) => String(g?.node || g?.nodeName || '').trim()).filter(Boolean);
          const uniqueTargetNodes = Array.from(new Set(targetNodes));
          
          if (uniqueTargetNodes.length > 0) {
            const targetNode = uniqueTargetNodes[0]; // 取第一个节点（如果多个节点不一致，后面会拒绝）
            
            // 检查当前VM是否有其他直通设备（USB或GPU）
            const domain = activeVm?.spec?.template?.spec?.domain;
            const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
            const currentGpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
            const isUsbHostDevice = (d: any) => {
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('usb') || dn.includes('usb');
            };
            const isGpuLikeHostDevice = (d: any) => {
              if (isUsbHostDevice(d)) return false;
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('gpu') || dn.startsWith('nvidia.com/');
            };
            const hasOtherPassthroughDevices = hostDevices.some((d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d)) || currentGpus.length > 0;
            
            // 1. 判断是否有节点选择器
            if (!currentNodeName) {
              // 2. 如果没有，自动设置节点选择器
              await updateHarvesterVmSpec(cloudId, namespace, vmName, {
                gpuMode: mode,
                gpuResourceNames: names,
                gpuDeviceNames: deviceNames,
                gpuNodeName: targetNode,
              });
              message.success(`GPU配置已更新，已自动设置节点选择器为 ${targetNode}`);
              openRestartConfirm(namespace, vmName, false);
              break;
            } else {
              // 3. 如果有节点选择器
              if (!hasOtherPassthroughDevices) {
                // 3.1 没有其他直通设备，提示用户是否变更节点
                if (currentNodeName !== targetNode) {
                  Modal.confirm({
                    title: '节点选择器不一致',
                    content: `当前VM的节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`,
                    okText: '是，变更节点',
                    cancelText: '取消',
                    onOk: async () => {
                      await updateHarvesterVmSpec(cloudId, namespace, vmName, {
                        gpuMode: mode,
                        gpuResourceNames: names,
                        gpuDeviceNames: deviceNames,
                        gpuNodeName: targetNode,
                      });
                      message.success('GPU配置已更新，节点选择器已变更');
                      openRestartConfirm(namespace, vmName, false);
                    },
                  });
                  return; // 不继续执行，等待用户确认
                }
              } else {
                // 3.2 有其他直通设备
                if (currentNodeName === targetNode) {
                  // 3.2.1 节点选择器与自己一致，跳过（直接提交）
                } else {
                  // 3.2.2 节点选择器与自己不一致，拒绝变配
                  message.error(`无法挂载GPU：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的GPU设备。`);
                  return; // 拒绝提交
                }
              }
            }
            
            // 检查多个GPU是否在同一节点
            if (uniqueTargetNodes.length > 1) {
              message.error(`无法挂载GPU：选择的GPU设备位于不同节点（${uniqueTargetNodes.join(', ')}），请选择位于同一节点的GPU设备。`);
              return; // 拒绝提交
            }
          }
        }
        
        await updateHarvesterVmSpec(cloudId, namespace, vmName, {
          gpuMode: mode,
          gpuResourceNames: mode === 'none' ? [] : names,
          gpuDeviceNames: mode === 'none' ? [] : deviceNames,
          gpuNodeName: mode === 'none' ? null : gpuNodeName,
        });
        message.success('GPU配置已更新');
        openRestartConfirm(namespace, vmName, false);
        break;
      }
      case 'change_node_scheduling': {
        const mode = values.nodeSchedulingMode;
        const fixedNode = values.fixedNode;
        const nodeSelectorPairs = values.nodeSelectorPairs || [];
        
        // 验证
        if (mode === 'fixed' && !fixedNode) {
          message.error('请选择要固定的节点');
          return;
        }
        if (mode === 'label') {
          const validPairs = nodeSelectorPairs.filter((p: any) => p?.key && p?.value);
          if (validPairs.length === 0) {
            message.error('请至少添加一个标签选择器');
            return;
          }
        }
        
        // 构建提交参数
        let updateParams: any = {};
        
        if (mode === 'auto') {
          // 自动调度：清空所有 nodeSelector
          updateParams.nodeSelector = null;
        } else if (mode === 'fixed') {
          // 指定主机：使用 nodeSelector
          const nodeName = String(fixedNode || '').trim();
          if (nodeName) {
            updateParams.nodeSelector = {
              'kubernetes.io/hostname': nodeName
            };
          } else {
            updateParams.nodeSelector = null;
          }
        } else if (mode === 'label') {
          // 标签选择：构建 nodeSelector 对象
          const nodeSelector: Record<string, string> = {};
          nodeSelectorPairs.forEach((p: any) => {
            const key = String(p?.key || '').trim();
            const value = String(p?.value || '').trim();
            if (key && value) {
              nodeSelector[key] = value;
            }
          });
          updateParams.nodeSelector = Object.keys(nodeSelector).length > 0 ? nodeSelector : null;
        }

        await updateHarvesterVmSpec(cloudId, namespace, vmName, updateParams);
        message.success('节点调度配置已更新');
        openRestartConfirm(namespace, vmName, false);
        break;
      }
      case 'change_node_affinity': {
        const mode = values.nodeAffinityMode;
        const terms = values.nodeAffinityTerms || [];
        
        // 构建 nodeAffinity
        let nodeAffinity: any = null; // 使用 null 表示清空
        if (mode === 'required' && terms.length > 0) {
          const nodeSelectorTerms = terms.map((term: any) => {
            const expressions = (term.expressions || []).filter((expr: any) => expr?.key && expr?.operator);
            if (expressions.length === 0) return null;
            
            return {
              matchExpressions: expressions.map((expr: any) => {
                const matchExpr: any = {
                  key: String(expr.key || '').trim(),
                  operator: String(expr.operator || 'In'),
                };
                
                // 某些操作符不需要 values（如 Exists, DoesNotExist）
                if (!['Exists', 'DoesNotExist'].includes(matchExpr.operator)) {
                  const values = Array.isArray(expr.values) ? expr.values : [];
                  const filteredValues = values.filter((v: any) => v && String(v).trim()).map((v: any) => String(v).trim());
                  if (filteredValues.length > 0) {
                    matchExpr.values = filteredValues;
                  } else {
                    // 如果操作符需要值但没有提供，跳过这个表达式
                    return null;
                  }
                }
                
                return matchExpr;
              }).filter((expr: any) => expr !== null && expr.key),
            };
          }).filter((term: any) => term !== null && term.matchExpressions && term.matchExpressions.length > 0);
          
          if (nodeSelectorTerms.length > 0) {
            nodeAffinity = {
              nodeAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms,
                },
              },
            };
          }
        }
        
        await updateHarvesterVmSpec(cloudId, namespace, vmName, { affinity: nodeAffinity });
        message.success('节点亲和性配置已更新');
        openRestartConfirm(namespace, vmName, false);
        break;
      }
      case 'change_usb': {
        const names = Array.isArray(values.usbResourceNames) ? values.usbResourceNames : [];
        
        // [节点选择器校验] USB是直通设备，需要校验节点选择器
        if (names.length > 0) {
          const activeVm = latestVm || record;
          const currentNodeSelector = activeVm?.spec?.template?.spec?.nodeSelector || {};
          const currentNodeName = currentNodeSelector['kubernetes.io/hostname'];
          
          // 获取要挂载的USB设备所在的节点
          const usbList = Array.isArray(usbResources) ? usbResources : [];
          const targetUsbs = names.map((rn: string) => usbList.find((u: any) => String(u?.resourceName || '') === String(rn))).filter(Boolean);
          const targetNodes = targetUsbs.map((u: any) => String(u?.nodeName || u?.node || '').trim()).filter(Boolean);
          const uniqueTargetNodes = Array.from(new Set(targetNodes));
          
          if (uniqueTargetNodes.length > 0) {
            const targetNode = uniqueTargetNodes[0]; // 取第一个节点（如果多个节点不一致，后面会拒绝）
            
            // 检查当前VM是否有其他直通设备（USB或GPU）
            const domain = activeVm?.spec?.template?.spec?.domain;
            const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
            const currentGpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
            const isUsbHostDevice = (d: any) => {
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('usb') || dn.includes('usb');
            };
            const isGpuLikeHostDevice = (d: any) => {
              if (isUsbHostDevice(d)) return false;
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('gpu') || dn.startsWith('nvidia.com/');
            };
            const hasOtherPassthroughDevices = hostDevices.some((d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d)) || currentGpus.length > 0;
            
            // 1. 判断是否有节点选择器
            if (!currentNodeName) {
              // 2. 如果没有，自动设置节点选择器
              await updateHarvesterVmSpec(cloudId, namespace, vmName, { 
                usbResourceNames: names,
                nodeSelector: { 'kubernetes.io/hostname': targetNode }
              });
              message.success(`USB配置已更新，已自动设置节点选择器为 ${targetNode}`);
              openRestartConfirm(namespace, vmName, false);
              break;
            } else {
              // 3. 如果有节点选择器
              if (!hasOtherPassthroughDevices) {
                // 3.1 没有其他直通设备，提示用户是否变更节点
                if (currentNodeName !== targetNode) {
                  Modal.confirm({
                    title: '节点选择器不一致',
                    content: `当前VM的节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`,
                    okText: '是，变更节点',
                    cancelText: '取消',
                    onOk: async () => {
                      await updateHarvesterVmSpec(cloudId, namespace, vmName, { 
                        usbResourceNames: names,
                        nodeSelector: { 'kubernetes.io/hostname': targetNode }
                      });
                      message.success('USB配置已更新，节点选择器已变更');
                      openRestartConfirm(namespace, vmName, false);
                    },
                  });
                  return; // 不继续执行，等待用户确认
                }
              } else {
                // 3.2 有其他直通设备
                if (currentNodeName === targetNode) {
                  // 3.2.1 节点选择器与自己一致，跳过（直接提交）
                } else {
                  // 3.2.2 节点选择器与自己不一致，拒绝变配
                  message.error(`无法挂载USB：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的USB设备。`);
                  return; // 拒绝提交
                }
              }
            }
            
            // 检查多个USB是否在同一节点
            if (uniqueTargetNodes.length > 1) {
              message.error(`无法挂载USB：选择的USB设备位于不同节点（${uniqueTargetNodes.join(', ')}），请选择位于同一节点的USB设备。`);
              return; // 拒绝提交
            }
          }
        }
        
        await updateHarvesterVmSpec(cloudId, namespace, vmName, { usbResourceNames: names });
        message.success('USB配置已更新');
        openRestartConfirm(namespace, vmName, false);
        break;
      }
      case 'vm_policy': {
        const rs = values.runStrategy || 'Manual';
        const es = values.evictionStrategy ? String(values.evictionStrategy) : null;
        await updateHarvesterVmSpec(cloudId, namespace, vmName, { runStrategy: rs, evictionStrategy: es });
        message.success('策略配置已更新');
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
            
            // Set interface type (managedtap binding, bridge, masquerade, sriov, macvtap)
            if (nic.type === 'managedtap') {
               interfaceConfig.binding = { name: 'managedtap' };
            } else if (nic.type === 'masquerade') {
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
               const subnetName = nic.subnet || nic.name || '';
               if (subnetName) {
                  const subnet = subnets.find((s: any) => s?.metadata?.name === subnetName);
                  if (subnet?.metadata?.namespace) {
                     pNetName = `${subnet.metadata.namespace}/${subnetName}`;
                  } else {
                     const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                     if (nad?.metadata?.namespace) {
                        pNetName = `${nad.metadata.namespace}/${subnetName}`;
                     } else {
                        pNetName = subnetName;
                     }
                  }
               } else {
                  pNetName = '';
               }
            } else if (netMode === 'flat_subnet') {
               const raw = nic.name || '';
               const subnetName =
                  nic.subnet ||
                  (raw && String(raw).includes('/') ? String(raw).split('/').pop() : raw) ||
                  '';
               if ((!pNetName || !String(pNetName).includes('/')) && subnetName) {
                  const subnet = subnets.find((s: any) => s?.metadata?.name === subnetName);
                  let ns = subnet?.metadata?.namespace;
                  if (!ns && subnet?.spec?.provider) {
                     const parts = String(subnet.spec.provider).split('.');
                     if (parts.length >= 2) ns = parts[parts.length - 2];
                  }
                  if (ns) {
                     pNetName = `${ns}/${subnetName}`;
                  } else {
                     const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                     if (nad?.metadata?.namespace) {
                        pNetName = `${nad.metadata.namespace}/${subnetName}`;
                     } else {
                        pNetName = subnetName;
                     }
                  }
               } else if (!subnetName) {
                  pNetName = '';
               }
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

            if (hasDuplicateFlatSubnetsInNetworks(networks, subnets)) {
              message.error('同一扁平子网在同一云主机内只能使用一次');
              return;
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
            
            {
              const nadList = await ensureNadsLoaded();
              const missing = getMissingNadsFromNetworks(networks, String(namespace || 'default'), nadList);
              if (missing.length > 0) {
                message.error(`更新失败：引用的 NAD 不存在：${missing.join(', ')}。请更换为存在的网络后再提交。`);
                return;
              }
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

         const primaryIfaceName =
           String(currentInterfaces[0]?.name || currentNetworks[0]?.name || '').trim() || 'default';
         const secondaryIfaceNames = allocateSecondaryNicNames(primaryIfaceName, secondaryNics.length);

         // Append Secondary NICs
         secondaryNics.forEach((nic: any, idx: number) => {
            const ifaceName = secondaryIfaceNames[idx];
            let mac = nic.macAddress;

            // Auto-generate MAC if Static IP is used but MAC is missing
            if (nic.ipAddress && !mac) {
                mac = generateMacAddress();
            }

            // Interface
            const ifaceRow: any = {
               name: ifaceName,
               model: nic.model || 'virtio',
               macAddress: mac,
            };
            const nt = nic.type || 'bridge';
            if (nt === 'managedtap') ifaceRow.binding = { name: 'managedtap' };
            else if (nt === 'masquerade') ifaceRow.masquerade = {};
            else if (nt === 'sriov') ifaceRow.sriov = {};
            else if (nt === 'macvtap') ifaceRow.macvtap = {};
            else ifaceRow.bridge = {};
            newInterfaces.push(ifaceRow);
            
            // Network
            let sNetName = nic.name;
            // Handle flat network name resolution
            if (nic.mode === 'flat' && sNetName && !sNetName.includes('/')) {
                const found = nads.find((n: any) => n.metadata.name === sNetName);
                if (found) sNetName = `${found.metadata.namespace}/${found.metadata.name}`;
            }
            if (nic.mode === 'passthrough' && sNetName && !sNetName.includes('/')) {
                const found = nads.find((n: any) => n.metadata.name === sNetName);
                if (found) sNetName = `${found.metadata.namespace}/${found.metadata.name}`;
            }
            // Handle VPC network name (subnet name -> NAD name)
            // For Kube-OVN VPC, subnet name should match NAD name, but networkName needs namespace/name format
            if (nic.mode === 'vpc') {
                const subnetName = nic.subnet;
                if (subnetName) {
                    // 按子网名 + VPC 查找，避免跨 VPC 同名子网误匹配
                    const subnet = subnets.find(
                      (s: any) =>
                        s?.metadata?.name === subnetName &&
                        String(s?.spec?.vpc || s?.vpc || '').trim() === String(nic?.vpc || '').trim(),
                    );
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
            if (nic.mode === 'flat_subnet') {
                const raw = nic.name || '';
                const subnetName =
                    nic.subnet ||
                    (raw && String(raw).includes('/') ? String(raw).split('/').pop() : raw) ||
                    '';
                if ((!sNetName || !String(sNetName).includes('/')) && subnetName) {
                    const subnet = subnets.find((s: any) => {
                      if (s?.metadata?.name !== subnetName) return false;
                      const st = String(s?.metadata?.annotations?.['tower.io/subnet-type'] || '')
                        .trim()
                        .toLowerCase();
                      return st === 'flat';
                    });
                    let ns = subnet?.metadata?.namespace;
                    if (!ns && subnet?.spec?.provider) {
                        const parts = String(subnet.spec.provider).split('.');
                        if (parts.length >= 2) ns = parts[parts.length - 2];
                    }
                    if (ns) {
                        sNetName = `${ns}/${subnetName}`;
                    } else {
                        const nad = nads.find((n: any) => n?.metadata?.name === subnetName);
                        if (nad?.metadata?.namespace) {
                            sNetName = `${nad.metadata.namespace}/${subnetName}`;
                        } else {
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

         if (hasDuplicateFlatSubnetsInNetworks(newNetworks, subnets)) {
             message.error('同一扁平子网在同一云主机内只能使用一次');
             return;
         }

         // 删除 cloud-init 中已无对应网卡的 ethernets 条目（与当前 interfaces[].name 对齐）
         const ifaceNamesInSpec = new Set(
           newInterfaces.map((i: any) => String(i?.name || '').trim()).filter(Boolean),
         );
         if (networkDataObj?.network?.ethernets) {
           Object.keys(networkDataObj.network.ethernets).forEach((key) => {
             if (!ifaceNamesInSpec.has(key)) {
               delete networkDataObj.network.ethernets[key];
               hasNetworkDataChange = true;
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

         {
           const nadList = await ensureNadsLoaded();
           const missing = getMissingNadsFromNetworks(newNetworks, String(namespace || 'default'), nadList);
           if (missing.length > 0) {
             message.error(`更新失败：引用的 NAD 不存在：${missing.join(', ')}。请更换为存在的网络后再提交。`);
             return;
           }
         }

         await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
         openRestartConfirm(namespace, vmName, false);
         break;
      }
      // ... other cases
      default:
        break;
    }
    onOk?.();
    onClose?.();
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
        const nadNotFound = errorMsg.match(/network-attachment-definitions\.k8s\.cni\.cncf\.io\s+"([^"]+)"\s+not\s+found/i);
        if (nadNotFound?.[1]) {
          errorMsg = `更新失败：引用的网络附件（NAD）不存在：${nadNotFound[1]}。请在虚拟机网卡配置中更换为存在的网络，或在对应命名空间创建该 NAD。`;
        }
      }

      message.error(errorMsg);
    }
  }
}
